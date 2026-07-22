-- Manual USDT-BEP20 withdrawal database boundary.
--
-- This migration deliberately adds no endpoint, UI, payout provider, signer,
-- key material, or automatic transfer. Deposits remain independently enabled;
-- withdrawals start disabled and all mutations are available only through
-- service-role-only, security-definer database functions.

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_provider_payments') is null
    or to_regclass('public.nowpayments_usdt_withdrawals') is null
    or to_regclass('public.nowpayments_usdt_ledger_entries') is null
    or to_regclass('public.crypto_deposit_addresses') is null
    or to_regclass('public.profiles') is null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)') is null
  then
    raise exception 'NOWPayments USDT withdrawal foundation is incomplete';
  end if;

  if (select count(*) from public.nowpayments_usdt_config) <> 1
    or not exists (
      select 1
      from public.nowpayments_usdt_config
      where id = 'USDT-BEP20'
        and asset = 'USDT'
        and network = 'BEP20'
        and provider_currency = 'usdtbsc'
        and deposit_minimum_usdt = 1
        and withdrawal_minimum_usdt = 2
        and withdrawal_fee_percent = 5
    )
  then
    raise exception 'unexpected NOWPayments USDT configuration fingerprint';
  end if;

  if exists (select 1 from public.nowpayments_usdt_withdrawals) then
    raise exception 'NOWPayments USDT withdrawal table must be empty';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nowpayments_usdt_config'
      and column_name = 'withdrawals_enabled'
  )
    or to_regclass('public.nowpayments_usdt_withdrawal_events') is not null
    or to_regclass('public.nowpayments_usdt_withdrawal_broadcasts') is not null
    or to_regclass('public.nowpayments_usdt_withdrawal_verifications') is not null
    or to_regprocedure('public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)') is not null
  then
    raise exception 'NOWPayments USDT withdrawal objects already exist outside migration tracking';
  end if;
end;
$preflight$;

alter table public.nowpayments_usdt_config
  add column withdrawals_enabled boolean not null default false;

alter table public.nowpayments_usdt_config
  add constraint nowpayments_usdt_config_withdrawals_enabled_default_check
    check (withdrawals_enabled in (true, false));

alter table public.nowpayments_usdt_withdrawals
  drop constraint nowpayments_usdt_withdrawals_status_check,
  drop constraint nowpayments_usdt_withdrawals_terminal_timestamps_check,
  drop constraint nowpayments_usdt_withdrawals_provider_payout_id_key,
  drop constraint nowpayments_usdt_withdrawals_provider_payout_id_check,
  drop column provider_payout_id,
  drop column submitted_at,
  drop column finished_at,
  drop column failed_at,
  drop column failure_code;

alter table public.nowpayments_usdt_withdrawals
  rename column amount_usdt to gross_amount_usdt;

