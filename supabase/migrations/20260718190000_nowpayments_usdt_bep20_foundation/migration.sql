-- Disabled-by-default NOWPayments USDT-BEP20 database foundation.
--
-- This migration intentionally adds no provider API client, webhook handler,
-- user/admin UI, secrets, or production enablement. It also leaves QHash's ETB
-- wallets, CBE/TeleBirr flows, plan_purchase ledger entries, and immutable
-- retired native-crypto evidence unchanged.

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public._qhash_migrations') is null then
    raise exception 'public._qhash_migrations is missing';
  end if;

  if to_regclass('public.profiles') is null
    or to_regclass('public.wallets') is null
    or to_regclass('public.transactions') is null
    or to_regclass('public.payment_methods') is null
    or to_regclass('public.crypto_deposit_addresses') is null
    or to_regclass('public.crypto_deposits') is null
  then
    raise exception 'Required QHash financial or audit foundation is incomplete';
  end if;

  if to_regprocedure('public.reject_retired_native_crypto_evidence_mutation()') is null then
    raise exception 'Retired native-crypto evidence is not protected';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'service_role is missing';
  end if;

  if to_regclass('public.nowpayments_usdt_config') is not null
    or to_regclass('public.nowpayments_usdt_wallets') is not null
    or to_regclass('public.nowpayments_usdt_payments') is not null
    or to_regclass('public.nowpayments_usdt_withdrawals') is not null
    or to_regclass('public.nowpayments_usdt_ledger_entries') is not null
    or to_regprocedure('public.credit_verified_nowpayments_usdt_payment(uuid,text,text)') is not null
  then
    raise exception 'NOWPayments USDT foundation already exists outside migration tracking';
  end if;
end;
$preflight$;

create table public.nowpayments_usdt_config (
  id text primary key default 'USDT-BEP20',
  enabled boolean not null default false,
  asset text not null default 'USDT',
  network text not null default 'BEP20',
  provider_currency text not null default 'usdtbsc',
  deposit_minimum_usdt numeric(36, 6) not null default 1,
  withdrawal_minimum_usdt numeric(36, 6) not null default 2,
  withdrawal_fee_percent numeric(7, 4) not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nowpayments_usdt_config_singleton_check
    check (id = 'USDT-BEP20'),
  constraint nowpayments_usdt_config_asset_check
    check (asset = 'USDT'),
  constraint nowpayments_usdt_config_network_check
    check (network = 'BEP20'),
  constraint nowpayments_usdt_config_provider_currency_check
    check (provider_currency = 'usdtbsc'),
  constraint nowpayments_usdt_config_deposit_minimum_check
    check (deposit_minimum_usdt = 1),
  constraint nowpayments_usdt_config_withdrawal_minimum_check
    check (withdrawal_minimum_usdt = 2),
  constraint nowpayments_usdt_config_withdrawal_fee_check
    check (withdrawal_fee_percent = 5)
);

