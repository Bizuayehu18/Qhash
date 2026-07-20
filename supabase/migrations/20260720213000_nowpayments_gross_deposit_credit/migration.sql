-- Credit independently verified finished USDTBSC deposits at gross actually_paid.
-- Provider outcome remains separate merchant-fee audit evidence. This migration
-- also adds two immutable correction entries for the two production payments
-- that were previously credited at net outcome_amount.

set local lock_timeout = '5s';

do $preflight$
declare
  v_is_empty boolean;
begin
  if to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_provider_payments') is null
    or to_regclass('public.nowpayments_usdt_withdrawals') is null
    or to_regclass('public.nowpayments_usdt_ledger_entries') is null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.credit_verified_nowpayments_usdt_payment(uuid,text,text)') is null
  then
    raise exception 'NOWPayments settlement foundation is incomplete';
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
    raise exception 'NOWPayments gross-credit migration requires disabled generation';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'nowpayments_usdt_provider_payments'
      and column_name in ('actually_paid_usdt', 'credited_amount_usdt')
  ) or to_regprocedure(
    'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)'
  ) is not null then
    raise exception 'NOWPayments gross-credit objects already exist outside migration tracking';
  end if;

  select not exists (select 1 from public.nowpayments_usdt_wallets)
    and not exists (select 1 from public.nowpayments_usdt_payments)
    and not exists (select 1 from public.nowpayments_usdt_provider_payments)
    and not exists (select 1 from public.nowpayments_usdt_withdrawals)
    and not exists (select 1 from public.nowpayments_usdt_ledger_entries)
    into v_is_empty;

  -- Empty preview/test databases are valid. Any populated database must match
  -- the exact production financial fingerprint approved for correction.
  if v_is_empty then
    return;
  end if;

  if (select count(*) from public.nowpayments_usdt_config) <> 1
    or (select count(*) from public.nowpayments_usdt_wallets) <> 1
    or (select count(*) from public.nowpayments_usdt_payments) <> 1
    or (select count(*) from public.nowpayments_usdt_provider_payments) <> 2
    or (select count(*) from public.nowpayments_usdt_withdrawals) <> 0
    or (select count(*) from public.nowpayments_usdt_ledger_entries) <> 2
  then
    raise exception 'unexpected NOWPayments production row counts';
  end if;

  if not exists (
    select 1
    from public.nowpayments_usdt_provider_payments original
    join public.nowpayments_usdt_provider_payments child
      on child.session_id = original.session_id
     and child.user_id = original.user_id
     and child.qhash_order_id = original.qhash_order_id
     and lower(child.pay_address) = lower(original.pay_address)
    join public.nowpayments_usdt_payments session on session.id = original.session_id
    join public.nowpayments_usdt_wallets wallet on wallet.user_id = original.user_id
    where original.provider_payment_id = '5649600523'
      and original.parent_provider_payment_id is null
      and original.payment_kind = 'original'
      and original.provider_payment_status = 'finished'
      and original.pay_currency = 'usdtbsc'
      and original.outcome_amount_usdt = 2.95192543
      and original.outcome_currency = 'usdtbsc'
      and original.credited_at is not null
      and child.provider_payment_id = '5470246076'
      and child.parent_provider_payment_id = '5649600523'
      and child.payment_kind = 'repeated'
      and child.provider_payment_status = 'finished'
      and child.pay_currency = 'usdtbsc'
      and child.outcome_amount_usdt = 2.9519285
      and child.outcome_currency = 'usdtbsc'
      and child.credited_at is not null
      and session.user_id = original.user_id
      and session.provider_payment_id = '5649600523'
      and session.provider_payment_status = 'finished'
      and session.verification_status = 'verified'
      and session.session_status = 'terminal'
      and session.settled_by_provider_payment_id = '5649600523'
      and session.outcome_amount = 2.95192543
      and session.outcome_currency = 'USDT'
      and session.credited_amount_usdt = 2.95192543
      and session.credited_at is not null
      and wallet.available_balance_usdt = 5.90385393
      and wallet.reserved_balance_usdt = 0
  ) then
    raise exception 'unexpected NOWPayments production payment fingerprint';
  end if;

  if not exists (
    select 1
    from public.nowpayments_usdt_ledger_entries ledger
    join public.nowpayments_usdt_provider_payments provider
      on provider.id = ledger.provider_payment_record_id
    where provider.provider_payment_id = '5649600523'
      and ledger.entry_type = 'deposit_credit'
      and ledger.available_before_usdt = 0
      and ledger.available_delta_usdt = 2.95192543
      and ledger.available_after_usdt = 2.95192543
      and ledger.reserved_before_usdt = 0
      and ledger.reserved_delta_usdt = 0
      and ledger.reserved_after_usdt = 0
  ) or not exists (
    select 1
    from public.nowpayments_usdt_ledger_entries ledger
    join public.nowpayments_usdt_provider_payments provider
      on provider.id = ledger.provider_payment_record_id
    where provider.provider_payment_id = '5470246076'
      and ledger.entry_type = 'deposit_credit'
      and ledger.available_before_usdt = 2.95192543
      and ledger.available_delta_usdt = 2.9519285
      and ledger.available_after_usdt = 5.90385393
      and ledger.reserved_before_usdt = 0
      and ledger.reserved_delta_usdt = 0
      and ledger.reserved_after_usdt = 0
  ) then
    raise exception 'unexpected NOWPayments immutable ledger fingerprint';
  end if;