alter table public.nowpayments_usdt_withdrawals
  alter column destination_address type text using lower(btrim(destination_address)),
  alter column status set default 'reserved',
  add column initial_admin_id uuid references public.profiles(id) on delete no action,
  add column current_admin_id uuid references public.profiles(id) on delete no action,
  add column claimed_at timestamptz,
  add column send_locked_at timestamptz,
  add column broadcasted_at timestamptz,
  add column completed_at timestamptz,
  add column rejected_at timestamptz,
  add column rejection_reason text,
  add column current_broadcast_id uuid,
  add constraint nowpayments_usdt_withdrawals_request_id_v4_check
    check (id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  add constraint nowpayments_usdt_withdrawals_destination_bep20_check
    check (destination_address ~ '^0x[0-9a-f]{40}$'),
  add constraint nowpayments_usdt_withdrawals_gross_precision_check
    check (gross_amount_usdt = round(gross_amount_usdt, 6)),
  add constraint nowpayments_usdt_withdrawals_amount_equation_check
    check (
      gross_amount_usdt = fee_amount_usdt + net_amount_usdt
      and fee_amount_usdt = round(gross_amount_usdt * 5 / 100, 6)
      and net_amount_usdt > 0
    ),
  add constraint nowpayments_usdt_withdrawals_status_check
    check (status in (
      'reserved', 'reviewing', 'send_locked', 'broadcasted', 'completed', 'rejected'
    )),
  add constraint nowpayments_usdt_withdrawals_admin_state_check
    check (
      (status = 'reserved'
        and initial_admin_id is null and current_admin_id is null and claimed_at is null)
      or (status in ('reviewing', 'send_locked', 'broadcasted', 'completed')
        and initial_admin_id is not null and current_admin_id is not null and claimed_at is not null)
      or (status = 'rejected')
    ),
  add constraint nowpayments_usdt_withdrawals_state_timestamps_check
    check (
      (status = 'reserved'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'reviewing'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'send_locked'
        and send_locked_at is not null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'broadcasted'
        and send_locked_at is not null and broadcasted_at is not null
        and completed_at is null and rejected_at is null)
      or (status = 'completed'
        and send_locked_at is not null and broadcasted_at is not null
        and completed_at is not null and rejected_at is null)
      or (status = 'rejected'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is not null
        and rejection_reason is not null and btrim(rejection_reason) <> '')
    );

drop index public.idx_nowpayments_usdt_withdrawals_status;
create index idx_nowpayments_usdt_withdrawals_status
  on public.nowpayments_usdt_withdrawals (status, created_at);
create unique index nowpayments_usdt_withdrawals_one_open_per_user
  on public.nowpayments_usdt_withdrawals (user_id)
  where status in ('reserved', 'reviewing', 'send_locked', 'broadcasted');

create table public.nowpayments_usdt_withdrawal_events (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.nowpayments_usdt_withdrawals(id) on delete no action,
  user_id uuid not null references public.profiles(id) on delete no action,
  actor_id uuid not null references public.profiles(id) on delete no action,
  action_id uuid not null,
  action_type text not null,
  from_status text,
  to_status text not null,
  canonical_payload text not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint nowpayments_usdt_withdrawal_events_action_id_key unique (action_id),
  constraint nowpayments_usdt_withdrawal_events_action_id_v4_check
    check (action_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint nowpayments_usdt_withdrawal_events_action_type_check
    check (action_type in (
      'request', 'claim_review', 'send_lock', 'record_broadcast',
      'complete', 'reject', 'admin_takeover'
    )),
  constraint nowpayments_usdt_withdrawal_events_status_check
    check (
      (action_type = 'request' and from_status is null and to_status = 'reserved')
      or (action_type = 'claim_review' and from_status = 'reserved' and to_status = 'reviewing')
      or (action_type = 'send_lock' and from_status = 'reviewing' and to_status = 'send_locked')
      or (action_type = 'record_broadcast' and from_status in ('send_locked', 'broadcasted') and to_status = 'broadcasted')
      or (action_type = 'complete' and from_status = 'broadcasted' and to_status = 'completed')
      or (action_type = 'reject' and from_status in ('reserved', 'reviewing') and to_status = 'rejected')
      or (action_type = 'admin_takeover' and from_status in ('reviewing', 'send_locked', 'broadcasted') and to_status = from_status)
    ),
  constraint nowpayments_usdt_withdrawal_events_payload_check
    check (btrim(canonical_payload) <> ''),
  constraint nowpayments_usdt_withdrawal_events_result_check
    check (jsonb_typeof(result_snapshot) = 'object')
);

create index idx_nowpayments_usdt_withdrawal_events_withdrawal_created
  on public.nowpayments_usdt_withdrawal_events (withdrawal_id, created_at, id);

create table public.nowpayments_usdt_withdrawal_broadcasts (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null references public.nowpayments_usdt_withdrawals(id) on delete no action,
  recorded_by uuid not null references public.profiles(id) on delete no action,
  transaction_hash text not null,
  destination_address text not null,
  net_amount_usdt numeric(36, 6) not null,
  supersedes_broadcast_id uuid references public.nowpayments_usdt_withdrawal_broadcasts(id) on delete no action,
  correction_reason text,
  recorded_at timestamptz not null default now(),
  constraint nowpayments_usdt_withdrawal_broadcasts_hash_key unique (transaction_hash),
  constraint nowpayments_usdt_withdrawal_broadcasts_hash_check
    check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  constraint nowpayments_usdt_withdrawal_broadcasts_destination_check
    check (destination_address ~ '^0x[0-9a-f]{40}$'),
  constraint nowpayments_usdt_withdrawal_broadcasts_amount_check
    check (net_amount_usdt > 0 and net_amount_usdt = round(net_amount_usdt, 6)),
  constraint nowpayments_usdt_withdrawal_broadcasts_supersession_check
    check (
      (supersedes_broadcast_id is null and correction_reason is null)
      or (supersedes_broadcast_id is not null
        and correction_reason is not null and btrim(correction_reason) <> '')
    ),
  constraint nowpayments_usdt_withdrawal_broadcasts_superseded_once_key
    unique (supersedes_broadcast_id)
);

create index idx_nowpayments_usdt_withdrawal_broadcasts_withdrawal
  on public.nowpayments_usdt_withdrawal_broadcasts (withdrawal_id, recorded_at, id);

alter table public.nowpayments_usdt_withdrawals
  add constraint nowpayments_usdt_withdrawals_current_broadcast_fkey
  foreign key (current_broadcast_id)
  references public.nowpayments_usdt_withdrawal_broadcasts(id)
  on delete no action;

create table public.nowpayments_usdt_withdrawal_verifications (
  id uuid primary key default gen_random_uuid(),
  withdrawal_id uuid not null unique references public.nowpayments_usdt_withdrawals(id) on delete no action,
  broadcast_id uuid not null unique references public.nowpayments_usdt_withdrawal_broadcasts(id) on delete no action,
  verified_by uuid not null references public.profiles(id) on delete no action,
  chain_id integer not null,
  token_contract text not null,
  transaction_success boolean not null,
  exactly_one_matching_transfer boolean not null,
  destination_address text not null,
  net_amount_usdt numeric(36, 6) not null,
  block_number bigint not null,
  transfer_log_index integer not null,
  confirmations integer not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint nowpayments_usdt_withdrawal_verifications_chain_check check (chain_id = 56),
  constraint nowpayments_usdt_withdrawal_verifications_contract_check
    check (token_contract = '0x55d398326f99059ff775485246999027b3197955'),
  constraint nowpayments_usdt_withdrawal_verifications_success_check
    check (transaction_success = true and exactly_one_matching_transfer = true),
  constraint nowpayments_usdt_withdrawal_verifications_destination_check
    check (destination_address ~ '^0x[0-9a-f]{40}$'),
  constraint nowpayments_usdt_withdrawal_verifications_amount_check
    check (net_amount_usdt > 0 and net_amount_usdt = round(net_amount_usdt, 6)),
  constraint nowpayments_usdt_withdrawal_verifications_block_check check (block_number > 0),
  constraint nowpayments_usdt_withdrawal_verifications_log_index_check check (transfer_log_index >= 0),
  constraint nowpayments_usdt_withdrawal_verifications_confirmation_check check (confirmations >= 120),
  constraint nowpayments_usdt_withdrawal_verifications_time_check check (verified_at <= created_at)
);

alter table public.nowpayments_usdt_withdrawal_events enable row level security;
alter table public.nowpayments_usdt_withdrawal_broadcasts enable row level security;
alter table public.nowpayments_usdt_withdrawal_verifications enable row level security;

create function public.is_canonical_uuid_v4(p_value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public
as $function$
  select p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$function$;

create function public.assert_safe_nowpayments_usdt_withdrawal_destination(p_value text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_address text := lower(btrim(p_value));
begin
  if p_value is null
    or v_address !~ '^0x[0-9a-f]{40}$'
    or v_address in (
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000001',
      '0x000000000000000000000000000000000000dead',
      '0xdead000000000000000000000000000000000000',
      '0xbe19677ee642cfe21fff5899b258f5010651c33e'
    )
  then
    raise exception 'invalid_nowpayments_usdt_withdrawal_destination';
  end if;

  if exists (
    select 1 from public.nowpayments_usdt_payments
    where pay_address is not null and lower(pay_address) = v_address
  ) or exists (
    select 1 from public.nowpayments_usdt_provider_payments
    where lower(pay_address) = v_address
  ) or exists (
    select 1 from public.crypto_deposit_addresses
    where lower(address) = v_address
  ) then
    raise exception 'qhash_controlled_withdrawal_destination';
  end if;

  return v_address;
end;
$function$;

create function public.reject_nowpayments_usdt_withdrawal_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'NOWPayments USDT withdrawal audit evidence is immutable';
end;
$function$;

create trigger reject_nowpayments_usdt_withdrawal_event_mutation
before update or delete or truncate on public.nowpayments_usdt_withdrawal_events
for each statement execute function public.reject_nowpayments_usdt_withdrawal_audit_mutation();

create trigger reject_nowpayments_usdt_withdrawal_broadcast_mutation
before update or delete or truncate on public.nowpayments_usdt_withdrawal_broadcasts
for each statement execute function public.reject_nowpayments_usdt_withdrawal_audit_mutation();

create trigger reject_nowpayments_usdt_withdrawal_verification_mutation
before update or delete or truncate on public.nowpayments_usdt_withdrawal_verifications
for each statement execute function public.reject_nowpayments_usdt_withdrawal_audit_mutation();

create function public.enforce_nowpayments_usdt_withdrawal_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.status in ('completed', 'rejected') then
    raise exception 'terminal_nowpayments_usdt_withdrawal_is_immutable';
  end if;

  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.destination_address <> old.destination_address
    or new.asset <> old.asset
    or new.network <> old.network
    or new.provider_currency <> old.provider_currency
    or new.gross_amount_usdt <> old.gross_amount_usdt
    or new.fee_percent <> old.fee_percent
    or new.fee_amount_usdt <> old.fee_amount_usdt
    or new.net_amount_usdt <> old.net_amount_usdt
    or new.requested_at <> old.requested_at
    or new.created_at <> old.created_at
    or new.initial_admin_id is distinct from old.initial_admin_id
       and old.initial_admin_id is not null
  then
    raise exception 'immutable_nowpayments_usdt_withdrawal_snapshot';
  end if;

  if not (
    (old.status = 'reserved' and new.status in ('reviewing', 'rejected'))
    or (old.status = 'reviewing' and new.status in ('reviewing', 'send_locked', 'rejected'))
    or (old.status = 'send_locked' and new.status in ('send_locked', 'broadcasted'))
    or (old.status = 'broadcasted' and new.status in ('broadcasted', 'completed'))
  ) then
    raise exception 'invalid_nowpayments_usdt_withdrawal_transition';
  end if;

  if old.status in ('send_locked', 'broadcasted')
    and new.current_admin_id is distinct from old.current_admin_id
    and new.status <> old.status
  then
    raise exception 'takeover_must_be_a_separate_audited_action';
  end if;

  return new;
end;
$function$;

create trigger enforce_nowpayments_usdt_withdrawal_immutability
before update on public.nowpayments_usdt_withdrawals
for each row execute function public.enforce_nowpayments_usdt_withdrawal_immutability();

create unique index nowpayments_usdt_ledger_entries_withdrawal_reserve_key
  on public.nowpayments_usdt_ledger_entries (withdrawal_id)
  where entry_type = 'withdrawal_reserve';
create unique index nowpayments_usdt_ledger_entries_withdrawal_terminal_key
  on public.nowpayments_usdt_ledger_entries (withdrawal_id)
  where entry_type in ('withdrawal_release', 'withdrawal_settlement');

create function public.request_nowpayments_usdt_withdrawal(
  p_user_id uuid,
  p_request_id text,
  p_gross_amount_usdt text,
  p_destination_address text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request_id uuid;
  v_gross numeric(36, 6);
  v_destination text;
  v_payload text;
  v_enabled boolean;
  v_is_frozen boolean;
  v_is_admin boolean;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_result jsonb;
  v_max numeric(36, 6);
begin
  if p_user_id is null
    or not public.is_canonical_uuid_v4(p_request_id)
    or p_gross_amount_usdt is null
    or p_gross_amount_usdt !~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,6})?$'
    or p_destination_address is null
  then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end if;

  begin
    v_request_id := p_request_id::uuid;
    v_gross := p_gross_amount_usdt::numeric(36, 6);
  exception when numeric_value_out_of_range then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end;

  v_destination := lower(btrim(p_destination_address));
  if v_destination !~ '^0x[0-9a-f]{40}$' or v_gross < 2 then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end if;
  v_payload := p_user_id::text || '|' || v_gross::text || '|' || v_destination;

  select is_frozen, is_admin into v_is_frozen, v_is_admin
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen or v_is_admin then
    raise exception 'nowpayments_usdt_withdrawal_user_ineligible';
  end if;

  select withdrawals_enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20'
  for share;
  if not found then
    raise exception 'nowpayments_usdt_configuration_missing';
  end if;

  select * into v_existing_event
  from public.nowpayments_usdt_withdrawal_events
  where action_id = v_request_id
  for update;
  if found then
    if v_existing_event.action_type <> 'request'
      or v_existing_event.user_id <> p_user_id
      or v_existing_event.actor_id <> p_user_id
      or v_existing_event.withdrawal_id <> v_request_id
      or v_existing_event.canonical_payload <> v_payload
    then
      raise exception 'nowpayments_usdt_action_id_conflict';
    end if;
    return v_existing_event.result_snapshot;
  end if;

  if not v_enabled then
    raise exception 'nowpayments_usdt_withdrawals_disabled';
  end if;

  v_destination := public.assert_safe_nowpayments_usdt_withdrawal_destination(v_destination);

  select * into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_max := trunc(v_wallet.available_balance_usdt * 1000000) / 1000000;
  if v_gross > v_max then
    raise exception 'insufficient_nowpayments_usdt_available_balance';
  end if;

  if exists (
    select 1 from public.nowpayments_usdt_withdrawals
    where user_id = p_user_id
      and status in ('reserved', 'reviewing', 'send_locked', 'broadcasted')
    for update
  ) then
    raise exception 'open_nowpayments_usdt_withdrawal_exists';
  end if;

  insert into public.nowpayments_usdt_withdrawals (
    id, user_id, destination_address, asset, network, provider_currency,
    gross_amount_usdt, fee_percent, status, requested_at
  ) values (
    v_request_id, p_user_id, v_destination, 'USDT', 'BEP20', 'usdtbsc',
    v_gross, 5, 'reserved', now()
  ) returning * into v_withdrawal;

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_wallet.available_balance_usdt - v_gross,
      reserved_balance_usdt = v_wallet.reserved_balance_usdt + v_gross,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    withdrawal_id, description, metadata
  ) values (
    p_user_id, 'withdrawal_reserve', 'USDT',
    -v_gross, v_gross,
    v_wallet.available_balance_usdt, v_wallet.available_balance_usdt - v_gross,
    v_wallet.reserved_balance_usdt, v_wallet.reserved_balance_usdt + v_gross,
    v_withdrawal.id, 'Manual USDT-BEP20 withdrawal gross amount reserved',
    jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
      'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
      'asset', 'USDT', 'network', 'BEP20'
    )
  );

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id,
    'status', 'reserved',
    'destination_address', v_withdrawal.destination_address,
    'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
    'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
    'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
    'available_balance_usdt', (v_wallet.available_balance_usdt - v_gross)::text,
    'reserved_balance_usdt', (v_wallet.reserved_balance_usdt + v_gross)::text
  );

  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, p_user_id, p_user_id, v_request_id, 'request',
    null, 'reserved', v_payload, v_result
  );

  return v_result;