create table public.nowpayments_usdt_wallets (
  user_id uuid primary key references public.profiles(id),
  asset text not null default 'USDT',
  available_balance_usdt numeric(36, 6) not null default 0,
  reserved_balance_usdt numeric(36, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nowpayments_usdt_wallets_asset_check
    check (asset = 'USDT'),
  constraint nowpayments_usdt_wallets_available_balance_check
    check (available_balance_usdt >= 0),
  constraint nowpayments_usdt_wallets_reserved_balance_check
    check (reserved_balance_usdt >= 0)
);

create table public.nowpayments_usdt_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  provider_payment_id text not null,
  provider_payment_status text not null default 'waiting',
  verification_status text not null default 'pending',
  asset text not null default 'USDT',
  network text not null default 'BEP20',
  provider_currency text not null default 'usdtbsc',
  requested_amount_usdt numeric(36, 6) not null,
  outcome_amount numeric(36, 6),
  outcome_currency text not null default 'USDT',
  verified_at timestamptz,
  credited_amount_usdt numeric(36, 6),
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nowpayments_usdt_payments_provider_payment_id_key
    unique (provider_payment_id),
  constraint nowpayments_usdt_payments_provider_payment_id_check
    check (btrim(provider_payment_id) <> ''),
  constraint nowpayments_usdt_payments_provider_status_check
    check (btrim(provider_payment_status) <> ''),
  constraint nowpayments_usdt_payments_verification_status_check
    check (verification_status in ('pending', 'verified', 'rejected')),
  constraint nowpayments_usdt_payments_asset_check
    check (asset = 'USDT'),
  constraint nowpayments_usdt_payments_network_check
    check (network = 'BEP20'),
  constraint nowpayments_usdt_payments_provider_currency_check
    check (provider_currency = 'usdtbsc'),
  constraint nowpayments_usdt_payments_minimum_check
    check (requested_amount_usdt >= 1),
  constraint nowpayments_usdt_payments_outcome_amount_check
    check (outcome_amount is null or outcome_amount > 0),
  constraint nowpayments_usdt_payments_outcome_currency_check
    check (outcome_currency = 'USDT'),
  constraint nowpayments_usdt_payments_verification_check
    check (
      (
        verification_status = 'verified'
        and provider_payment_status = 'finished'
        and outcome_amount is not null
        and verified_at is not null
      )
      or (
        verification_status <> 'verified'
        and verified_at is null
      )
    ),
  constraint nowpayments_usdt_payments_credit_check
    check (
      (
        credited_amount_usdt is null
        and credited_at is null
      )
      or (
        verification_status = 'verified'
        and provider_payment_status = 'finished'
        and outcome_amount is not null
        and credited_amount_usdt = outcome_amount
        and credited_at is not null
      )
    )
);

create index idx_nowpayments_usdt_payments_user_created
  on public.nowpayments_usdt_payments (user_id, created_at desc);

create index idx_nowpayments_usdt_payments_status
  on public.nowpayments_usdt_payments (
    provider_payment_status,
    verification_status,
    credited_at
  );

create table public.nowpayments_usdt_withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  destination_address text not null,
  asset text not null default 'USDT',
  network text not null default 'BEP20',
  provider_currency text not null default 'usdtbsc',
  amount_usdt numeric(36, 6) not null,
  fee_percent numeric(7, 4) not null default 5,
  fee_amount_usdt numeric(36, 6)
    generated always as (round(amount_usdt * fee_percent / 100, 6)) stored,
  net_amount_usdt numeric(36, 6)
    generated always as (amount_usdt - round(amount_usdt * fee_percent / 100, 6)) stored,
  status text not null default 'requested',
  provider_payout_id text,
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  finished_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nowpayments_usdt_withdrawals_destination_check
    check (btrim(destination_address) <> ''),
  constraint nowpayments_usdt_withdrawals_asset_check
    check (asset = 'USDT'),
  constraint nowpayments_usdt_withdrawals_network_check
    check (network = 'BEP20'),
  constraint nowpayments_usdt_withdrawals_provider_currency_check
    check (provider_currency = 'usdtbsc'),
  constraint nowpayments_usdt_withdrawals_minimum_check
    check (amount_usdt >= 2),
  constraint nowpayments_usdt_withdrawals_fee_percent_check
    check (fee_percent = 5),
  constraint nowpayments_usdt_withdrawals_net_amount_check
    check (net_amount_usdt > 0),
  constraint nowpayments_usdt_withdrawals_status_check
    check (status in ('requested', 'reserved', 'submitted', 'finished', 'failed', 'refunded', 'cancelled')),
  constraint nowpayments_usdt_withdrawals_provider_payout_id_key
    unique (provider_payout_id),
  constraint nowpayments_usdt_withdrawals_provider_payout_id_check
    check (provider_payout_id is null or btrim(provider_payout_id) <> ''),
  constraint nowpayments_usdt_withdrawals_terminal_timestamps_check
    check (
      (status = 'finished' and finished_at is not null and failed_at is null)
      or (status = 'failed' and failed_at is not null and finished_at is null)
      or (status not in ('finished', 'failed') and finished_at is null and failed_at is null)
    )
);

