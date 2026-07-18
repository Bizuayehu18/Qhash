-- Disabled backend-only NOWPayments USDTBSC active deposit sessions.
--
-- This forward-only migration adds no UI, webhook, crediting, withdrawal,
-- payout, signing, sweeping, or automatic fund movement. Existing ETB tables,
-- CBE/TeleBirr flows, plan_purchase history, and retired native-crypto evidence
-- are intentionally untouched.

set local lock_timeout = '5s';

do $preflight$
begin
  if to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regprocedure('public.credit_verified_nowpayments_usdt_payment(uuid,text,text)') is null
  then
    raise exception 'NOWPayments USDT foundation is missing';
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

  if exists (select 1 from public.nowpayments_usdt_payments) then
    raise exception 'NOWPayments payment foundation must be empty before session migration';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nowpayments_usdt_payments'
      and column_name = 'qhash_order_id'
  ) or to_regprocedure('public.claim_nowpayments_usdt_deposit_session(uuid,text,text)') is not null
  then
    raise exception 'NOWPayments active deposit session objects already exist outside migration tracking';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'service_role is missing';
  end if;
end;
$preflight$;

alter table public.nowpayments_usdt_payments
  rename column requested_amount_usdt to technical_reference_amount_usdt;

alter table public.nowpayments_usdt_payments
  drop constraint nowpayments_usdt_payments_minimum_check,
  alter column technical_reference_amount_usdt type numeric(36, 18),
  alter column provider_payment_id drop not null,
  alter column provider_payment_status drop not null,
  alter column provider_payment_status drop default,
  add column qhash_order_id uuid not null default gen_random_uuid(),
  add column session_status text not null default 'provisioning',
  add column pay_address text,
  add column provider_minimum_usdt numeric(36, 18) not null,
  add column provider_created_at timestamptz,
  add column provider_valid_until timestamptz,
  add column provisioning_started_at timestamptz not null default now(),
  add column provisioned_at timestamptz,
  add column manual_recovery_at timestamptz,
  add column manual_recovery_reason text,
  add column terminal_at timestamptz,
  add column terminal_reason text,
  add constraint nowpayments_usdt_payments_qhash_order_id_key
    unique (qhash_order_id),
  add constraint nowpayments_usdt_payments_technical_minimum_check
    check (technical_reference_amount_usdt >= 1),
  add constraint nowpayments_usdt_payments_provider_minimum_check
    check (provider_minimum_usdt > 0),
  add constraint nowpayments_usdt_payments_reference_amount_check
    check (
      technical_reference_amount_usdt = greatest(1::numeric, provider_minimum_usdt)
    ),
  add constraint nowpayments_usdt_payments_session_status_check
    check (session_status in ('provisioning', 'ready', 'manual_recovery', 'terminal')),
  add constraint nowpayments_usdt_payments_provider_lifecycle_status_check
    check (
      provider_payment_status is null
      or provider_payment_status in (
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
    ),
  add constraint nowpayments_usdt_payments_pay_address_check
    check (pay_address is null or pay_address ~ '^0x[0-9A-Fa-f]{40}$'),
  add constraint nowpayments_usdt_payments_provider_expiry_check
    check (
      provider_created_at is null
      or provider_valid_until is null
      or provider_valid_until > provider_created_at
    ),
  add constraint nowpayments_usdt_payments_manual_recovery_reason_check
    check (
      manual_recovery_reason is null
      or manual_recovery_reason in (
        'stale_provisioning_claim',
        'create_payment_timeout',
        'create_payment_network_error',
        'create_payment_http_error',
        'create_payment_invalid_response',
        'create_payment_finalize_failed',
        'payment_status_invalid_response'
      )
    ),
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
      )
      or (
        session_status = 'ready'
        and provider_payment_id is not null
        and provider_payment_status is not null
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
      )
      or (
        session_status = 'manual_recovery'
        and manual_recovery_at is not null
        and manual_recovery_reason is not null
        and terminal_at is null
        and terminal_reason is null
      )
      or (
        session_status = 'terminal'
        and provider_payment_id is not null
        and provider_payment_status is not null
        and provider_payment_status in ('finished', 'failed', 'refunded', 'expired')
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

create unique index nowpayments_usdt_payments_one_open_session_per_user
  on public.nowpayments_usdt_payments (user_id)
  where session_status in ('provisioning', 'ready', 'manual_recovery');

create index idx_nowpayments_usdt_payments_user_session_created
  on public.nowpayments_usdt_payments (user_id, session_status, created_at desc);

create function public.reject_nowpayments_usdt_payment_deletion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  raise exception 'NOWPayments payment and address mappings are immutable evidence';
end;
$function$;

create trigger reject_nowpayments_usdt_payment_deletion
before delete or truncate on public.nowpayments_usdt_payments
for each statement execute function public.reject_nowpayments_usdt_payment_deletion();

create function public.get_current_nowpayments_usdt_deposit_session(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean;
  v_is_frozen boolean;
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_user_id is null then
    raise exception 'invalid_nowpayments_session_user';
  end if;

  select enabled
    into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';

  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select is_frozen
    into v_is_frozen
  from public.profiles
  where id = p_user_id;

  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  select *
    into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and session_status in ('provisioning', 'ready', 'manual_recovery')
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('disposition', 'none');
  end if;

  if v_session.session_status = 'provisioning'
    and v_session.provisioning_started_at <= now() - interval '5 minutes'
  then
    update public.nowpayments_usdt_payments
    set session_status = 'manual_recovery',
        manual_recovery_at = now(),
        manual_recovery_reason = 'stale_provisioning_claim',
        updated_at = now()
    where id = v_session.id
    returning * into v_session;
  end if;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'existing',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

create function public.claim_nowpayments_usdt_deposit_session(
  p_user_id uuid,
  p_provider_minimum_usdt text,
  p_technical_reference_amount_usdt text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_enabled boolean;
  v_is_frozen boolean;
  v_provider_minimum numeric(36, 18);
  v_technical_reference numeric(36, 18);
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_user_id is null
    or p_provider_minimum_usdt is null
    or p_provider_minimum_usdt !~ '^[0-9]+(\.[0-9]{1,18})?$'
    or p_technical_reference_amount_usdt is null
    or p_technical_reference_amount_usdt !~ '^[0-9]+(\.[0-9]{1,18})?$'
  then
    raise exception 'invalid_nowpayments_session_claim';
  end if;

  begin
    v_provider_minimum := p_provider_minimum_usdt::numeric(36, 18);
    v_technical_reference := p_technical_reference_amount_usdt::numeric(36, 18);
  exception
    when numeric_value_out_of_range then
      raise exception 'invalid_nowpayments_session_claim';
  end;

  if v_provider_minimum <= 0
    or v_technical_reference < 1
    or v_technical_reference <> greatest(1::numeric, v_provider_minimum)
  then
    raise exception 'invalid_nowpayments_session_claim';
  end if;

  select enabled
    into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';

  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select is_frozen
    into v_is_frozen
  from public.profiles
  where id = p_user_id
  for update;

  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  select *
    into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and session_status in ('provisioning', 'ready', 'manual_recovery')
  order by created_at desc
  limit 1
  for update;

  if found then
    if v_session.session_status = 'provisioning'
      and v_session.provisioning_started_at <= now() - interval '5 minutes'
    then
      update public.nowpayments_usdt_payments
      set session_status = 'manual_recovery',
          manual_recovery_at = now(),
          manual_recovery_reason = 'stale_provisioning_claim',
          updated_at = now()
      where id = v_session.id
      returning * into v_session;
    end if;

    if v_session.session_status = 'ready'
      and v_session.provider_payment_status = 'waiting'
      and v_session.provider_valid_until <= now()
    then
      update public.nowpayments_usdt_payments
      set provider_payment_status = 'expired',
          session_status = 'terminal',
          terminal_at = now(),
          terminal_reason = 'provider_valid_until_elapsed',
          updated_at = now()
      where id = v_session.id;
    else
      return to_jsonb(v_session) || jsonb_build_object(
        'disposition', 'existing',
        'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
        'provider_minimum_usdt', v_session.provider_minimum_usdt::text
      );
    end if;
  end if;

  insert into public.nowpayments_usdt_payments (
    user_id,
    provider_payment_id,
    provider_payment_status,
    verification_status,
    asset,
    network,
    provider_currency,
    technical_reference_amount_usdt,
    provider_minimum_usdt,
    outcome_amount,
    outcome_currency,
    verified_at,
    session_status
  ) values (
    p_user_id,
    null,
    null,
    'pending',
    'USDT',
    'BEP20',
    'usdtbsc',
    v_technical_reference,
    v_provider_minimum,
    null,
    'USDT',
    null,
    'provisioning'
  )
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'claimed',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

create function public.complete_nowpayments_usdt_deposit_session(
  p_session_id uuid,
  p_qhash_order_id uuid,
  p_provider_payment_id text,
  p_pay_address text,
  p_provider_payment_status text,
  p_provider_created_at timestamptz,
  p_provider_valid_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_session_id is null
    or p_qhash_order_id is null
    or p_provider_payment_id is null
    or btrim(p_provider_payment_id) = ''
    or p_pay_address is null
    or p_pay_address !~ '^0x[0-9A-Fa-f]{40}$'
    or p_provider_payment_status is null
    or p_provider_payment_status not in (
      'waiting', 'partially_paid', 'confirming', 'confirmed', 'sending'
    )
    or p_provider_created_at is null
    or p_provider_valid_until is null
    or p_provider_valid_until <= p_provider_created_at
    or p_provider_valid_until <= now()
  then
    raise exception 'invalid_nowpayments_session_completion';
  end if;

  select *
    into v_session
  from public.nowpayments_usdt_payments
  where id = p_session_id
  for update;

  if not found
    or v_session.qhash_order_id <> p_qhash_order_id
    or v_session.session_status <> 'provisioning'
  then
    raise exception 'nowpayments_session_completion_mismatch';
  end if;

  update public.nowpayments_usdt_payments
  set provider_payment_id = p_provider_payment_id,
      provider_payment_status = p_provider_payment_status,
      pay_address = p_pay_address,
      provider_created_at = p_provider_created_at,
      provider_valid_until = p_provider_valid_until,
      session_status = 'ready',
      provisioned_at = now(),
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'completed',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

create function public.mark_nowpayments_usdt_deposit_session_manual_recovery(
  p_session_id uuid,
  p_qhash_order_id uuid,
  p_reason text,
  p_provider_payment_id text,
  p_pay_address text,
  p_provider_payment_status text,
  p_provider_created_at timestamptz,
  p_provider_valid_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_session_id is null
    or p_qhash_order_id is null
    or p_reason is null
    or p_reason not in (
      'create_payment_timeout',
      'create_payment_network_error',
      'create_payment_http_error',
      'create_payment_invalid_response',
      'create_payment_finalize_failed',
      'payment_status_invalid_response'
    )
  then
    raise exception 'invalid_nowpayments_manual_recovery_request';
  end if;

  if p_reason = 'create_payment_finalize_failed' then
    if p_provider_payment_id is null
      or btrim(p_provider_payment_id) = ''
      or p_pay_address is null
      or p_pay_address !~ '^0x[0-9A-Fa-f]{40}$'
      or p_provider_payment_status is null
      or p_provider_payment_status not in (
        'waiting', 'partially_paid', 'confirming', 'confirmed', 'sending'
      )
      or p_provider_created_at is null
      or p_provider_valid_until is null
      or p_provider_valid_until <= p_provider_created_at
    then
      raise exception 'invalid_nowpayments_manual_recovery_evidence';
    end if;
  elsif p_provider_payment_id is not null
    or p_pay_address is not null
    or p_provider_payment_status is not null
    or p_provider_created_at is not null
    or p_provider_valid_until is not null
  then
    raise exception 'unexpected_nowpayments_manual_recovery_evidence';
  end if;

  select *
    into v_session
  from public.nowpayments_usdt_payments
  where id = p_session_id
  for update;

  if not found
    or v_session.qhash_order_id <> p_qhash_order_id
    or v_session.session_status not in ('provisioning', 'ready')
  then
    raise exception 'nowpayments_manual_recovery_mismatch';
  end if;

  update public.nowpayments_usdt_payments
  set session_status = 'manual_recovery',
      provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
      provider_payment_status = coalesce(p_provider_payment_status, provider_payment_status),
      pay_address = coalesce(p_pay_address, pay_address),
      provider_created_at = coalesce(p_provider_created_at, provider_created_at),
      provider_valid_until = coalesce(p_provider_valid_until, provider_valid_until),
      manual_recovery_at = now(),
      manual_recovery_reason = p_reason,
      updated_at = now()
  where id = v_session.id
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'manual_recovery',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

create function public.record_nowpayments_usdt_deposit_session_status(
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
  v_is_terminal boolean;
begin
  if p_session_id is null
    or p_qhash_order_id is null
    or p_provider_payment_id is null
    or btrim(p_provider_payment_id) = ''
    or p_provider_payment_status is null
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
    or v_session.session_status <> 'ready'
  then
    raise exception 'nowpayments_session_status_mismatch';
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

revoke insert (
  user_id,
  provider_payment_id,
  provider_payment_status,
  verification_status,
  asset,
  network,
  provider_currency,
  technical_reference_amount_usdt,
  outcome_amount,
  outcome_currency,
  verified_at
) on public.nowpayments_usdt_payments from service_role;

revoke update (
  provider_payment_status,
  verification_status,
  outcome_amount,
  verified_at,
  updated_at
) on public.nowpayments_usdt_payments from service_role;

grant select on table public.nowpayments_usdt_payments to service_role;

revoke all on function public.reject_nowpayments_usdt_payment_deletion() from public, anon, authenticated, service_role;
revoke all on function public.get_current_nowpayments_usdt_deposit_session(uuid) from public, anon, authenticated;
revoke all on function public.claim_nowpayments_usdt_deposit_session(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_nowpayments_usdt_deposit_session(uuid, uuid, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_nowpayments_usdt_deposit_session_manual_recovery(uuid, uuid, text, text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.record_nowpayments_usdt_deposit_session_status(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.get_current_nowpayments_usdt_deposit_session(uuid) to service_role;
grant execute on function public.claim_nowpayments_usdt_deposit_session(uuid, text, text) to service_role;
grant execute on function public.complete_nowpayments_usdt_deposit_session(uuid, uuid, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.mark_nowpayments_usdt_deposit_session_manual_recovery(uuid, uuid, text, text, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.record_nowpayments_usdt_deposit_session_status(uuid, uuid, text, text) to service_role;

comment on table public.nowpayments_usdt_payments is
  'Durable NOWPayments USDTBSC payment/address sessions. Technical reference amounts are not user-entered amounts; historical mappings are retained for late and repeated-payment reconciliation.';

comment on column public.nowpayments_usdt_payments.technical_reference_amount_usdt is
  'Provider payment reference amount only. It is not requested by the user and does not cap the actual deposit.';

comment on column public.nowpayments_usdt_payments.provider_valid_until is
  'NOWPayments valid_until value returned by create-payment; never derived from a hard-coded lifetime.';

comment on column public.nowpayments_usdt_payments.pay_address is
  'Public USDTBSC deposit address returned by NOWPayments. Not unique because repeated-payment flows may reuse addresses.';