end;
$function$;

create function public.claim_nowpayments_usdt_withdrawal_review(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_enabled boolean;
  v_admin_ok boolean;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_payload text;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
  then raise exception 'invalid_nowpayments_usdt_withdrawal_action'; end if;
  v_action_id := p_action_id::uuid;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text;

  select user_id into v_user_id
  from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;

  select * into v_withdrawal
  from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id
  for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;

  select is_admin and not is_frozen into v_admin_ok
  from public.profiles where id = p_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;

  select withdrawals_enabled into v_enabled
  from public.nowpayments_usdt_config where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event
  from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'claim_review'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if not v_enabled then raise exception 'nowpayments_usdt_withdrawals_disabled'; end if;
  if v_withdrawal.status <> 'reserved' then raise exception 'invalid_nowpayments_usdt_withdrawal_state'; end if;

  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;

  update public.nowpayments_usdt_withdrawals
  set status = 'reviewing', initial_admin_id = p_admin_id,
      current_admin_id = p_admin_id, claimed_at = now(), updated_at = now()
  where id = p_withdrawal_id
  returning * into v_withdrawal;

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', v_withdrawal.status,
    'current_admin_id', v_withdrawal.current_admin_id
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_admin_id, v_action_id, 'claim_review',
    'reserved', 'reviewing', v_payload, v_result
  );
  return v_result;
