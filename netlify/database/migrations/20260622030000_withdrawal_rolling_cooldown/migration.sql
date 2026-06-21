-- Change withdrawal limit from Ethiopia calendar-day reset to a rolling 24-hour cooldown.
-- Do not edit earlier applied Netlify migrations.

create or replace function public.request_withdrawal_tx(
  p_user_id text,
  p_amount numeric,
  p_method public.payment_method_type,
  p_account_name text,
  p_account_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_wallet record;
  v_withdrawal_id uuid;
  v_min_amount numeric := 200;
  v_fee_percent numeric := 5;
  v_fee_amount numeric := 0;
  v_net_amount numeric := 0;
  v_withdrawals_paused boolean := false;
  v_raw_setting text;
  v_last_withdrawal_at timestamptz;
  v_next_allowed_at timestamptz;
begin
  if p_user_id is null or length(trim(p_user_id)) = 0 then
    raise exception 'missing_user_id';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_account_name is null or length(trim(p_account_name)) < 2 then
    raise exception 'invalid_account_name';
  end if;

  if p_account_number is null or length(trim(p_account_number)) < 5 then
    raise exception 'invalid_account_number';
  end if;

  select value::text
    into v_raw_setting
  from public.app_settings
  where key = 'withdrawals_paused'
  limit 1;

  v_withdrawals_paused :=
    lower(trim(both '"' from coalesce(v_raw_setting, 'false'))) in ('true', '1', 'yes', 'on');

  if v_withdrawals_paused then
    raise exception 'withdrawals_paused';
  end if;

  select nullif(trim(both '"' from value::text), '')::numeric
    into v_min_amount
  from public.app_settings
  where key = 'min_withdrawal_amount'
  limit 1;

  v_min_amount := coalesce(v_min_amount, 200);

  select nullif(trim(both '"' from value::text), '')::numeric
    into v_fee_percent
  from public.app_settings
  where key = 'withdrawal_fee_percent'
  limit 1;

  v_fee_percent := coalesce(v_fee_percent, 5);

  if p_amount < v_min_amount then
    raise exception 'amount_below_minimum';
  end if;

  if v_fee_percent < 0 or v_fee_percent >= 100 then
    raise exception 'invalid_fee_percent';
  end if;

  select id, is_frozen
    into v_profile
  from public.profiles
  where id::text = p_user_id::text
  limit 1;

  if v_profile.id is null or v_profile.is_frozen = true then
    raise exception 'account_frozen_or_unavailable';
  end if;

  -- Rolling 24-hour cooldown from this user's latest submitted withdrawal.
  select max(created_at)
    into v_last_withdrawal_at
  from public.withdrawals
  where user_id::text = p_user_id::text;

  if v_last_withdrawal_at is not null then
    v_next_allowed_at := v_last_withdrawal_at + interval '24 hours';
    if now() < v_next_allowed_at then
      raise exception 'withdrawal_cooldown_active:%', v_next_allowed_at;
    end if;
  end if;

  select user_id, balance
    into v_wallet
  from public.wallets
  where user_id::text = p_user_id::text
  for update;

  if v_wallet.user_id is null then
    raise exception 'wallet_not_found';
  end if;

  if v_wallet.balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  v_fee_amount := round((p_amount * v_fee_percent / 100)::numeric, 2);
  v_net_amount := round((p_amount - v_fee_amount)::numeric, 2);

  if v_net_amount <= 0 then
    raise exception 'invalid_net_amount';
  end if;

  update public.wallets
  set balance = balance - p_amount,
      updated_at = now()
  where user_id::text = p_user_id::text;

  insert into public.withdrawals (
    user_id,
    amount,
    method,
    account_name,
    account_number,
    status,
    fee_percent,
    fee_amount,
    net_amount
  )
  values (
    p_user_id,
    p_amount,
    p_method,
    trim(p_account_name),
    trim(p_account_number),
    'pending',
    v_fee_percent,
    v_fee_amount,
    v_net_amount
  )
  returning id into v_withdrawal_id;

  insert into public.transactions (
    user_id,
    type,
    amount,
    status,
    reference_id,
    balance_before,
    balance_after
  )
  values (
    p_user_id,
    'withdrawal',
    p_amount,
    'pending',
    v_withdrawal_id::text,
    v_wallet.balance,
    v_wallet.balance - p_amount
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'amount', p_amount,
    'fee_percent', v_fee_percent,
    'fee_amount', v_fee_amount,
    'net_amount', v_net_amount,
    'balance_before', v_wallet.balance,
    'balance_after', v_wallet.balance - p_amount,
    'status', 'pending',
    'processing_hours', 24
  );
end;
$$;
