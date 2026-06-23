-- Add atomic plan purchase and investment referral reward RPCs.
-- The migration runner owns transaction boundaries; keep this file free of explicit transaction-control statements.

create or replace function public.purchase_plan_tx(
  p_user_id uuid,
  p_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_plan record;
  v_wallet record;
  v_balance_after numeric;
  v_investment_id uuid;
  v_transaction_id uuid;
  v_now timestamptz := now();
  v_ends_at timestamptz;
  v_next_earning_at timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_user_id'
    );
  end if;

  if p_plan_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_plan_id'
    );
  end if;

  select id, is_frozen
    into v_profile
  from public.profiles
  where id = p_user_id;

  if v_profile.id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'profile_not_found'
    );
  end if;

  if coalesce(v_profile.is_frozen, false) then
    return jsonb_build_object(
      'success', false,
      'code', 'account_frozen'
    );
  end if;

  select
    id,
    name,
    investment_amount::numeric as investment_amount,
    daily_earning::numeric as daily_earning,
    duration_days::integer as duration_days
    into v_plan
  from public.plans
  where id = p_plan_id
    and is_active = true;

  if v_plan.id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'plan_not_found_or_inactive'
    );
  end if;

  if v_plan.investment_amount is null or v_plan.investment_amount <= 0 then
    raise exception 'invalid_plan_investment_amount';
  end if;

  if v_plan.daily_earning is null or v_plan.daily_earning <= 0 then
    raise exception 'invalid_plan_daily_earning';
  end if;

  if v_plan.duration_days is null or v_plan.duration_days <= 0 then
    raise exception 'invalid_plan_duration_days';
  end if;

  select user_id, balance::numeric as balance
    into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_wallet.user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'wallet_not_found'
    );
  end if;

  if v_wallet.balance < v_plan.investment_amount then
    return jsonb_build_object(
      'success', false,
      'code', 'insufficient_balance',
      'balance', v_wallet.balance,
      'required', v_plan.investment_amount
    );
  end if;

  update public.wallets
  set balance = balance - v_plan.investment_amount,
      updated_at = v_now
  where user_id = p_user_id
  returning balance::numeric into v_balance_after;

  if v_balance_after is null then
    raise exception 'wallet_deduction_failed';
  end if;

  v_ends_at := v_now + make_interval(days => v_plan.duration_days);
  v_next_earning_at := v_now + interval '24 hours';

  insert into public.investments (
    user_id,
    plan_id,
    invested_amount,
    daily_earning,
    start_date,
    end_date,
    ends_at,
    next_earning_at,
    status,
    last_earning_at
  ) values (
    p_user_id,
    v_plan.id,
    v_plan.investment_amount,
    v_plan.daily_earning,
    v_now,
    v_ends_at,
    v_ends_at,
    v_next_earning_at,
    'active'::public.investment_status,
    v_now
  )
  returning id into v_investment_id;

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
    p_user_id,
    'plan_purchase',
    v_plan.investment_amount,
    'completed',
    v_wallet.balance,
    v_balance_after,
    'Purchased ' || v_plan.name,
    v_investment_id,
    jsonb_build_object(
      'plan_id', v_plan.id,
      'plan_name', v_plan.name
    )
  )
  returning id into v_transaction_id;

  return jsonb_build_object(
    'success', true,
    'investment', jsonb_build_object(
      'id', v_investment_id,
      'plan_id', v_plan.id,
      'plan_name', v_plan.name,
      'invested_amount', v_plan.investment_amount,
      'daily_earning', v_plan.daily_earning,
      'duration_days', v_plan.duration_days,
      'start_date', v_now,
      'end_date', v_ends_at,
      'ends_at', v_ends_at,
      'next_earning_at', v_next_earning_at,
      'last_earning_at', v_now
    ),
    'transaction_id', v_transaction_id,
    'balance_before', v_wallet.balance,
    'balance_after', v_balance_after,
    'new_balance', v_balance_after
  );
end;
$$;

