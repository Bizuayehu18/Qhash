-- Production-only NOWPayments USDTBSC IPN settlement foundation.
--
-- This forward-only migration separates address-session evidence from the
-- provider payments received at that address. It permits independently
-- verified settlement while deposit generation is disabled, but it adds no
-- UI, withdrawals, payouts, sweeping, signing, or automatic fund movement.

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_withdrawals') is null
    or to_regclass('public.nowpayments_usdt_ledger_entries') is null
    or to_regprocedure('public.credit_verified_nowpayments_usdt_payment(uuid,text,text)') is null
    or to_regprocedure('public.record_nowpayments_usdt_deposit_session_status(uuid,uuid,text,text)') is null
  then
    raise exception 'NOWPayments USDT session foundation is incomplete';
  end if;

  if not exists (
    select 1
    from public.nowpayments_usdt_config
    where id = 'USDT-BEP20'
      and enabled = false
      and asset = 'USDT'
      and network = 'BEP20'
      and provider_currency = 'usdtbsc'
      and deposit_minimum_usdt = 1
      and withdrawal_minimum_usdt = 2
      and withdrawal_fee_percent = 5
  ) then
    raise exception 'NOWPayments USDT foundation is not in its locked disabled state';
  end if;

  if exists (select 1 from public.nowpayments_usdt_wallets)
    or exists (select 1 from public.nowpayments_usdt_payments)
    or exists (select 1 from public.nowpayments_usdt_withdrawals)
    or exists (select 1 from public.nowpayments_usdt_ledger_entries)
  then
    raise exception 'NOWPayments operational tables must be empty before IPN settlement migration';
  end if;

  if to_regclass('public.nowpayments_usdt_provider_payments') is not null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)') is not null
    or exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'nowpayments_usdt_payments'
        and column_name = 'settled_by_provider_payment_id'
    )
  then
    raise exception 'NOWPayments IPN settlement objects already exist outside migration tracking';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'service_role is missing';
  end if;
end;
$preflight$;

-- Preserve exact provider decimal strings through PostgreSQL numeric math.
alter table public.nowpayments_usdt_wallets
  alter column available_balance_usdt type numeric(36, 18)
    using available_balance_usdt::numeric(36, 18),
  alter column reserved_balance_usdt type numeric(36, 18)
    using reserved_balance_usdt::numeric(36, 18);

alter table public.nowpayments_usdt_payments
  alter column outcome_amount type numeric(36, 18)
    using outcome_amount::numeric(36, 18),
  alter column credited_amount_usdt type numeric(36, 18)
    using credited_amount_usdt::numeric(36, 18),
  add column settled_by_provider_payment_id text;

alter table public.nowpayments_usdt_ledger_entries
  alter column available_delta_usdt type numeric(36, 18)
    using available_delta_usdt::numeric(36, 18),
  alter column reserved_delta_usdt type numeric(36, 18)
    using reserved_delta_usdt::numeric(36, 18),
  alter column available_before_usdt type numeric(36, 18)
    using available_before_usdt::numeric(36, 18),
  alter column available_after_usdt type numeric(36, 18)
    using available_after_usdt::numeric(36, 18),
  alter column reserved_before_usdt type numeric(36, 18)
    using reserved_before_usdt::numeric(36, 18),
  alter column reserved_after_usdt type numeric(36, 18)
    using reserved_after_usdt::numeric(36, 18);

