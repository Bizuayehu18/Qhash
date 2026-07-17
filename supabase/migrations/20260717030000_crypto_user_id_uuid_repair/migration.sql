-- Repair the crypto identity boundary before retrying manual crediting.
-- QHash's live Supabase profiles, wallets, and ledger use UUID user IDs, while
-- the initial crypto foundation stored the same identifiers as text. Validate
-- every existing value first, convert both crypto tables atomically, attach
-- profile foreign keys, and replace the two writer RPCs with UUID-safe bodies.

do $$
begin
  if exists (
    select 1
    from public.crypto_deposit_addresses
    where user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'crypto_deposit_addresses.user_id contains a non-UUID value';
  end if;

  if exists (
    select 1
    from public.crypto_deposits
    where user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'crypto_deposits.user_id contains a non-UUID value';
  end if;

  if exists (
    select 1
    from public.crypto_deposit_addresses as address
    left join public.profiles as profile
      on profile.id = address.user_id::uuid
    where profile.id is null
  ) then
    raise exception 'crypto_deposit_addresses.user_id contains an unknown profile ID';
  end if;

  if exists (
    select 1
    from public.crypto_deposits as deposit
    left join public.profiles as profile
      on profile.id = deposit.user_id::uuid
    where profile.id is null
  ) then
    raise exception 'crypto_deposits.user_id contains an unknown profile ID';
  end if;

  if exists (
    select 1
    from public.crypto_deposits as deposit
    join public.crypto_deposit_addresses as address
      on address.id = deposit.address_id
    where deposit.user_id::uuid <> address.user_id::uuid
  ) then
    raise exception 'crypto deposit user does not match its assigned address user';
  end if;
end
$$;

alter table public.crypto_deposit_addresses
  alter column user_id type uuid
  using user_id::uuid;

alter table public.crypto_deposits
  alter column user_id type uuid
  using user_id::uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'crypto_deposit_addresses_user_id_fkey'
      and conrelid = 'public.crypto_deposit_addresses'::regclass
  ) then
    alter table public.crypto_deposit_addresses
      add constraint crypto_deposit_addresses_user_id_fkey
      foreign key (user_id) references public.profiles(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'crypto_deposits_user_id_fkey'
      and conrelid = 'public.crypto_deposits'::regclass
  ) then
    alter table public.crypto_deposits
      add constraint crypto_deposits_user_id_fkey
      foreign key (user_id) references public.profiles(id);
  end if;
end
$$;

create or replace function public.apply_bsc_crypto_deposit_confirmation(
  p_deposit_id uuid,
  p_expected_user_id text,
  p_expected_address_id uuid,
  p_expected_tx_hash text,
  p_expected_event_index integer,
  p_expected_from_address text,
  p_expected_to_address text,
  p_expected_amount_raw_text text,
  p_expected_amount_usdt_text text,
  p_expected_block_number bigint,
  p_expected_confirmations integer,
  p_calculated_confirmations integer,
  p_confirmation_threshold integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_user_id uuid;
  v_expected_amount_raw numeric(78, 0);
  v_expected_amount_usdt numeric(36, 6);
  v_now timestamptz := now();
  v_updated record;
begin
  if p_deposit_id is null
    or p_expected_user_id is null
    or btrim(p_expected_user_id) = ''
    or p_expected_address_id is null
    or p_expected_tx_hash is null
    or p_expected_event_index is null
    or p_expected_from_address is null
    or p_expected_to_address is null
    or p_expected_amount_raw_text is null
    or p_expected_amount_usdt_text is null
    or p_expected_block_number is null
    or p_expected_confirmations is null
    or p_calculated_confirmations is null
    or p_confirmation_threshold is null
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  if p_expected_amount_raw_text !~ '^[0-9]+$'
    or p_expected_amount_usdt_text !~ '^[0-9]+(\.[0-9]{1,6})?$'
    or p_expected_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_expected_from_address !~* '^0x[0-9a-f]{40}$'
    or p_expected_to_address !~* '^0x[0-9a-f]{40}$'
    or p_expected_event_index < 0
    or p_expected_block_number < 0
    or p_expected_confirmations < 0
    or p_calculated_confirmations < 0
    or p_confirmation_threshold < 1
    or p_confirmation_threshold > 5000
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  begin
    v_expected_user_id := p_expected_user_id::uuid;
    v_expected_amount_raw := p_expected_amount_raw_text::numeric(78, 0);
    v_expected_amount_usdt := p_expected_amount_usdt_text::numeric(36, 6);
  exception
    when numeric_value_out_of_range or invalid_text_representation then
      return jsonb_build_object('success', false, 'code', 'invalid_input');
  end;

  if v_expected_amount_raw <= 0 or v_expected_amount_usdt <= 0 then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  update public.crypto_deposits as deposit
  set
    confirmations = greatest(deposit.confirmations, p_calculated_confirmations),
    confirmed_at = case
      when p_calculated_confirmations >= p_confirmation_threshold then v_now
      else deposit.confirmed_at
    end,
    status = case
      when p_calculated_confirmations >= p_confirmation_threshold then 'confirmed'
      else deposit.status
    end
  where deposit.id = p_deposit_id
    and deposit.user_id = v_expected_user_id
    and deposit.address_id = p_expected_address_id
    and deposit.network = 'BSC'
    and deposit.asset = 'USDT'
    and lower(deposit.tx_hash) = lower(p_expected_tx_hash)
    and deposit.event_index = p_expected_event_index
    and lower(deposit.from_address) = lower(p_expected_from_address)
    and lower(deposit.to_address) = lower(p_expected_to_address)
    and deposit.amount_raw = v_expected_amount_raw
    and deposit.amount_usdt = v_expected_amount_usdt
    and deposit.block_number = p_expected_block_number
    and deposit.confirmations = p_expected_confirmations
    and deposit.status = 'detected'
    and deposit.confirmed_at is null
    and deposit.exchange_rate_etb is null
    and deposit.credited_amount_etb is null
    and deposit.credited_at is null
    and deposit.swept_at is null
  returning
    deposit.id,
    deposit.confirmations,
    deposit.status,
    deposit.confirmed_at
  into v_updated;

  if not found then
    return jsonb_build_object('success', false, 'code', 'stale_or_ineligible');
  end if;

  return jsonb_build_object(
    'success', true,
    'code', case when v_updated.status = 'confirmed' then 'confirmed' else 'progressed' end,
    'deposit_id', v_updated.id,
    'previous_confirmations', p_expected_confirmations,
    'confirmations', v_updated.confirmations,
    'status', v_updated.status,
    'confirmed_at', v_updated.confirmed_at
  );
end;
$$;

create or replace function public.credit_confirmed_bsc_crypto_deposit(
  p_deposit_id uuid,
  p_admin_id uuid,
  p_expected_user_id text,
  p_expected_address_id uuid,
  p_expected_tx_hash text,
  p_expected_event_index integer,
  p_expected_from_address text,
  p_expected_to_address text,
  p_expected_amount_raw_text text,
  p_expected_amount_usdt_text text,
  p_expected_block_number bigint,
  p_expected_confirmations integer,
  p_calculated_confirmations integer,
  p_expected_exchange_rate_etb_text text,
  p_expected_credited_amount_etb_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin record;
  v_user_exists boolean;
  v_deposit record;
  v_existing_transaction record;
  v_expected_user_id uuid;
  v_expected_amount_raw numeric(78, 0);
  v_expected_amount_usdt numeric(36, 6);
  v_expected_exchange_rate_etb numeric(18, 6);
  v_expected_credited_amount_etb numeric(18, 2);
  v_exchange_rate_etb numeric(18, 6);
  v_credited_amount_etb numeric(18, 2);
  v_balance_before numeric;
  v_balance_after numeric;
  v_transaction_id uuid;
  v_reference_id text;
  v_now timestamptz := now();
begin
  if p_deposit_id is null
    or p_admin_id is null
    or p_expected_user_id is null
    or btrim(p_expected_user_id) = ''
    or p_expected_address_id is null
    or p_expected_tx_hash is null
    or p_expected_event_index is null
    or p_expected_from_address is null
    or p_expected_to_address is null
    or p_expected_amount_raw_text is null
    or p_expected_amount_usdt_text is null
    or p_expected_block_number is null
    or p_expected_confirmations is null
    or p_calculated_confirmations is null
    or p_expected_exchange_rate_etb_text is null
    or p_expected_credited_amount_etb_text is null
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  if p_expected_amount_raw_text !~ '^[0-9]+$'
    or p_expected_amount_usdt_text !~ '^[0-9]+(\.[0-9]{1,6})?$'
    or p_expected_exchange_rate_etb_text !~ '^[0-9]+(\.[0-9]{1,6})?$'
    or p_expected_credited_amount_etb_text !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or p_expected_tx_hash !~* '^0x[0-9a-f]{64}$'
    or p_expected_from_address !~* '^0x[0-9a-f]{40}$'
    or p_expected_to_address !~* '^0x[0-9a-f]{40}$'
    or p_expected_event_index < 0
    or p_expected_block_number < 0
    or p_expected_confirmations < 0
    or p_calculated_confirmations < 20
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  begin
    v_expected_user_id := p_expected_user_id::uuid;
    v_expected_amount_raw := p_expected_amount_raw_text::numeric(78, 0);
    v_expected_amount_usdt := p_expected_amount_usdt_text::numeric(36, 6);
    v_expected_exchange_rate_etb := p_expected_exchange_rate_etb_text::numeric(18, 6);
    v_expected_credited_amount_etb := p_expected_credited_amount_etb_text::numeric(18, 2);
  exception
    when numeric_value_out_of_range or invalid_text_representation then
      return jsonb_build_object('success', false, 'code', 'invalid_input');
  end;

  if v_expected_amount_raw <= 0
    or v_expected_amount_usdt <= 0
    or v_expected_exchange_rate_etb < 1
    or v_expected_exchange_rate_etb > 1000000
    or v_expected_credited_amount_etb <= 0
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  select profile.id, profile.is_admin, profile.is_frozen
    into v_admin
  from public.profiles as profile
  where profile.id = p_admin_id
  for share;

  if not found then
    return jsonb_build_object('success', false, 'code', 'admin_not_found');
  end if;

  if v_admin.is_admin is not true then
    return jsonb_build_object('success', false, 'code', 'not_admin');
  end if;

  if v_admin.is_frozen is true then
    return jsonb_build_object('success', false, 'code', 'admin_frozen');
  end if;

  select deposit.*
    into v_deposit
  from public.crypto_deposits as deposit
  where deposit.id = p_deposit_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'code', 'deposit_not_found');
  end if;

  if v_deposit.user_id <> v_expected_user_id
    or v_deposit.address_id is distinct from p_expected_address_id
    or v_deposit.network <> 'BSC'
    or v_deposit.asset <> 'USDT'
    or lower(v_deposit.tx_hash) <> lower(p_expected_tx_hash)
    or v_deposit.event_index <> p_expected_event_index
    or lower(v_deposit.from_address) <> lower(p_expected_from_address)
    or lower(v_deposit.to_address) <> lower(p_expected_to_address)
    or v_deposit.amount_raw <> v_expected_amount_raw
    or v_deposit.amount_usdt <> v_expected_amount_usdt
    or v_deposit.block_number <> p_expected_block_number
  then
    return jsonb_build_object('success', false, 'code', 'stale_or_ineligible');
  end if;

  v_reference_id := v_deposit.id::text;

  if v_deposit.status = 'credited' then
    if v_deposit.credited_transaction_id is null or v_deposit.credited_by_admin_id is null then
      return jsonb_build_object('success', false, 'code', 'inconsistent_credit_state');
    end if;

    select
      ledger.id,
      ledger.user_id,
      ledger.type,
      ledger.status,
      ledger.amount,
      ledger.balance_before,
      ledger.balance_after,
      ledger.reference_id
      into v_existing_transaction
    from public.transactions as ledger
    where ledger.id = v_deposit.credited_transaction_id
    limit 1;

    if v_deposit.exchange_rate_etb is null
      or v_deposit.credited_amount_etb is null
      or v_deposit.credited_at is null
      or v_existing_transaction.id is null
      or v_existing_transaction.user_id <> v_deposit.user_id
      or v_existing_transaction.type <> 'deposit'::public.transaction_type
      or v_existing_transaction.status <> 'completed'::public.transaction_status
      or round(v_existing_transaction.amount::numeric, 2) <> v_deposit.credited_amount_etb
      or v_existing_transaction.balance_before is null
      or v_existing_transaction.balance_after is null
      or v_existing_transaction.reference_id is distinct from v_reference_id
    then
      return jsonb_build_object('success', false, 'code', 'inconsistent_credit_state');
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'already_credited',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'transaction_id', v_existing_transaction.id,
      'exchange_rate_etb', v_deposit.exchange_rate_etb::text,
      'credited_amount_etb', v_deposit.credited_amount_etb::text,
      'balance_before', v_existing_transaction.balance_before::text,
      'balance_after', v_existing_transaction.balance_after::text,
      'confirmations', v_deposit.confirmations,
      'credited_at', v_deposit.credited_at
    );
  end if;

  if v_deposit.status <> 'confirmed'
    or v_deposit.confirmed_at is null
    or v_deposit.confirmations <> p_expected_confirmations
    or v_deposit.exchange_rate_etb is not null
    or v_deposit.credited_amount_etb is not null
    or v_deposit.credited_at is not null
    or v_deposit.credited_transaction_id is not null
    or v_deposit.credited_by_admin_id is not null
    or v_deposit.swept_at is not null
  then
    return jsonb_build_object('success', false, 'code', 'stale_or_ineligible');
  end if;

  select ledger.id
    into v_existing_transaction
  from public.transactions as ledger
  where ledger.type = 'deposit'::public.transaction_type
    and ledger.reference_id = v_reference_id
  limit 1;

  if found then
    return jsonb_build_object('success', false, 'code', 'inconsistent_credit_state');
  end if;

  begin
    select nullif(btrim(setting.value), '')::numeric(18, 6)
      into v_exchange_rate_etb
    from public.app_settings as setting
    where setting.key = 'usdt_etb_rate'
    limit 1;
  exception
    when numeric_value_out_of_range or invalid_text_representation then
      return jsonb_build_object('success', false, 'code', 'invalid_exchange_rate');
  end;

  if v_exchange_rate_etb is null
    or v_exchange_rate_etb < 1
    or v_exchange_rate_etb > 1000000
    or v_exchange_rate_etb <> v_expected_exchange_rate_etb
  then
    return jsonb_build_object('success', false, 'code', 'rate_changed_or_invalid');
  end if;

  v_credited_amount_etb := round(v_deposit.amount_usdt * v_exchange_rate_etb, 2);

  if v_credited_amount_etb <= 0
    or v_credited_amount_etb > 9999999999999999.99
    or v_credited_amount_etb <> v_expected_credited_amount_etb
  then
    return jsonb_build_object('success', false, 'code', 'credit_amount_changed_or_invalid');
  end if;

  select true
    into v_user_exists
  from public.profiles as profile
  where profile.id = v_deposit.user_id
  for key share;

  if v_user_exists is not true then
    return jsonb_build_object('success', false, 'code', 'user_not_found');
  end if;

  insert into public.wallets (user_id, balance, updated_at)
  values (v_deposit.user_id, 0, v_now)
  on conflict (user_id) do nothing;

  select wallet.balance::numeric
    into v_balance_before
  from public.wallets as wallet
  where wallet.user_id = v_deposit.user_id
  for update;

  if not found or v_balance_before is null then
    raise exception 'crypto_deposit_wallet_lock_failed';
  end if;

  v_balance_after := v_balance_before + v_credited_amount_etb;

  insert into public.transactions (
    user_id,
    type,
    amount,
    status,
    balance_before,
    balance_after,
    description,
    reference_id,
    metadata
  ) values (
    v_deposit.user_id,
    'deposit'::public.transaction_type,
    v_credited_amount_etb,
    'completed'::public.transaction_status,
    v_balance_before,
    v_balance_after,
    'Deposit credited',
    v_reference_id,
    '{}'::jsonb
  )
  returning id into v_transaction_id;

  update public.wallets
  set
    balance = v_balance_after,
    updated_at = v_now
  where user_id = v_deposit.user_id;

  update public.crypto_deposits
  set
    confirmations = greatest(confirmations, p_calculated_confirmations),
    status = 'credited',
    exchange_rate_etb = v_exchange_rate_etb,
    credited_amount_etb = v_credited_amount_etb,
    credited_at = v_now,
    credited_transaction_id = v_transaction_id,
    credited_by_admin_id = v_admin.id
  where id = v_deposit.id
    and status = 'confirmed'
    and credited_transaction_id is null
    and credited_by_admin_id is null;

  if not found then
    raise exception 'crypto_deposit_credit_state_changed';
  end if;

  return jsonb_build_object(
    'success', true,
    'code', 'credited',
    'deposit_id', v_deposit.id,
    'user_id', v_deposit.user_id,
    'transaction_id', v_transaction_id,
    'exchange_rate_etb', v_exchange_rate_etb::text,
    'credited_amount_etb', v_credited_amount_etb::text,
    'balance_before', v_balance_before::text,
    'balance_after', v_balance_after::text,
    'confirmations', greatest(v_deposit.confirmations, p_calculated_confirmations),
    'credited_at', v_now
  );
end;
$$;

comment on function public.apply_bsc_crypto_deposit_confirmation(
  uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
) is 'Applies monotonic confirmation progress using UUID-backed crypto user IDs after server-side canonical BSC USDT verification; never credits or moves funds.';

comment on function public.credit_confirmed_bsc_crypto_deposit(
  uuid, uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, text, text
) is 'Atomically and idempotently credits one canonically revalidated confirmed BSC USDT deposit using UUID-backed crypto user IDs; service-role only.';
