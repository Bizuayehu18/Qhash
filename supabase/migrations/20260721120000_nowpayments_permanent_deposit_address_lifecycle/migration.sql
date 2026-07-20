-- Permanent NOWPayments USDTBSC address activation lifecycle.
--
-- A provider-created address begins with its original provider_valid_until as
-- an activation deadline. Only an independently verified, gross-credited
-- original payment observed no later than that deadline activates the address
-- permanently. Repeated payments never extend or activate the address.

set local lock_timeout = '5s';

do $preflight$
declare
  v_populated boolean;
begin
  if to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_provider_payments') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_ledger_entries') is null
    or to_regclass('public.nowpayments_usdt_withdrawals') is null
    or to_regprocedure('public.get_current_nowpayments_usdt_deposit_session(uuid)') is null
    or to_regprocedure('public.claim_nowpayments_usdt_deposit_session(uuid,text,text)') is null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)') is null
  then
    raise exception 'NOWPayments permanent-address foundation is incomplete';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nowpayments_usdt_payments'
      and column_name = 'address_activated_at'
  ) or to_regprocedure('public.activate_qualified_nowpayments_usdt_address()') is not null
  then
    raise exception 'NOWPayments permanent-address objects already exist outside migration tracking';
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
    raise exception 'NOWPayments permanent-address migration requires the locked disabled configuration';
  end if;

  v_populated := exists (select 1 from public.nowpayments_usdt_payments)
    or exists (select 1 from public.nowpayments_usdt_provider_payments)
    or exists (select 1 from public.nowpayments_usdt_wallets)
    or exists (select 1 from public.nowpayments_usdt_ledger_entries)
    or exists (select 1 from public.nowpayments_usdt_withdrawals);

  if v_populated and (
    (select count(*) from public.nowpayments_usdt_payments) <> 1
    or (select count(*) from public.nowpayments_usdt_provider_payments) <> 3
    or (select count(*) from public.nowpayments_usdt_wallets) <> 1
    or (select count(*) from public.nowpayments_usdt_ledger_entries) <> 5
    or (select count(*) from public.nowpayments_usdt_withdrawals) <> 0
    or (select count(*) from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit') <> 3
    or (select count(*) from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit_correction') <> 2
    or (select sum(available_delta_usdt) from public.nowpayments_usdt_ledger_entries) <> 9
    or not exists (
      select 1
      from public.nowpayments_usdt_wallets
      where available_balance_usdt = 9
        and reserved_balance_usdt = 0
    )
    or not exists (
      select 1
      from public.nowpayments_usdt_payments session
      join public.nowpayments_usdt_provider_payments original
        on original.session_id = session.id
       and original.provider_payment_id = session.provider_payment_id
       and original.payment_kind = 'original'
       and original.parent_provider_payment_id is null
      where session.provider_payment_id = '5649600523'
        and session.asset = 'USDT'
        and session.network = 'BEP20'
        and session.provider_currency = 'usdtbsc'
        and session.provider_payment_status = 'finished'
        and session.verification_status = 'verified'
        and session.pay_address is not null
        and session.provider_valid_until is not null
        and session.credited_amount_usdt = 3
        and session.credited_at is not null
        and original.provider_payment_status = 'finished'
        and original.pay_currency = 'usdtbsc'
        and original.actually_paid_usdt = 3
        and original.credited_amount_usdt = 3
        and original.credited_at is not null
        and original.provider_verified_at is not null
        and original.provider_verified_at <= session.provider_valid_until
    )
    or (
      select count(*)
      from public.nowpayments_usdt_provider_payments child
      join public.nowpayments_usdt_payments session on session.id = child.session_id
      where child.payment_kind = 'repeated'
        and child.parent_provider_payment_id = session.provider_payment_id
        and child.user_id = session.user_id
        and child.qhash_order_id = session.qhash_order_id
        and lower(child.pay_address) = lower(session.pay_address)
        and child.pay_currency = 'usdtbsc'
        and child.provider_payment_status = 'finished'
        and child.actually_paid_usdt = 3
        and child.credited_amount_usdt = 3
        and child.credited_at is not null
    ) <> 2
    or exists (
      select 1
      from public.nowpayments_usdt_provider_payments provider
      left join public.nowpayments_usdt_payments session on session.id = provider.session_id
      where session.id is null
        or provider.user_id <> session.user_id
        or provider.qhash_order_id <> session.qhash_order_id
        or lower(provider.pay_address) <> lower(session.pay_address)
    )
  ) then
    raise exception 'unexpected NOWPayments permanent-address production fingerprint';
  end if;
end;
$preflight$;

alter table public.nowpayments_usdt_payments
  add column address_activated_at timestamptz,
  add constraint nowpayments_usdt_payments_address_activation_check
    check (
      address_activated_at is null
      or (
        provider_payment_id is not null
        and pay_address is not null
        and provider_created_at is not null
        and provider_valid_until is not null
        and address_activated_at >= provider_created_at
        and address_activated_at <= provider_valid_until
      )
    );

-- The only populated production session is backfilled from independently
-- verified original-payment evidence already stored before its deadline.
update public.nowpayments_usdt_payments session
set address_activated_at = original.provider_verified_at
from public.nowpayments_usdt_provider_payments original
where original.session_id = session.id
  and original.provider_payment_id = session.provider_payment_id
  and original.payment_kind = 'original'
  and original.parent_provider_payment_id is null
  and original.provider_payment_status = 'finished'
  and original.pay_currency = 'usdtbsc'
  and original.actually_paid_usdt > 0
  and original.credited_amount_usdt = original.actually_paid_usdt
  and original.credited_at is not null
  and original.provider_verified_at is not null
  and session.provider_payment_status = 'finished'
  and session.verification_status = 'verified'
  and session.provider_valid_until is not null
  and original.provider_verified_at between session.provider_created_at and session.provider_valid_until;

create unique index nowpayments_usdt_payments_one_activated_address_per_user
  on public.nowpayments_usdt_payments (user_id)
  where address_activated_at is not null;

create function public.enforce_nowpayments_usdt_address_lifecycle_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.provider_valid_until is not null
    and new.provider_valid_until is distinct from old.provider_valid_until
  then
    raise exception 'NOWPayments original activation deadline is immutable';
  end if;

  if old.address_activated_at is not null
    and new.address_activated_at is distinct from old.address_activated_at
  then
    raise exception 'NOWPayments address activation timestamp is immutable';
  end if;

  if old.address_activated_at is null and new.address_activated_at is not null
    and (
      new.provider_created_at is null
      or new.provider_valid_until is null
      or new.address_activated_at < new.provider_created_at
      or new.address_activated_at > new.provider_valid_until
    )
  then
    raise exception 'NOWPayments address activation evidence is outside its original deadline';
  end if;

  return new;
end;
$function$;

create trigger enforce_nowpayments_usdt_address_lifecycle_immutability
before update on public.nowpayments_usdt_payments
for each row execute function public.enforce_nowpayments_usdt_address_lifecycle_immutability();

create function public.activate_qualified_nowpayments_usdt_address()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if new.payment_kind <> 'original'
    or new.parent_provider_payment_id is not null
    or new.provider_payment_status <> 'finished'
    or new.pay_currency <> 'usdtbsc'
    or new.actually_paid_usdt is null
    or new.actually_paid_usdt <= 0
    or new.outcome_amount_usdt is null
    or new.outcome_amount_usdt <= 0
    or new.outcome_currency <> 'usdtbsc'
    or new.credited_amount_usdt is distinct from new.actually_paid_usdt
    or new.credited_at is null
    or new.provider_verified_at is null
  then
    return new;
  end if;

  update public.nowpayments_usdt_payments session
  set address_activated_at = new.provider_verified_at
  where session.id = new.session_id
    and session.user_id = new.user_id
    and session.qhash_order_id = new.qhash_order_id
    and session.provider_payment_id = new.provider_payment_id
    and lower(session.pay_address) = lower(new.pay_address)
    and session.asset = 'USDT'
    and session.network = 'BEP20'
    and session.provider_currency = 'usdtbsc'
    and session.address_activated_at is null
    and session.provider_created_at is not null
    and session.provider_valid_until is not null
    and new.provider_verified_at between session.provider_created_at and session.provider_valid_until;

  return new;
end;
$function$;

create trigger activate_qualified_nowpayments_usdt_address
after insert or update on public.nowpayments_usdt_provider_payments
for each row execute function public.activate_qualified_nowpayments_usdt_address();

create or replace function public.get_current_nowpayments_usdt_deposit_session(
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

  select enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';
  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select is_frozen into v_is_frozen
  from public.profiles
  where id = p_user_id;
  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is not null
  order by address_activated_at, created_at
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'activated',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  select * into v_session
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

  if v_session.session_status = 'ready'
    and v_session.address_activated_at is null
    and v_session.provider_valid_until <= now()
  then
    update public.nowpayments_usdt_payments
    set provider_payment_status = 'expired',
        session_status = 'terminal',
        terminal_at = coalesce(terminal_at, now()),
        terminal_reason = 'provider_valid_until_elapsed',
        updated_at = now()
    where id = v_session.id;
    return jsonb_build_object('disposition', 'none');
  end if;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', case when v_session.session_status = 'ready' then 'pending' else 'existing' end,
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

create or replace function public.claim_nowpayments_usdt_deposit_session(
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

  select enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';
  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select is_frozen into v_is_frozen
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  -- The profile row lock serializes all claims for one user. Checking the
  -- permanent mapping after that lock prevents concurrent replacement calls.
  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is not null
  order by address_activated_at, created_at
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'activated',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  select * into v_session
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
      and v_session.address_activated_at is null
      and v_session.provider_valid_until <= now()
    then
      update public.nowpayments_usdt_payments
      set provider_payment_status = 'expired',
          session_status = 'terminal',
          terminal_at = coalesce(terminal_at, now()),
          terminal_reason = 'provider_valid_until_elapsed',
          updated_at = now()
      where id = v_session.id;
    else
      return to_jsonb(v_session) || jsonb_build_object(
        'disposition', case when v_session.session_status = 'ready' then 'pending' else 'existing' end,
        'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
        'provider_minimum_usdt', v_session.provider_minimum_usdt::text
      );
    end if;
  end if;

  insert into public.nowpayments_usdt_payments (
    user_id, provider_payment_id, provider_payment_status,
    verification_status, asset, network, provider_currency,
    technical_reference_amount_usdt, provider_minimum_usdt,
    outcome_amount, outcome_currency, verified_at, session_status
  ) values (
    p_user_id, null, null,
    'pending', 'USDT', 'BEP20', 'usdtbsc',
    v_technical_reference, v_provider_minimum,
    null, 'USDT', null, 'provisioning'
  )
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'claimed',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

revoke all on function public.enforce_nowpayments_usdt_address_lifecycle_immutability()
  from public, anon, authenticated, service_role;
revoke all on function public.activate_qualified_nowpayments_usdt_address()
  from public, anon, authenticated, service_role;
revoke all on function public.get_current_nowpayments_usdt_deposit_session(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_nowpayments_usdt_deposit_session(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.get_current_nowpayments_usdt_deposit_session(uuid)
  to service_role;
grant execute on function public.claim_nowpayments_usdt_deposit_session(uuid, text, text)
  to service_role;

comment on column public.nowpayments_usdt_payments.address_activated_at is
  'Immutable timestamp proving the original independently verified finished payment was observed no later than its original provider_valid_until activation deadline.';
comment on function public.activate_qualified_nowpayments_usdt_address() is
  'Atomically activates only gross-credited original USDTBSC payments whose trusted provider verification was observed within the original deadline; repeated payments never activate.';
comment on function public.get_current_nowpayments_usdt_deposit_session(uuid) is
  'Returns the permanent address first, otherwise the single pending activation/provisioning state, while retaining expired sessions as history.';
comment on function public.claim_nowpayments_usdt_deposit_session(uuid, text, text) is
  'Serializes per-user generation, reuses permanent or pending addresses, and creates one replacement only after unactivated expiry.';

do $postflight$
declare
  v_populated boolean;
begin
  if to_regprocedure('public.activate_qualified_nowpayments_usdt_address()') is null
    or to_regprocedure('public.enforce_nowpayments_usdt_address_lifecycle_immutability()') is null
    or not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'nowpayments_usdt_payments_one_activated_address_per_user'
    )
    or has_function_privilege('authenticated', 'public.activate_qualified_nowpayments_usdt_address()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.get_current_nowpayments_usdt_deposit_session(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_nowpayments_usdt_deposit_session(uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.get_current_nowpayments_usdt_deposit_session(uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_nowpayments_usdt_deposit_session(uuid,text,text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)', 'EXECUTE')
  then
    raise exception 'NOWPayments permanent-address security postflight failed';
  end if;

  v_populated := exists (select 1 from public.nowpayments_usdt_payments)
    or exists (select 1 from public.nowpayments_usdt_provider_payments)
    or exists (select 1 from public.nowpayments_usdt_wallets)
    or exists (select 1 from public.nowpayments_usdt_ledger_entries);

  if v_populated and (
    not exists (
      select 1 from public.nowpayments_usdt_config
      where id = 'USDT-BEP20' and enabled = false
    )
    or (select count(*) from public.nowpayments_usdt_payments where address_activated_at is not null) <> 1
    or (select count(*) from public.nowpayments_usdt_provider_payments) <> 3
    or (select count(*) from public.nowpayments_usdt_ledger_entries) <> 5
    or not exists (
      select 1 from public.nowpayments_usdt_wallets
      where available_balance_usdt = 9 and reserved_balance_usdt = 0
    )
    or exists (
      select 1
      from public.nowpayments_usdt_payments
      where address_activated_at is not null
        and (
          provider_payment_id <> '5649600523'
          or address_activated_at > provider_valid_until
          or credited_amount_usdt <> 3
        )
    )
    or (select sum(available_delta_usdt) from public.nowpayments_usdt_ledger_entries) <> 9
  ) then
    raise exception 'NOWPayments permanent-address financial postflight failed';
  end if;
end;
$postflight$;