create table public.nowpayments_usdt_provider_payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.nowpayments_usdt_payments(id),
  user_id uuid not null references public.profiles(id),
  provider_payment_id text not null,
  parent_provider_payment_id text,
  payment_kind text not null,
  qhash_order_id uuid not null,
  pay_address text not null,
  pay_currency text not null,
  provider_payment_status text not null,
  outcome_amount_usdt numeric(36, 18),
  outcome_currency text,
  provider_verified_at timestamptz not null default now(),
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nowpayments_usdt_provider_payments_provider_id_key
    unique (provider_payment_id),
  constraint nowpayments_usdt_provider_payments_provider_id_check
    check (provider_payment_id ~ '^[0-9]{1,200}$'),
  constraint nowpayments_usdt_provider_payments_parent_id_check
    check (
      parent_provider_payment_id is null
      or (
        parent_provider_payment_id ~ '^[0-9]{1,200}$'
        and parent_provider_payment_id <> provider_payment_id
      )
    ),
  constraint nowpayments_usdt_provider_payments_kind_check
    check (
      (payment_kind = 'original' and parent_provider_payment_id is null)
      or (payment_kind = 'repeated' and parent_provider_payment_id is not null)
    ),
  constraint nowpayments_usdt_provider_payments_address_check
    check (pay_address ~ '^0x[0-9A-Fa-f]{40}$'),
  constraint nowpayments_usdt_provider_payments_currency_check
    check (pay_currency = 'usdtbsc'),
  constraint nowpayments_usdt_provider_payments_status_check
    check (provider_payment_status in (
      'waiting',
      'partially_paid',
      'confirming',
      'confirmed',
      'sending',
      'finished',
      'failed',
      'refunded',
      'expired'
    )),
  constraint nowpayments_usdt_provider_payments_outcome_check
    check (
      (
        provider_payment_status = 'finished'
        and outcome_amount_usdt is not null
        and outcome_amount_usdt > 0
        and outcome_currency = 'usdtbsc'
      )
      or (
        provider_payment_status <> 'finished'
        and outcome_amount_usdt is null
        and outcome_currency is null
      )
    ),
  constraint nowpayments_usdt_provider_payments_credit_check
    check (
      credited_at is null
      or (
        provider_payment_status = 'finished'
        and outcome_amount_usdt is not null
        and outcome_amount_usdt > 0
        and outcome_currency = 'usdtbsc'
      )
    )
);

create index idx_nowpayments_usdt_provider_payments_session_created
  on public.nowpayments_usdt_provider_payments (session_id, created_at);

create index idx_nowpayments_usdt_provider_payments_parent
  on public.nowpayments_usdt_provider_payments (parent_provider_payment_id)
  where parent_provider_payment_id is not null;

alter table public.nowpayments_usdt_provider_payments enable row level security;

create trigger set_nowpayments_usdt_provider_payments_updated_at
before update on public.nowpayments_usdt_provider_payments
for each row execute function public.set_nowpayments_usdt_updated_at();

create trigger reject_nowpayments_usdt_provider_payment_deletion
before delete or truncate on public.nowpayments_usdt_provider_payments
for each statement execute function public.reject_nowpayments_usdt_payment_deletion();

alter table public.nowpayments_usdt_payments
  add constraint nowpayments_usdt_payments_settled_provider_id_check
    check (
      settled_by_provider_payment_id is null
      or settled_by_provider_payment_id ~ '^[0-9]{1,200}$'
    );

alter table public.nowpayments_usdt_payments
  drop constraint nowpayments_usdt_payments_session_shape_check,
  add constraint nowpayments_usdt_payments_session_shape_check
    check (
      (
        session_status = 'provisioning'
        and provider_payment_id is null
        and provider_payment_status is null
        and pay_address is null
        and provider_created_at is null
        and provider_valid_until is null
        and provisioned_at is null
        and manual_recovery_at is null
        and manual_recovery_reason is null
        and terminal_at is null
        and terminal_reason is null
        and settled_by_provider_payment_id is null
      )
      or (
        session_status = 'ready'
        and provider_payment_id is not null
        and provider_payment_status in (
          'waiting', 'partially_paid', 'confirming', 'confirmed', 'sending'
        )
        and pay_address is not null
        and provider_created_at is not null
        and provider_valid_until is not null
        and provisioned_at is not null
        and manual_recovery_at is null
        and manual_recovery_reason is null
        and terminal_at is null
        and terminal_reason is null
        and settled_by_provider_payment_id is null
      )
      or (
        session_status = 'manual_recovery'
        and manual_recovery_at is not null
        and manual_recovery_reason is not null
        and terminal_at is null
        and terminal_reason is null
        and settled_by_provider_payment_id is null
      )
      or (
        session_status = 'terminal'
        and provider_payment_id is not null
        and provider_payment_status is not null
        and (
          provider_payment_status in ('finished', 'failed', 'refunded', 'expired')
          or settled_by_provider_payment_id is not null
        )
        and pay_address is not null
        and provider_created_at is not null
        and provider_valid_until is not null
        and provisioned_at is not null
        and manual_recovery_at is null
        and manual_recovery_reason is null
        and terminal_at is not null
        and terminal_reason is not null
      )
    );

alter table public.nowpayments_usdt_ledger_entries
  add column provider_payment_record_id uuid
    references public.nowpayments_usdt_provider_payments(id);