create or replace function public.credit_investment_referral_reward(
  p_referral_id uuid,
  p_purchaser_user_id uuid,
  p_referrer_user_id uuid,
  p_investment_id uuid,
  p_level integer,
  p_percent numeric,
  p_investment_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referral record;
  v_reward_amount numeric;
  v_balance_before numeric;
  v_balance_after numeric;
  v_tx_id uuid;
  v_constraint_name text;
begin
  if p_referral_id is null then
    raise exception 'missing_referral_id';
  end if;

  if p_purchaser_user_id is null or p_referrer_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if p_investment_id is null then
    raise exception 'missing_investment_id';
  end if;

  if p_level not in (1, 2, 3) then
    raise exception 'invalid_referral_level';
  end if;

  if p_purchaser_user_id = p_referrer_user_id then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'self_reward',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  if p_percent is null or p_percent <= 0 or p_investment_amount is null or p_investment_amount <= 0 then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'invalid_reward_amount',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  select id, total_investment_rewards
    into v_referral
  from public.referrals
  where id = p_referral_id
    and referred_user_id = p_purchaser_user_id
    and referrer_id = p_referrer_user_id
    and level = p_level
  for update;

  if v_referral.id is null then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'referral_not_found',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  if not exists (
    select 1
    from public.investments
    where user_id = p_referrer_user_id
      and status = 'active'::public.investment_status
  ) then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'inactive',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  v_reward_amount := round(((p_investment_amount * p_percent) / 100)::numeric, 2);

  if v_reward_amount <= 0 then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'zero_reward',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  begin
    insert into public.referral_reward_logs (
      investment_id,
      earning_reference_id,
      purchaser_user_id,
      earner_user_id,
      referrer_user_id,
      referred_user_id,
      level,
      reward_type,
      reward_amount
    )
    values (
      p_investment_id,
      null,
      p_purchaser_user_id,
      null,
      p_referrer_user_id,
      p_purchaser_user_id,
      p_level,
      'investment',
      v_reward_amount
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if coalesce(v_constraint_name, '') not in (
        'uq_referral_reward_log',
        'referral_reward_logs_unique_investment'
      ) then
        raise;
      end if;

      return jsonb_build_object(
        'processed', false,
        'skipped', true,
        'reason', 'duplicate',
        'level', p_level,
        'referrer_user_id', p_referrer_user_id,
        'investment_id', p_investment_id,
        'reward_amount', 0
      );
  end;

  select balance_before, balance_after
    into v_balance_before, v_balance_after
  from public.increment_wallet_balance(p_referrer_user_id, v_reward_amount);

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
    p_referrer_user_id,
    'referral_investment_bonus',
    v_reward_amount,
    'completed',
    v_balance_before,
    v_balance_after,
    format('Level %s investment referral bonus (%s%%)', p_level, p_percent),
    p_investment_id,
    jsonb_build_object(
      'reward_type', 'investment',
      'level', p_level,
      'percentage', p_percent,
      'investment_amount', p_investment_amount,
      'purchaser_id', p_purchaser_user_id,
      'investment_id', p_investment_id,
      'referral_id', p_referral_id
    )
  )
  returning id into v_tx_id;

  update public.referrals
  set total_investment_rewards = coalesce(total_investment_rewards, 0) + v_reward_amount
  where id = p_referral_id;

  return jsonb_build_object(
    'processed', true,
    'skipped', false,
    'reason', null,
    'level', p_level,
    'referrer_user_id', p_referrer_user_id,
    'reward_amount', v_reward_amount,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'transaction_id', v_tx_id,
    'investment_id', p_investment_id
  );
end;
$$;

revoke all on function public.purchase_plan_tx(uuid, uuid) from public;
revoke all on function public.credit_investment_referral_reward(uuid, uuid, uuid, uuid, integer, numeric, numeric) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.purchase_plan_tx(uuid, uuid) from anon;
    revoke all on function public.credit_investment_referral_reward(uuid, uuid, uuid, uuid, integer, numeric, numeric) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.purchase_plan_tx(uuid, uuid) from authenticated;
    revoke all on function public.credit_investment_referral_reward(uuid, uuid, uuid, uuid, integer, numeric, numeric) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purchase_plan_tx(uuid, uuid) to service_role;
    grant execute on function public.credit_investment_referral_reward(uuid, uuid, uuid, uuid, integer, numeric, numeric) to service_role;
  end if;
end $$;