end;
$function$;

create function public.lock_nowpayments_usdt_withdrawal_send(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text,
  p_external_liquidity_confirmed boolean,
  p_destination_manually_verified boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_enabled boolean;
  v_admin_ok boolean;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_payload text;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
    or p_external_liquidity_confirmed is distinct from true
    or p_destination_manually_verified is distinct from true
  then raise exception 'invalid_nowpayments_usdt_withdrawal_action'; end if;
  v_action_id := p_action_id::uuid;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text || '|true|true';

  select user_id into v_user_id from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;
  select * into v_withdrawal from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  select is_admin and not is_frozen into v_admin_ok from public.profiles
  where id = p_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;
  select withdrawals_enabled into v_enabled from public.nowpayments_usdt_config
  where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'send_lock'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if not v_enabled then raise exception 'nowpayments_usdt_withdrawals_disabled'; end if;
  if v_withdrawal.status <> 'reviewing' or v_withdrawal.current_admin_id <> p_admin_id then
    raise exception 'invalid_nowpayments_usdt_withdrawal_owner_or_state';
  end if;

  perform public.assert_safe_nowpayments_usdt_withdrawal_destination(v_withdrawal.destination_address);
  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;

  update public.nowpayments_usdt_withdrawals
  set status = 'send_locked', send_locked_at = now(), updated_at = now()
  where id = p_withdrawal_id returning * into v_withdrawal;
  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', v_withdrawal.status,
    'destination_address', v_withdrawal.destination_address,
    'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
    'external_liquidity_confirmed', true,
    'destination_manually_verified', true
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_admin_id, v_action_id, 'send_lock',
    'reviewing', 'send_locked', v_payload, v_result
  );
  return v_result;