end;
$preflight$;

alter table public.nowpayments_usdt_provider_payments
  add column actually_paid_usdt numeric(36, 18),
  add column credited_amount_usdt numeric(36, 18);

alter table public.nowpayments_usdt_payments
  drop constraint nowpayments_usdt_payments_credit_check,
  add constraint nowpayments_usdt_payments_credit_check
    check (
      (
        credited_amount_usdt is null
        and credited_at is null
      )
      or (
        verification_status = 'verified'
        and provider_payment_status = 'finished'
        and outcome_amount is not null
        and outcome_amount > 0
        and outcome_currency = 'USDT'
        and credited_amount_usdt is not null
        and credited_amount_usdt > 0
        and credited_at is not null
      )
    );

alter table public.nowpayments_usdt_provider_payments
  drop constraint nowpayments_usdt_provider_payments_credit_check;

alter table public.nowpayments_usdt_ledger_entries
  drop constraint nowpayments_usdt_ledger_entries_type_check,
  add constraint nowpayments_usdt_ledger_entries_type_check
    check (entry_type in (
      'deposit_credit',
      'deposit_credit_correction',
      'withdrawal_reserve',
      'withdrawal_release',
      'withdrawal_settlement',
      'admin_adjustment'
    )),
  drop constraint nowpayments_usdt_ledger_entries_reference_check,
  add constraint nowpayments_usdt_ledger_entries_reference_check
    check (
      (
        entry_type in ('deposit_credit', 'deposit_credit_correction')
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

create unique index nowpayments_usdt_ledger_entries_provider_correction_key
  on public.nowpayments_usdt_ledger_entries (provider_payment_record_id)
  where entry_type = 'deposit_credit_correction';

do $historical_correction$
declare
  v_session_id uuid;
  v_user_id uuid;
  v_original_record_id uuid;
  v_child_record_id uuid;
begin
  if not exists (select 1 from public.nowpayments_usdt_provider_payments) then
    return;
  end if;

  select original.session_id, original.user_id, original.id, child.id
    into strict v_session_id, v_user_id, v_original_record_id, v_child_record_id
  from public.nowpayments_usdt_provider_payments original
  join public.nowpayments_usdt_provider_payments child
    on child.parent_provider_payment_id = original.provider_payment_id
  where original.provider_payment_id = '5649600523'
    and child.provider_payment_id = '5470246076';

  update public.nowpayments_usdt_provider_payments
  set actually_paid_usdt = 3,
      credited_amount_usdt = 3,
      updated_at = now()
  where id in (v_original_record_id, v_child_record_id);

  insert into public.nowpayments_usdt_ledger_entries (
    id, user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    payment_id, provider_payment_record_id, description, metadata
  ) values (
    'f4d6c4d0-5605-4f9a-8048-074570000001',
    v_user_id,
    'deposit_credit_correction',
    'USDT',
    0.04807457,
    0,
    5.90385393,
    5.95192850,
    0,
    0,
    v_session_id,
    v_original_record_id,
    'NOWPayments gross deposit credit correction',
    jsonb_build_object(
      'provider', 'NOWPayments',
      'provider_payment_id', '5649600523',
      'correction_reason', 'gross_actually_paid_minus_net_outcome',
      'actually_paid_usdt', '3',
      'outcome_amount_usdt', '2.95192543',
      'source_amount_field', 'actually_paid',
      'asset', 'USDT',
      'network', 'BEP20',
      'provider_currency', 'usdtbsc'
    )
  );

  insert into public.nowpayments_usdt_ledger_entries (
    id, user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    payment_id, provider_payment_record_id, description, metadata
  ) values (
    'f4d6c4d0-5470-4f9a-8048-071500000002',
    v_user_id,
    'deposit_credit_correction',
    'USDT',
    0.0480715,
    0,
    5.95192850,
    6.00000000,
    0,
    0,
    v_session_id,
    v_child_record_id,
    'NOWPayments gross deposit credit correction',
    jsonb_build_object(
      'provider', 'NOWPayments',
      'provider_payment_id', '5470246076',
      'parent_provider_payment_id', '5649600523',
      'correction_reason', 'gross_actually_paid_minus_net_outcome',
      'actually_paid_usdt', '3',
      'outcome_amount_usdt', '2.9519285',
      'source_amount_field', 'actually_paid',
      'asset', 'USDT',
      'network', 'BEP20',
      'provider_currency', 'usdtbsc'
    )
  );

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = 6,
      updated_at = now()
  where user_id = v_user_id
    and available_balance_usdt = 5.90385393
    and reserved_balance_usdt = 0;
  if not found then
    raise exception 'NOWPayments correction wallet update refused';
  end if;

  update public.nowpayments_usdt_payments
  set credited_amount_usdt = 3,
      updated_at = now()
  where id = v_session_id
    and provider_payment_id = '5649600523'
    and credited_amount_usdt = 2.95192543
    and outcome_amount = 2.95192543;
  if not found then
    raise exception 'NOWPayments correction session update refused';
  end if;
end;
$historical_correction$;

alter table public.nowpayments_usdt_provider_payments
  add constraint nowpayments_usdt_provider_payments_actually_paid_check
    check (
      (
        provider_payment_status = 'finished'
        and actually_paid_usdt is not null
        and actually_paid_usdt > 0
      )
      or (
        provider_payment_status <> 'finished'
        and actually_paid_usdt is null
      )
    ),
  add constraint nowpayments_usdt_provider_payments_credit_check
    check (
      (
        credited_at is null
        and credited_amount_usdt is null
      )
      or (
        provider_payment_status = 'finished'
        and actually_paid_usdt is not null
        and actually_paid_usdt > 0
        and credited_amount_usdt = actually_paid_usdt
        and credited_at is not null
      )
    );

drop function public.credit_verified_nowpayments_usdt_payment(uuid, text, text);
drop function public.settle_verified_nowpayments_usdt_payment(
  text, text, text, text, text, text, text, text
);

-- Settlement deliberately ignores config.enabled so already-issued addresses
-- remain creditable while address generation is disabled.
create function public.settle_verified_nowpayments_usdt_payment(
  p_provider_payment_id text,
  p_parent_provider_payment_id text,
  p_qhash_order_id text,
  p_pay_address text,
  p_pay_currency text,
  p_provider_payment_status text,
  p_actually_paid text,
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
  v_actually_paid numeric(36, 18);
  v_outcome_amount numeric(36, 18);
  v_session public.nowpayments_usdt_payments%rowtype;
  v_provider_payment public.nowpayments_usdt_provider_payments%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_ledger_id uuid;
  v_available_after numeric(36, 18);
  v_total_credited numeric(36, 18);
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
      'waiting', 'partially_paid', 'confirming', 'confirmed', 'sending',
      'finished', 'failed', 'refunded', 'expired'
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
    if p_actually_paid is null
      or p_actually_paid !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$'
      or p_outcome_amount is null
      or p_outcome_amount !~ '^(0|[1-9][0-9]{0,17})(\.[0-9]{1,18})?$'
      or p_outcome_currency <> 'usdtbsc'
    then
      raise exception 'invalid_nowpayments_settlement_outcome';
    end if;

    begin
      v_actually_paid := p_actually_paid::numeric(36, 18);
      v_outcome_amount := p_outcome_amount::numeric(36, 18);
    exception
      when numeric_value_out_of_range then
        raise exception 'invalid_nowpayments_settlement_outcome';
    end;

    if v_actually_paid <= 0 or v_outcome_amount <= 0 then
      raise exception 'invalid_nowpayments_settlement_outcome';
    end if;
  elsif p_actually_paid is not null
    or p_outcome_amount is not null
    or p_outcome_currency is not null
  then
    raise exception 'unexpected_nowpayments_settlement_outcome';
  end if;

  v_payment_kind := case
    when p_parent_provider_payment_id is null then 'original'
    else 'repeated'
  end;

  if v_payment_kind = 'original' then
    select * into v_session
    from public.nowpayments_usdt_payments
    where provider_payment_id = p_provider_payment_id
    for update;
  else
    select * into v_session
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
      and (p_qhash_order_id is null or v_session.qhash_order_id <> p_qhash_order_id::uuid)
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
    session_id, user_id, provider_payment_id, parent_provider_payment_id,
    payment_kind, qhash_order_id, pay_address, pay_currency,
    provider_payment_status, actually_paid_usdt, outcome_amount_usdt,
    outcome_currency, provider_verified_at
  ) values (
    v_session.id, v_session.user_id, p_provider_payment_id,
    p_parent_provider_payment_id, v_payment_kind, v_session.qhash_order_id,
    p_pay_address, p_pay_currency, p_provider_payment_status,
    case when p_provider_payment_status = 'finished' then v_actually_paid else null end,
    case when p_provider_payment_status = 'finished' then v_outcome_amount else null end,
    case when p_provider_payment_status = 'finished' then p_outcome_currency else null end,
    now()
  ) on conflict (provider_payment_id) do nothing;

  select * into v_provider_payment
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
      or v_provider_payment.actually_paid_usdt <> v_actually_paid
      or v_provider_payment.outcome_amount_usdt <> v_outcome_amount
      or v_provider_payment.outcome_currency <> p_outcome_currency
      or v_provider_payment.credited_amount_usdt <> v_actually_paid
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

    select sum(available_delta_usdt)
      into v_total_credited
    from public.nowpayments_usdt_ledger_entries
    where provider_payment_record_id = v_provider_payment.id
      and entry_type in ('deposit_credit', 'deposit_credit_correction');

    if v_ledger_id is null or v_total_credited <> v_provider_payment.credited_amount_usdt then
      raise exception 'nowpayments_settlement_ledger_missing';
    end if;

    return jsonb_build_object(
      'status', 'already_credited',
      'provider_payment_id', v_provider_payment.provider_payment_id,
      'ledger_entry_id', v_ledger_id,
      'asset', 'USDT',
      'credited_amount_usdt', v_provider_payment.credited_amount_usdt::text
    );
  end if;

  if p_provider_payment_status <> 'finished' then
    v_status_rank := case p_provider_payment_status
      when 'waiting' then 10 when 'partially_paid' then 20
      when 'confirming' then 30 when 'confirmed' then 40
      when 'sending' then 50 else 100
    end;
    v_existing_status_rank := case v_provider_payment.provider_payment_status
      when 'waiting' then 10 when 'partially_paid' then 20
      when 'confirming' then 30 when 'confirmed' then 40
      when 'sending' then 50 else 100
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
        actually_paid_usdt = null,
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
      actually_paid_usdt = v_actually_paid,
      outcome_amount_usdt = v_outcome_amount,
      outcome_currency = 'usdtbsc',
      provider_verified_at = now(),
      updated_at = now()
  where id = v_provider_payment.id
  returning * into v_provider_payment;

  insert into public.nowpayments_usdt_wallets (user_id)
  values (v_session.user_id)
  on conflict (user_id) do nothing;

  select * into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = v_session.user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_available_after := v_wallet.available_balance_usdt + v_actually_paid;
  v_ledger_id := gen_random_uuid();

  insert into public.nowpayments_usdt_ledger_entries (
    id, user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    payment_id, provider_payment_record_id, description, metadata
  ) values (
    v_ledger_id, v_session.user_id, 'deposit_credit', 'USDT',
    v_actually_paid, 0, v_wallet.available_balance_usdt, v_available_after,
    v_wallet.reserved_balance_usdt, v_wallet.reserved_balance_usdt,
    v_session.id, v_provider_payment.id,
    'Independently verified NOWPayments gross USDTBSC deposit credited',
    jsonb_build_object(
      'provider', 'NOWPayments',
      'provider_payment_id', v_provider_payment.provider_payment_id,
      'parent_provider_payment_id', v_provider_payment.parent_provider_payment_id,
      'payment_kind', v_provider_payment.payment_kind,
      'provider_payment_status', 'finished',
      'source_amount_field', 'actually_paid',
      'actually_paid_usdt', v_actually_paid::text,
      'outcome_amount_usdt', v_outcome_amount::text,
      'outcome_currency', p_outcome_currency,
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
  set credited_amount_usdt = v_actually_paid,
      credited_at = now(),
      updated_at = now()
  where id = v_provider_payment.id;

  if v_payment_kind = 'original' then
    update public.nowpayments_usdt_payments
    set provider_payment_status = 'finished',
        verification_status = 'verified',
        outcome_amount = v_outcome_amount,
        outcome_currency = 'USDT',
        verified_at = now(),
        credited_amount_usdt = v_actually_paid,
        credited_at = now(),
        session_status = 'terminal',
        settled_by_provider_payment_id = coalesce(
          settled_by_provider_payment_id, p_provider_payment_id
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
          settled_by_provider_payment_id, p_provider_payment_id
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
    'credited_amount_usdt', v_actually_paid::text,
    'available_balance_usdt', v_available_after::text,
    'reserved_balance_usdt', v_wallet.reserved_balance_usdt::text
  );
end;
$function$;

revoke all on function public.settle_verified_nowpayments_usdt_payment(
  text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.settle_verified_nowpayments_usdt_payment(
  text, text, text, text, text, text, text, text, text
) to service_role;

comment on column public.nowpayments_usdt_provider_payments.actually_paid_usdt is
  'Exact positive gross actually_paid from independently verified finished NOWPayments status evidence.';
comment on column public.nowpayments_usdt_provider_payments.outcome_amount_usdt is
  'Net provider outcome retained separately for merchant-fee auditing; never used as the wallet credit amount.';
comment on column public.nowpayments_usdt_provider_payments.credited_amount_usdt is
  'Gross USDT amount credited to the user; equal to actually_paid_usdt for finished credited payments.';
comment on function public.settle_verified_nowpayments_usdt_payment(
  text, text, text, text, text, text, text, text, text
) is
  'Atomically records independently verified NOWPayments status and credits exact positive finished USDTBSC actually_paid while retaining outcome_amount for merchant-fee auditing.';

do $postflight$
begin
  if exists (select 1 from public.nowpayments_usdt_provider_payments) then
    if not exists (
        select 1 from public.nowpayments_usdt_config
        where id = 'USDT-BEP20' and enabled = false
      )
      or (select count(*) from public.nowpayments_usdt_provider_payments) <> 2
      or (select count(*) from public.nowpayments_usdt_ledger_entries) <> 4
      or (select count(*) from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit') <> 2
      or (select count(*) from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit_correction') <> 2
      or not exists (
        select 1 from public.nowpayments_usdt_wallets
        where available_balance_usdt = 6 and reserved_balance_usdt = 0
      )
      or exists (
        select 1
        from public.nowpayments_usdt_provider_payments
        where actually_paid_usdt <> 3
          or credited_amount_usdt <> 3
          or credited_at is null
      )
      or not exists (
        select 1 from public.nowpayments_usdt_payments
        where provider_payment_id = '5649600523'
          and credited_amount_usdt = 3
          and outcome_amount = 2.95192543
      )
      or (select sum(available_delta_usdt) from public.nowpayments_usdt_ledger_entries) <> 6
    then
      raise exception 'NOWPayments gross-credit postflight failed';
    end if;
  end if;

  if to_regprocedure('public.credit_verified_nowpayments_usdt_payment(uuid,text,text)') is not null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)') is not null
    or to_regprocedure('public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)') is null
  then
    raise exception 'NOWPayments gross-credit callable-path postflight failed';
  end if;
end;
$postflight$;