drop index public.nowpayments_usdt_ledger_entries_payment_credit_key;

create unique index nowpayments_usdt_ledger_entries_provider_payment_credit_key
  on public.nowpayments_usdt_ledger_entries (provider_payment_record_id)
  where entry_type = 'deposit_credit';

alter table public.nowpayments_usdt_ledger_entries
  drop constraint nowpayments_usdt_ledger_entries_reference_check,
  add constraint nowpayments_usdt_ledger_entries_reference_check
    check (
      (
        entry_type = 'deposit_credit'
        and payment_id is not null
        and provider_payment_record_id is not null
        and withdrawal_id is null
      )
      or (
        entry_type in ('withdrawal_reserve', 'withdrawal_release', 'withdrawal_settlement')
        and payment_id is null
        and provider_payment_record_id is null
        and withdrawal_id is not null
      )
      or (
        entry_type = 'admin_adjustment'
        and payment_id is null
        and provider_payment_record_id is null
        and withdrawal_id is null
      )
    );

-- Settlement deliberately does not inspect config.enabled. Disabling new
-- address generation must never strand funds already sent to a stored address.
create function public.settle_verified_nowpayments_usdt_payment(
  p_provider_payment_id text,
  p_parent_provider_payment_id text,
  p_qhash_order_id text,
  p_pay_address text,
  p_pay_currency text,
  p_provider_payment_status text,
  p_outcome_amount text,
  p_outcome_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_payment_kind text;
  v_status_rank integer;
  v_existing_status_rank integer;
  v_outcome_amount numeric(36, 18);
  v_session public.nowpayments_usdt_payments%rowtype;
  v_provider_payment public.nowpayments_usdt_provider_payments%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_ledger_id uuid;
  v_available_after numeric(36, 18);
begin
  if p_provider_payment_id is null
    or p_provider_payment_id !~ '^[0-9]{1,200}$'
    or (
      p_parent_provider_payment_id is not null
      and (
        p_parent_provider_payment_id !~ '^[0-9]{1,200}$'
        or p_parent_provider_payment_id = p_provider_payment_id
      )
    )
    or p_pay_address is null
    or p_pay_address !~ '^0x[0-9A-Fa-f]{40}$'
    or p_pay_currency <> 'usdtbsc'
    or p_provider_payment_status not in (
      'waiting',
      'partially_paid',
      'confirming',
      'confirmed',
      'sending',
      'finished',
      'failed',
      'refunded',
      'expired'
    )
  then
    raise exception 'invalid_nowpayments_settlement_input';
  end if;

  if p_qhash_order_id is not null
    and p_qhash_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception 'invalid_nowpayments_settlement_input';
  end if;

  if p_provider_payment_status = 'finished' then
    if p_outcome_amount is null
      or p_outcome_amount !~ '^[0-9]+(\.[0-9]{1,18})?$'
      or p_outcome_currency <> 'usdtbsc'
    then
      raise exception 'invalid_nowpayments_settlement_outcome';
    end if;

    begin
      v_outcome_amount := p_outcome_amount::numeric(36, 18);
    exception
      when numeric_value_out_of_range then
        raise exception 'invalid_nowpayments_settlement_outcome';
    end;

    if v_outcome_amount <= 0 then
      raise exception 'invalid_nowpayments_settlement_outcome';
    end if;
  elsif p_outcome_amount is not null or p_outcome_currency is not null then
    raise exception 'unexpected_nowpayments_settlement_outcome';
  end if;

  v_payment_kind := case
    when p_parent_provider_payment_id is null then 'original'
    else 'repeated'
  end;

  if v_payment_kind = 'original' then
    select *
      into v_session
    from public.nowpayments_usdt_payments
    where provider_payment_id = p_provider_payment_id
    for update;
  else
    select *
      into v_session
    from public.nowpayments_usdt_payments
    where provider_payment_id = p_parent_provider_payment_id
    for update;
  end if;

  if not found
    or v_session.provider_payment_id is null
    or v_session.pay_address is null
    or v_session.provider_created_at is null
    or v_session.provider_valid_until is null
    or v_session.asset <> 'USDT'
    or v_session.network <> 'BEP20'
    or v_session.provider_currency <> 'usdtbsc'
    or lower(v_session.pay_address) <> lower(p_pay_address)
    or v_session.session_status not in ('ready', 'manual_recovery', 'terminal')
    or (
      v_payment_kind = 'original'
      and (
        p_qhash_order_id is null
        or v_session.qhash_order_id <> p_qhash_order_id::uuid
      )
    )
    or (
      v_payment_kind = 'repeated'
      and p_qhash_order_id is not null
      and v_session.qhash_order_id <> p_qhash_order_id::uuid
    )
  then
    raise exception 'nowpayments_settlement_ownership_mismatch';
  end if;

  insert into public.nowpayments_usdt_provider_payments (
    session_id,
    user_id,
    provider_payment_id,
    parent_provider_payment_id,
    payment_kind,
    qhash_order_id,
    pay_address,
    pay_currency,
    provider_payment_status,
    outcome_amount_usdt,
    outcome_currency,
    provider_verified_at
  ) values (
    v_session.id,
    v_session.user_id,
    p_provider_payment_id,
    p_parent_provider_payment_id,
    v_payment_kind,
    v_session.qhash_order_id,
    p_pay_address,
    p_pay_currency,
    p_provider_payment_status,
    case when p_provider_payment_status = 'finished' then v_outcome_amount else null end,
    case when p_provider_payment_status = 'finished' then p_outcome_currency else null end,
    now()
  )
  on conflict (provider_payment_id) do nothing;

  select *
    into v_provider_payment
  from public.nowpayments_usdt_provider_payments
  where provider_payment_id = p_provider_payment_id
  for update;

  if not found
    or v_provider_payment.session_id <> v_session.id
    or v_provider_payment.user_id <> v_session.user_id
    or v_provider_payment.parent_provider_payment_id is distinct from p_parent_provider_payment_id
    or v_provider_payment.payment_kind <> v_payment_kind
    or v_provider_payment.qhash_order_id <> v_session.qhash_order_id
    or lower(v_provider_payment.pay_address) <> lower(p_pay_address)
    or v_provider_payment.pay_currency <> p_pay_currency
  then
    raise exception 'nowpayments_settlement_record_mismatch';
  end if;

  if v_provider_payment.credited_at is not null then
    if p_provider_payment_status <> 'finished'
      or v_provider_payment.provider_payment_status <> 'finished'
      or v_provider_payment.outcome_amount_usdt <> v_outcome_amount
      or v_provider_payment.outcome_currency <> p_outcome_currency
    then
      return jsonb_build_object(
        'status', 'preserved_credited',
        'provider_payment_id', v_provider_payment.provider_payment_id,
        'asset', 'USDT'
      );
    end if;

    select id
      into v_ledger_id
    from public.nowpayments_usdt_ledger_entries
    where provider_payment_record_id = v_provider_payment.id
      and entry_type = 'deposit_credit';

    if not found then
      raise exception 'nowpayments_settlement_ledger_missing';
    end if;

    return jsonb_build_object(
      'status', 'already_credited',
      'provider_payment_id', v_provider_payment.provider_payment_id,
      'ledger_entry_id', v_ledger_id,
      'asset', 'USDT',
      'credited_amount_usdt', v_provider_payment.outcome_amount_usdt::text
    );
  end if;

  if p_provider_payment_status <> 'finished' then
    v_status_rank := case p_provider_payment_status
      when 'waiting' then 10
      when 'partially_paid' then 20
      when 'confirming' then 30
      when 'confirmed' then 40
      when 'sending' then 50
      else 100
    end;
    v_existing_status_rank := case v_provider_payment.provider_payment_status
      when 'waiting' then 10
      when 'partially_paid' then 20
      when 'confirming' then 30
      when 'confirmed' then 40
      when 'sending' then 50
      else 100
    end;

    if v_provider_payment.provider_payment_status = 'finished'
      or v_existing_status_rank > v_status_rank
      or (
        v_existing_status_rank = 100
        and v_provider_payment.provider_payment_status <> p_provider_payment_status
      )
    then
      return jsonb_build_object(
        'status', 'preserved_newer_status',
        'provider_payment_id', v_provider_payment.provider_payment_id,
        'provider_payment_status', v_provider_payment.provider_payment_status,
        'asset', 'USDT'
      );
    end if;

    update public.nowpayments_usdt_provider_payments
    set provider_payment_status = p_provider_payment_status,
        outcome_amount_usdt = null,
        outcome_currency = null,
        provider_verified_at = now(),
        updated_at = now()
    where id = v_provider_payment.id
    returning * into v_provider_payment;

    if v_payment_kind = 'original'
      and v_session.settled_by_provider_payment_id is null
      and v_session.session_status <> 'terminal'
    then
      if p_provider_payment_status in ('failed', 'refunded', 'expired') then
        update public.nowpayments_usdt_payments
        set provider_payment_status = p_provider_payment_status,
            session_status = 'terminal',
            terminal_at = now(),
            terminal_reason = 'provider_status_' || p_provider_payment_status,
            manual_recovery_at = null,
            manual_recovery_reason = null,
            provisioned_at = coalesce(provisioned_at, now()),
            updated_at = now()
        where id = v_session.id;
      else
        update public.nowpayments_usdt_payments
        set provider_payment_status = p_provider_payment_status,
            updated_at = now()
        where id = v_session.id
          and provider_payment_status in (
            'waiting', 'partially_paid', 'confirming', 'confirmed', 'sending'
          );
      end if;
    end if;

    return jsonb_build_object(
      'status', 'recorded_no_credit',
      'provider_payment_id', v_provider_payment.provider_payment_id,
      'provider_payment_status', v_provider_payment.provider_payment_status,
      'asset', 'USDT'
    );
  end if;

  update public.nowpayments_usdt_provider_payments
  set provider_payment_status = 'finished',
      outcome_amount_usdt = v_outcome_amount,
      outcome_currency = 'usdtbsc',
      provider_verified_at = now(),
      updated_at = now()
  where id = v_provider_payment.id
  returning * into v_provider_payment;

  insert into public.nowpayments_usdt_wallets (user_id)
  values (v_session.user_id)
  on conflict (user_id) do nothing;

  select *
    into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = v_session.user_id
  for update;

  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_available_after := v_wallet.available_balance_usdt + v_outcome_amount;
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
    provider_payment_record_id,
    description,
    metadata
  ) values (
    v_ledger_id,
    v_session.user_id,
    'deposit_credit',
    'USDT',
    v_outcome_amount,
    0,
    v_wallet.available_balance_usdt,
    v_available_after,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt,
    v_session.id,
    v_provider_payment.id,
    'Independently verified NOWPayments USDTBSC deposit credited',
    jsonb_build_object(
      'provider', 'NOWPayments',
      'provider_payment_id', v_provider_payment.provider_payment_id,
      'parent_provider_payment_id', v_provider_payment.parent_provider_payment_id,
      'payment_kind', v_provider_payment.payment_kind,
      'provider_payment_status', 'finished',
      'source_amount_field', 'outcome_amount',
      'asset', 'USDT',
      'network', 'BEP20',
      'provider_currency', 'usdtbsc'
    )
  );

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_available_after,
      updated_at = now()
  where user_id = v_session.user_id;

  update public.nowpayments_usdt_provider_payments
  set credited_at = now(),
      updated_at = now()
  where id = v_provider_payment.id;

  if v_payment_kind = 'original' then
    update public.nowpayments_usdt_payments
    set provider_payment_status = 'finished',
        verification_status = 'verified',
        outcome_amount = v_outcome_amount,
        outcome_currency = 'USDT',
        verified_at = now(),
        credited_amount_usdt = v_outcome_amount,
        credited_at = now(),
        session_status = 'terminal',
        settled_by_provider_payment_id = coalesce(
          settled_by_provider_payment_id,
          p_provider_payment_id
        ),
        terminal_at = coalesce(terminal_at, now()),
        terminal_reason = 'verified_finished_payment',
        manual_recovery_at = null,
        manual_recovery_reason = null,
        provisioned_at = coalesce(provisioned_at, now()),
        updated_at = now()
    where id = v_session.id;
  else
    update public.nowpayments_usdt_payments
    set session_status = 'terminal',
        settled_by_provider_payment_id = coalesce(
          settled_by_provider_payment_id,
          p_provider_payment_id
        ),
        terminal_at = coalesce(terminal_at, now()),
        terminal_reason = case
          when terminal_reason is null then 'verified_finished_repeated_payment'
          else terminal_reason
        end,
        manual_recovery_at = null,
        manual_recovery_reason = null,
        provisioned_at = coalesce(provisioned_at, now()),
        updated_at = now()
    where id = v_session.id;
  end if;

  return jsonb_build_object(
    'status', 'credited',
    'provider_payment_id', v_provider_payment.provider_payment_id,
    'parent_provider_payment_id', v_provider_payment.parent_provider_payment_id,
    'payment_kind', v_provider_payment.payment_kind,
    'ledger_entry_id', v_ledger_id,
    'asset', 'USDT',
    'credited_amount_usdt', v_outcome_amount::text,
    'available_balance_usdt', v_available_after::text,
    'reserved_balance_usdt', v_wallet.reserved_balance_usdt::text
  );