end;
$function$;

create function public.record_nowpayments_usdt_withdrawal_broadcast(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text,
  p_transaction_hash text,
  p_correction_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_flag boolean;
  v_hash text;
  v_reason text;
  v_payload text;
  v_from_status text;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_current_broadcast public.nowpayments_usdt_withdrawal_broadcasts%rowtype;
  v_broadcast public.nowpayments_usdt_withdrawal_broadcasts%rowtype;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
    or p_transaction_hash is null
  then raise exception 'invalid_nowpayments_usdt_withdrawal_broadcast'; end if;
  v_action_id := p_action_id::uuid;
  v_hash := lower(btrim(p_transaction_hash));
  v_reason := nullif(btrim(p_correction_reason), '');
  if v_hash !~ '^0x[0-9a-f]{64}$' or (v_reason is not null and char_length(v_reason) > 500) then
    raise exception 'invalid_nowpayments_usdt_withdrawal_broadcast';
  end if;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text || '|'
    || v_hash || '|' || coalesce(v_reason, '');

  select user_id into v_user_id from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;
  select * into v_withdrawal from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  select is_admin and not is_frozen into v_admin_ok from public.profiles
  where id = p_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;
  select withdrawals_enabled into v_flag from public.nowpayments_usdt_config
  where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'record_broadcast'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status not in ('send_locked', 'broadcasted')
    or v_withdrawal.current_admin_id <> p_admin_id
  then raise exception 'invalid_nowpayments_usdt_withdrawal_owner_or_state'; end if;

  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;

  v_from_status := v_withdrawal.status;
  if v_withdrawal.status = 'broadcasted' then
    select * into v_current_broadcast
    from public.nowpayments_usdt_withdrawal_broadcasts
    where id = v_withdrawal.current_broadcast_id
      and withdrawal_id = v_withdrawal.id
    for share;
    if not found then raise exception 'nowpayments_usdt_broadcast_evidence_missing'; end if;
    if v_reason is null or v_current_broadcast.transaction_hash = v_hash then
      raise exception 'broadcast_correction_requires_new_hash_and_reason';
    end if;
  elsif v_reason is not null then
    raise exception 'initial_broadcast_must_not_have_correction_reason';
  end if;

  insert into public.nowpayments_usdt_withdrawal_broadcasts (
    withdrawal_id, recorded_by, transaction_hash,
    destination_address, net_amount_usdt,
    supersedes_broadcast_id, correction_reason
  ) values (
    v_withdrawal.id, p_admin_id, v_hash,
    v_withdrawal.destination_address, v_withdrawal.net_amount_usdt,
    case when v_from_status = 'broadcasted' then v_current_broadcast.id else null end,
    v_reason
  ) returning * into v_broadcast;

  update public.nowpayments_usdt_withdrawals
  set status = 'broadcasted',
      current_broadcast_id = v_broadcast.id,
      broadcasted_at = coalesce(broadcasted_at, now()),
      updated_at = now()
  where id = v_withdrawal.id
  returning * into v_withdrawal;

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', 'broadcasted',
    'broadcast_id', v_broadcast.id, 'transaction_hash', v_broadcast.transaction_hash
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_admin_id, v_action_id, 'record_broadcast',
    v_from_status, 'broadcasted', v_payload, v_result
  );
  return v_result;
