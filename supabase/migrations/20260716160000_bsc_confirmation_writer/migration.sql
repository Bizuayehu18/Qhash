-- Atomically apply canonically revalidated BSC USDT confirmation progress.
-- This function never credits wallets, inserts transactions, signs, sweeps, or moves funds.

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
  v_expected_amount_raw numeric(78, 0);
  v_expected_amount_usdt numeric(36, 6);
  v_now timestamptz := now();
  v_updated record;
begin
  if p_deposit_id is null
    or p_expected_user_id is null
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
    and deposit.user_id = p_expected_user_id
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

revoke all on function public.apply_bsc_crypto_deposit_confirmation(
  uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.apply_bsc_crypto_deposit_confirmation(
      uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
    ) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.apply_bsc_crypto_deposit_confirmation(
      uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
    ) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.apply_bsc_crypto_deposit_confirmation(
      uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
    ) to service_role;
  end if;
end $$;

comment on function public.apply_bsc_crypto_deposit_confirmation(
  uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
) is 'Applies monotonic confirmation progress after server-side canonical BSC USDT receipt/log verification; never credits or moves funds.';