end;
$function$;

-- Preserve monotonic status updates for session refreshes outside the IPN path.
create or replace function public.record_nowpayments_usdt_deposit_session_status(
  p_session_id uuid,
  p_qhash_order_id uuid,
  p_provider_payment_id text,
  p_provider_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session public.nowpayments_usdt_payments%rowtype;
  v_current_rank integer;
  v_incoming_rank integer;
  v_is_terminal boolean;
begin
  if p_session_id is null
    or p_qhash_order_id is null
    or p_provider_payment_id is null
    or p_provider_payment_id !~ '^[0-9]{1,200}$'
    or p_provider_payment_status not in (
      'waiting',
      'partially_paid',
      'confirming',
      'confirmed',
      'sending',
      'finished',
      'failed',
      'refunded',
      'expired'
    )
  then
    raise exception 'invalid_nowpayments_session_status';
  end if;

  select *
    into v_session
  from public.nowpayments_usdt_payments
  where id = p_session_id
  for update;

  if not found
    or v_session.qhash_order_id <> p_qhash_order_id
    or v_session.provider_payment_id <> p_provider_payment_id
  then
    raise exception 'nowpayments_session_status_mismatch';
  end if;

  if v_session.session_status = 'terminal'
    or v_session.settled_by_provider_payment_id is not null
  then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'terminal_preserved',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  if v_session.session_status <> 'ready' then
    raise exception 'nowpayments_session_status_mismatch';
  end if;

  v_current_rank := case v_session.provider_payment_status
    when 'waiting' then 10
    when 'partially_paid' then 20
    when 'confirming' then 30
    when 'confirmed' then 40
    when 'sending' then 50
    else 100
  end;
  v_incoming_rank := case p_provider_payment_status
    when 'waiting' then 10
    when 'partially_paid' then 20
    when 'confirming' then 30
    when 'confirmed' then 40
    when 'sending' then 50
    else 100
  end;

  if v_current_rank > v_incoming_rank
    or (
      v_current_rank = 100
      and v_session.provider_payment_status <> p_provider_payment_status
    )
  then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'newer_status_preserved',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  v_is_terminal := p_provider_payment_status in ('finished', 'failed', 'refunded', 'expired');

  update public.nowpayments_usdt_payments
  set provider_payment_status = p_provider_payment_status,
      session_status = case when v_is_terminal then 'terminal' else 'ready' end,
      terminal_at = case when v_is_terminal then now() else null end,
      terminal_reason = case
        when v_is_terminal then 'provider_status_' || p_provider_payment_status
        else null
      end,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', case when v_is_terminal then 'terminal' else 'active' end,
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

revoke all on table public.nowpayments_usdt_provider_payments
  from public, anon, authenticated, service_role;
grant select on table public.nowpayments_usdt_provider_payments to service_role;

revoke all on function public.credit_verified_nowpayments_usdt_payment(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.settle_verified_nowpayments_usdt_payment(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_verified_nowpayments_usdt_payment(text, text, text, text, text, text, text, text)
  to service_role;

comment on table public.nowpayments_usdt_provider_payments is
  'Independently verified NOWPayments provider-payment records. Original and repeated child payment IDs are stored separately and are never deleted.';

comment on column public.nowpayments_usdt_payments.settled_by_provider_payment_id is
  'The first independently verified finished provider payment that closed this address session. Repeated child payments remain separate provider-payment records.';

comment on column public.nowpayments_usdt_ledger_entries.provider_payment_record_id is
  'Unique provider-payment evidence for a USDT deposit credit. One provider payment can create at most one immutable credit.';

comment on function public.settle_verified_nowpayments_usdt_payment(text, text, text, text, text, text, text, text) is
  'Atomically records independently verified NOWPayments status and credits exact positive finished USDTBSC outcome_amount without consulting the deposit-generation feature gate.';