end;
$function$;

create function public.complete_nowpayments_usdt_withdrawal(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text,
  p_transaction_hash text,
  p_chain_id integer,
  p_token_contract text,
  p_transaction_success boolean,
  p_exactly_one_matching_transfer boolean,
  p_destination_address text,
  p_net_amount_usdt text,
  p_block_number bigint,
  p_transfer_log_index integer,
  p_confirmations integer,
  p_verified_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_flag boolean;
  v_hash text;
  v_contract text;
  v_destination text;
  v_net numeric(36, 6);
  v_payload text;
  v_created_at timestamptz := clock_timestamp();
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_broadcast public.nowpayments_usdt_withdrawal_broadcasts%rowtype;
  v_verification public.nowpayments_usdt_withdrawal_verifications%rowtype;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
    or p_transaction_hash is null or p_token_contract is null
    or p_destination_address is null or p_net_amount_usdt is null
    or p_net_amount_usdt !~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,6})?$'
    or p_verified_at is null
  then raise exception 'invalid_nowpayments_usdt_withdrawal_verification'; end if;
  v_action_id := p_action_id::uuid;
  v_hash := lower(btrim(p_transaction_hash));
  v_contract := lower(btrim(p_token_contract));
  v_destination := lower(btrim(p_destination_address));
  begin
    v_net := p_net_amount_usdt::numeric(36, 6);
  exception when numeric_value_out_of_range then
    raise exception 'invalid_nowpayments_usdt_withdrawal_verification';
  end;
  if v_hash !~ '^0x[0-9a-f]{64}$'
    or v_destination !~ '^0x[0-9a-f]{40}$'
    or p_chain_id <> 56
    or v_contract <> '0x55d398326f99059ff775485246999027b3197955'
    or p_transaction_success is distinct from true
    or p_exactly_one_matching_transfer is distinct from true
    or v_net <= 0
    or p_block_number is null or p_block_number <= 0
    or p_transfer_log_index is null or p_transfer_log_index < 0
    or p_confirmations is null or p_confirmations < 120
    or p_verified_at > v_created_at
  then raise exception 'invalid_nowpayments_usdt_withdrawal_verification'; end if;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text || '|' || v_hash
    || '|' || p_chain_id::text || '|' || v_contract || '|true|true|'
    || v_destination || '|' || v_net::text || '|' || p_block_number::text
    || '|' || p_transfer_log_index::text || '|' || p_confirmations::text
    || '|' || p_verified_at::text;

  select user_id into v_user_id from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;
  select * into v_withdrawal from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  select is_admin and not is_frozen into v_admin_ok from public.profiles
  where id = p_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;
  select withdrawals_enabled into v_flag from public.nowpayments_usdt_config
  where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'complete'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status <> 'broadcasted' or v_withdrawal.current_admin_id <> p_admin_id then
    raise exception 'invalid_nowpayments_usdt_withdrawal_owner_or_state';
  end if;
  select * into v_broadcast from public.nowpayments_usdt_withdrawal_broadcasts
  where id = v_withdrawal.current_broadcast_id
    and withdrawal_id = v_withdrawal.id
  for share;
  if not found
    or v_broadcast.transaction_hash <> v_hash
    or v_broadcast.destination_address <> v_withdrawal.destination_address
    or v_broadcast.net_amount_usdt <> v_withdrawal.net_amount_usdt
    or v_destination <> v_withdrawal.destination_address
    or v_net <> v_withdrawal.net_amount_usdt
  then raise exception 'nowpayments_usdt_withdrawal_verification_mismatch'; end if;

  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;

  insert into public.nowpayments_usdt_withdrawal_verifications (
    withdrawal_id, broadcast_id, verified_by, chain_id, token_contract,
    transaction_success, exactly_one_matching_transfer,
    destination_address, net_amount_usdt, block_number,
    transfer_log_index, confirmations, verified_at, created_at
  ) values (
    v_withdrawal.id, v_broadcast.id, p_admin_id, 56, v_contract,
    true, true, v_destination, v_net, p_block_number,
    p_transfer_log_index, p_confirmations, p_verified_at, v_created_at
  ) returning * into v_verification;

  update public.nowpayments_usdt_wallets
  set reserved_balance_usdt = v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    withdrawal_id, description, metadata
  ) values (
    v_user_id, 'withdrawal_settlement', 'USDT',
    0, -v_withdrawal.gross_amount_usdt,
    v_wallet.available_balance_usdt, v_wallet.available_balance_usdt,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
    v_withdrawal.id, 'Verified manual USDT-BEP20 withdrawal settled',
    jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
      'chain_id', 56,
      'token_contract', v_contract,
      'transaction_hash', v_hash,
      'block_number', p_block_number,
      'transfer_log_index', p_transfer_log_index,
      'confirmations', p_confirmations
    )
  );

  update public.nowpayments_usdt_withdrawals
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_withdrawal.id returning * into v_withdrawal;

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', 'completed',
    'transaction_hash', v_hash,
    'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
    'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
    'available_balance_usdt', v_wallet.available_balance_usdt::text,
    'reserved_balance_usdt',
      (v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt)::text
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_admin_id, v_action_id, 'complete',
    'broadcasted', 'completed', v_payload, v_result
  );
  return v_result;