create index idx_nowpayments_usdt_withdrawals_user_created
  on public.nowpayments_usdt_withdrawals (user_id, created_at desc);

create index idx_nowpayments_usdt_withdrawals_status
  on public.nowpayments_usdt_withdrawals (status, created_at);

create table public.nowpayments_usdt_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  entry_type text not null,
  asset text not null default 'USDT',
  available_delta_usdt numeric(36, 6) not null default 0,
  reserved_delta_usdt numeric(36, 6) not null default 0,
  available_before_usdt numeric(36, 6) not null,
  available_after_usdt numeric(36, 6) not null,
  reserved_before_usdt numeric(36, 6) not null,
  reserved_after_usdt numeric(36, 6) not null,
  payment_id uuid references public.nowpayments_usdt_payments(id),
  withdrawal_id uuid references public.nowpayments_usdt_withdrawals(id),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint nowpayments_usdt_ledger_entries_type_check
    check (entry_type in (
      'deposit_credit',
      'withdrawal_reserve',
      'withdrawal_release',
      'withdrawal_settlement',
      'admin_adjustment'
    )),
  constraint nowpayments_usdt_ledger_entries_asset_check
    check (asset = 'USDT'),
  constraint nowpayments_usdt_ledger_entries_delta_check
    check (available_delta_usdt <> 0 or reserved_delta_usdt <> 0),
  constraint nowpayments_usdt_ledger_entries_available_arithmetic_check
    check (available_after_usdt = available_before_usdt + available_delta_usdt),
  constraint nowpayments_usdt_ledger_entries_reserved_arithmetic_check
    check (reserved_after_usdt = reserved_before_usdt + reserved_delta_usdt),
  constraint nowpayments_usdt_ledger_entries_balances_check
    check (
      available_before_usdt >= 0
      and available_after_usdt >= 0
      and reserved_before_usdt >= 0
      and reserved_after_usdt >= 0
    ),
  constraint nowpayments_usdt_ledger_entries_reference_check
    check (
      (entry_type = 'deposit_credit' and payment_id is not null and withdrawal_id is null)
      or (
        entry_type in ('withdrawal_reserve', 'withdrawal_release', 'withdrawal_settlement')
        and payment_id is null
        and withdrawal_id is not null
      )
      or (entry_type = 'admin_adjustment' and payment_id is null and withdrawal_id is null)
    )
);

create unique index nowpayments_usdt_ledger_entries_payment_credit_key
  on public.nowpayments_usdt_ledger_entries (payment_id)
  where entry_type = 'deposit_credit';

create index idx_nowpayments_usdt_ledger_entries_user_created
  on public.nowpayments_usdt_ledger_entries (user_id, created_at desc);

create index idx_nowpayments_usdt_ledger_entries_withdrawal
  on public.nowpayments_usdt_ledger_entries (withdrawal_id)
  where withdrawal_id is not null;

alter table public.nowpayments_usdt_config enable row level security;
alter table public.nowpayments_usdt_wallets enable row level security;
alter table public.nowpayments_usdt_payments enable row level security;
alter table public.nowpayments_usdt_withdrawals enable row level security;
alter table public.nowpayments_usdt_ledger_entries enable row level security;

create function public.set_nowpayments_usdt_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create trigger set_nowpayments_usdt_config_updated_at
before update on public.nowpayments_usdt_config
for each row execute function public.set_nowpayments_usdt_updated_at();

create trigger set_nowpayments_usdt_wallets_updated_at
before update on public.nowpayments_usdt_wallets
for each row execute function public.set_nowpayments_usdt_updated_at();

create trigger set_nowpayments_usdt_payments_updated_at
before update on public.nowpayments_usdt_payments
for each row execute function public.set_nowpayments_usdt_updated_at();

create trigger set_nowpayments_usdt_withdrawals_updated_at
before update on public.nowpayments_usdt_withdrawals
for each row execute function public.set_nowpayments_usdt_updated_at();