end;
$function$;

create function public.reject_nowpayments_usdt_withdrawal(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_flag boolean;
  v_reason text;
  v_payload text;
  v_from_status text;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_result jsonb;
begin
  v_reason := nullif(btrim(p_reason), '');
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
    or v_reason is null or char_length(v_reason) > 500
  then raise exception 'invalid_nowpayments_usdt_withdrawal_rejection'; end if;
  v_action_id := p_action_id::uuid;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text || '|' || v_reason;

  select user_id into v_user_id from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;
  select * into v_withdrawal from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  select is_admin and not is_frozen into v_admin_ok from public.profiles
  where id = p_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;
  select withdrawals_enabled into v_flag from public.nowpayments_usdt_config
  where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'reject'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status not in ('reserved', 'reviewing')
    or (v_withdrawal.status = 'reviewing' and v_withdrawal.current_admin_id <> p_admin_id)
  then raise exception 'withdrawal_cannot_be_rejected_after_send_lock'; end if;

  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;
  v_from_status := v_withdrawal.status;

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt,
      reserved_balance_usdt = v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    withdrawal_id, description, metadata
  ) values (
    v_user_id, 'withdrawal_release', 'USDT',
    v_withdrawal.gross_amount_usdt, -v_withdrawal.gross_amount_usdt,
    v_wallet.available_balance_usdt,
    v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
    v_withdrawal.id, 'Rejected manual USDT-BEP20 withdrawal fully released',
    jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'fee_retained_usdt', '0', 'reason', v_reason
    )
  );

  update public.nowpayments_usdt_withdrawals
  set status = 'rejected', rejected_at = now(),
      rejection_reason = v_reason, updated_at = now()
  where id = v_withdrawal.id returning * into v_withdrawal;

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', 'rejected',
    'available_balance_usdt',
      (v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt)::text,
    'reserved_balance_usdt',
      (v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt)::text
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_admin_id, v_action_id, 'reject',
    v_from_status, 'rejected', v_payload, v_result
  );
  return v_result;
end;
$function$;

create function public.take_over_nowpayments_usdt_withdrawal(
  p_withdrawal_id uuid,
  p_new_admin_id uuid,
  p_action_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_flag boolean;
  v_reason text;
  v_payload text;
  v_previous_admin_id uuid;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_result jsonb;
begin
  v_reason := nullif(btrim(p_reason), '');
  if p_withdrawal_id is null or p_new_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
    or v_reason is null or char_length(v_reason) > 500
  then raise exception 'invalid_nowpayments_usdt_withdrawal_takeover'; end if;
  v_action_id := p_action_id::uuid;
  v_payload := p_withdrawal_id::text || '|' || p_new_admin_id::text || '|' || v_reason;

  select user_id into v_user_id from public.nowpayments_usdt_withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_user_missing'; end if;
  select * into v_withdrawal from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id for update;
  if not found then raise exception 'nowpayments_usdt_withdrawal_not_found'; end if;
  select is_admin and not is_frozen into v_admin_ok from public.profiles
  where id = p_new_admin_id for share;
  if not found or not v_admin_ok then raise exception 'nowpayments_usdt_admin_ineligible'; end if;
  select withdrawals_enabled into v_flag from public.nowpayments_usdt_config
  where id = 'USDT-BEP20' for share;
  if not found then raise exception 'nowpayments_usdt_configuration_missing'; end if;

  select * into v_existing_event from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id for update;
  if found then
    if v_existing_event.action_type <> 'admin_takeover'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_new_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then raise exception 'nowpayments_usdt_action_id_conflict'; end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status not in ('reviewing', 'send_locked', 'broadcasted')
    or v_withdrawal.current_admin_id = p_new_admin_id
  then raise exception 'invalid_nowpayments_usdt_withdrawal_takeover_state'; end if;
  v_previous_admin_id := v_withdrawal.current_admin_id;

  select * into v_wallet from public.nowpayments_usdt_wallets
  where user_id = v_user_id for update;
  if not found or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;

  update public.nowpayments_usdt_withdrawals
  set current_admin_id = p_new_admin_id, updated_at = now()
  where id = v_withdrawal.id returning * into v_withdrawal;
  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id, 'status', v_withdrawal.status,
    'initial_admin_id', v_withdrawal.initial_admin_id,
    'previous_admin_id', v_previous_admin_id,
    'current_admin_id', v_withdrawal.current_admin_id
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, v_user_id, p_new_admin_id, v_action_id, 'admin_takeover',
    v_withdrawal.status, v_withdrawal.status, v_payload, v_result
  );
  return v_result;
end;
$function$;

revoke all on table public.nowpayments_usdt_withdrawals
  from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_withdrawal_events
  from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_withdrawal_broadcasts
  from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_withdrawal_verifications
  from public, anon, authenticated, service_role;

grant select on table public.nowpayments_usdt_withdrawals to service_role;
grant select on table public.nowpayments_usdt_withdrawal_events to service_role;
grant select on table public.nowpayments_usdt_withdrawal_broadcasts to service_role;
grant select on table public.nowpayments_usdt_withdrawal_verifications to service_role;

revoke all on function public.is_canonical_uuid_v4(text)
  from public, anon, authenticated, service_role;
revoke all on function public.assert_safe_nowpayments_usdt_withdrawal_destination(text)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_nowpayments_usdt_withdrawal_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_nowpayments_usdt_withdrawal_immutability()
  from public, anon, authenticated, service_role;

revoke all on function public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.claim_nowpayments_usdt_withdrawal_review(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.lock_nowpayments_usdt_withdrawal_send(uuid,uuid,text,boolean,boolean)
  from public, anon, authenticated;
revoke all on function public.record_nowpayments_usdt_withdrawal_broadcast(uuid,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)
  from public, anon, authenticated;
revoke all on function public.reject_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.take_over_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  from public, anon, authenticated;

grant execute on function public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
  to service_role;
grant execute on function public.claim_nowpayments_usdt_withdrawal_review(uuid,uuid,text)
  to service_role;
grant execute on function public.lock_nowpayments_usdt_withdrawal_send(uuid,uuid,text,boolean,boolean)
  to service_role;
grant execute on function public.record_nowpayments_usdt_withdrawal_broadcast(uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)
  to service_role;
grant execute on function public.reject_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  to service_role;
grant execute on function public.take_over_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  to service_role;

comment on column public.nowpayments_usdt_config.withdrawals_enabled is
  'Independent manual USDT-BEP20 withdrawal gate. Defaults false and does not affect deposits.';
comment on table public.nowpayments_usdt_withdrawals is
  'Manual USDT-BEP20 withdrawal liabilities with an irreversible send_locked boundary; no provider payout integration.';
comment on table public.nowpayments_usdt_withdrawal_events is
  'Append-only idempotency and state-transition audit events for manual USDT-BEP20 withdrawals.';
comment on table public.nowpayments_usdt_withdrawal_broadcasts is
  'Append-only normalized BSC transaction-hash evidence, including audited hash supersession before completion.';
comment on table public.nowpayments_usdt_withdrawal_verifications is
  'Immutable manual verification evidence for one successful, unambiguous USDT Transfer on BSC mainnet with at least 120 confirmations.';

do $postflight$
begin
  if (select count(*) from public.nowpayments_usdt_withdrawals) <> 0
    or (select count(*) from public.nowpayments_usdt_withdrawal_events) <> 0
    or (select count(*) from public.nowpayments_usdt_withdrawal_broadcasts) <> 0
    or (select count(*) from public.nowpayments_usdt_withdrawal_verifications) <> 0
    or not exists (
      select 1 from public.nowpayments_usdt_config
      where id = 'USDT-BEP20' and withdrawals_enabled = false
    )
  then
    raise exception 'unexpected NOWPayments USDT withdrawal migration result';
  end if;

  if has_table_privilege('anon', 'public.nowpayments_usdt_withdrawals', 'SELECT')
    or has_table_privilege('authenticated', 'public.nowpayments_usdt_withdrawals', 'SELECT')
    or has_function_privilege('anon', 'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)', 'EXECUTE')
  then
    raise exception 'unexpected NOWPayments USDT withdrawal grants';
  end if;
end;
$postflight$;