create function public.reject_nowpayments_usdt_ledger_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'NOWPayments USDT ledger entries are immutable';
end;
$function$;

create trigger reject_nowpayments_usdt_ledger_mutation
before update or delete or truncate on public.nowpayments_usdt_ledger_entries
for each statement execute function public.reject_nowpayments_usdt_ledger_mutation();

create function public.credit_verified_nowpayments_usdt_payment(
  p_payment_id uuid,
  p_expected_provider_payment_id text,
  p_expected_outcome_amount text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean;
  v_expected_outcome_amount numeric(36, 6);
  v_payment public.nowpayments_usdt_payments%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_ledger_id uuid;
  v_available_after numeric(36, 6);
begin
  if p_payment_id is null
    or p_expected_provider_payment_id is null
    or btrim(p_expected_provider_payment_id) = ''
    or p_expected_outcome_amount is null
    or p_expected_outcome_amount !~ '^[0-9]+(\.[0-9]{1,6})?$'
  then
    raise exception 'invalid_nowpayments_payment_credit_input';
  end if;

  begin
    v_expected_outcome_amount := p_expected_outcome_amount::numeric(36, 6);
  exception
    when numeric_value_out_of_range then
      raise exception 'invalid_nowpayments_payment_credit_input';
  end;

  if v_expected_outcome_amount <= 0 then
    raise exception 'invalid_nowpayments_payment_credit_input';
  end if;

  select enabled
    into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';

  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select *
    into v_payment
  from public.nowpayments_usdt_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'nowpayments_payment_not_found';
  end if;

  if v_payment.provider_payment_id <> p_expected_provider_payment_id
    or v_payment.provider_payment_status <> 'finished'
    or v_payment.verification_status <> 'verified'
    or v_payment.verified_at is null
    or v_payment.asset <> 'USDT'
    or v_payment.network <> 'BEP20'
    or v_payment.provider_currency <> 'usdtbsc'
    or v_payment.outcome_currency <> 'USDT'
    or v_payment.outcome_amount is null
    or v_payment.outcome_amount <> v_expected_outcome_amount
  then
    raise exception 'nowpayments_payment_credit_verification_failed';
  end if;

  if v_payment.credited_at is not null then
    if v_payment.credited_amount_usdt <> v_expected_outcome_amount then
      raise exception 'nowpayments_payment_credit_mismatch';
    end if;

    select id
      into v_ledger_id
    from public.nowpayments_usdt_ledger_entries
    where payment_id = v_payment.id
      and entry_type = 'deposit_credit';

    if not found then
      raise exception 'nowpayments_payment_credit_ledger_missing';
    end if;

    return jsonb_build_object(
      'status', 'already_credited',
      'payment_id', v_payment.id,
      'ledger_entry_id', v_ledger_id,
      'asset', 'USDT',
      'credited_amount_usdt', v_expected_outcome_amount::text
    );
  end if;

  insert into public.nowpayments_usdt_wallets (user_id)
  values (v_payment.user_id)
  on conflict (user_id) do nothing;

  select *
    into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = v_payment.user_id
  for update;

  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_available_after := v_wallet.available_balance_usdt + v_expected_outcome_amount;
  v_ledger_id := gen_random_uuid();

  insert into public.nowpayments_usdt_ledger_entries (
    id,
    user_id,
    entry_type,
    asset,
    available_delta_usdt,
    reserved_delta_usdt,
    available_before_usdt,
    available_after_usdt,
    reserved_before_usdt,
    reserved_after_usdt,
    payment_id,
    description,
    metadata
  ) values (
    v_ledger_id,
    v_payment.user_id,
    'deposit_credit',
    'USDT',
    v_expected_outcome_amount,
    0,
    v_wallet.available_balance_usdt,
    v_available_after,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt,
    v_payment.id,
    'Verified NOWPayments USDT-BEP20 deposit credited',
    jsonb_build_object(
      'provider', 'NOWPayments',
      'provider_payment_id', v_payment.provider_payment_id,
      'provider_payment_status', 'finished',
      'source_amount_field', 'outcome_amount',
      'asset', 'USDT',
      'network', 'BEP20'
    )
  );

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_available_after,
      updated_at = now()
  where user_id = v_payment.user_id;

  update public.nowpayments_usdt_payments
  set credited_amount_usdt = v_expected_outcome_amount,
      credited_at = now(),
      updated_at = now()
  where id = v_payment.id;

  return jsonb_build_object(
    'status', 'credited',
    'payment_id', v_payment.id,
    'ledger_entry_id', v_ledger_id,
    'asset', 'USDT',
    'credited_amount_usdt', v_expected_outcome_amount::text,
    'available_balance_usdt', v_available_after::text,
    'reserved_balance_usdt', v_wallet.reserved_balance_usdt::text
  );
end;
$function$;

insert into public.nowpayments_usdt_config (id)
values ('USDT-BEP20');

revoke all on table public.nowpayments_usdt_config from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_wallets from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_payments from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_withdrawals from public, anon, authenticated, service_role;
revoke all on table public.nowpayments_usdt_ledger_entries from public, anon, authenticated, service_role;

grant select on table public.nowpayments_usdt_config to service_role;
grant select on table public.nowpayments_usdt_wallets to service_role;
grant select on table public.nowpayments_usdt_payments to service_role;
grant insert (
  user_id,
  provider_payment_id,
  provider_payment_status,
  verification_status,
  asset,
  network,
  provider_currency,
  requested_amount_usdt,
  outcome_amount,
  outcome_currency,
  verified_at
) on public.nowpayments_usdt_payments to service_role;
grant update (
  provider_payment_status,
  verification_status,
  outcome_amount,
  verified_at,
  updated_at
) on public.nowpayments_usdt_payments to service_role;
grant select on table public.nowpayments_usdt_withdrawals to service_role;
grant insert (
  user_id,
  destination_address,
  asset,
  network,
  provider_currency,
  amount_usdt,
  fee_percent,
  status,
  provider_payout_id,
  requested_at,
  submitted_at,
  finished_at,
  failed_at,
  failure_code
) on public.nowpayments_usdt_withdrawals to service_role;
grant update (
  status,
  provider_payout_id,
  submitted_at,
  finished_at,
  failed_at,
  failure_code,
  updated_at
) on public.nowpayments_usdt_withdrawals to service_role;
grant select on table public.nowpayments_usdt_ledger_entries to service_role;

revoke all on function public.set_nowpayments_usdt_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.reject_nowpayments_usdt_ledger_mutation() from public, anon, authenticated, service_role;
revoke all on function public.credit_verified_nowpayments_usdt_payment(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_verified_nowpayments_usdt_payment(uuid, text, text) to service_role;

comment on table public.nowpayments_usdt_config is
  'Disabled-by-default USDT-BEP20 configuration. Locked foundation rules: 1 USDT deposit minimum, 2 USDT withdrawal minimum, and 5 percent withdrawal fee.';

comment on table public.nowpayments_usdt_wallets is
  'USDT-only balances for NOWPayments. Available and reserved balances are separate and never represent ETB.';

comment on table public.nowpayments_usdt_payments is
  'NOWPayments USDT-BEP20 payment records. Only verified finished payments may be credited, using net outcome_amount.';

comment on table public.nowpayments_usdt_withdrawals is
  'NOWPayments USDT-BEP20 withdrawal foundation with a 2 USDT gross minimum and generated 5 percent fee.';

comment on table public.nowpayments_usdt_ledger_entries is
  'Immutable USDT-only balance ledger, separate from QHash transactions and its ETB plan_purchase history.';

comment on function public.credit_verified_nowpayments_usdt_payment(uuid, text, text) is
  'Atomically and idempotently credits the exact net outcome_amount for one verified finished NOWPayments USDT-BEP20 payment. Refuses all credits while the foundation is disabled.';
