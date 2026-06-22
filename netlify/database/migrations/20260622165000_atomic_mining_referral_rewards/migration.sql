-- Add an atomic mining referral reward crediting RPC.
-- This keeps referral reward log, wallet credit, transaction insert, and referral total update together.

create or replace function public.credit_mining_referral_reward(
  p_referral_id uuid,
  p_earner_user_id uuid,
  p_referrer_user_id uuid,
  p_earning_transaction_id uuid,
  p_investment_id uuid,
  p_level integer,
  p_percent numeric,
  p_earning_amount numeric
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

  if p_earner_user_id is null or p_referrer_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if p_earning_transaction_id is null then
    raise exception 'missing_earning_transaction_id';
  end if;

  if p_level not in (1, 2, 3) then
    raise exception 'invalid_referral_level';
  end if;

  if p_percent is null or p_percent <= 0 or p_earning_amount is null or p_earning_amount <= 0 then
    return jsonb_build_object(
      'processed', false,
      'skipped', true,
      'reason', 'invalid_reward_amount',
      'level', p_level,
      'referrer_user_id', p_referrer_user_id,
      'reward_amount', 0
    );
  end if;

  select id, total_mining_rewards
    into v_referral
  from public.referrals
  where id = p_referral_id
    and referred_user_id = p_earner_user_id
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

  v_reward_amount := round(((p_earning_amount * p_percent) / 100)::numeric, 2);

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
      null,
      p_earning_transaction_id,
      null,
      p_earner_user_id,
      p_referrer_user_id,
      p_earner_user_id,
      p_level,
      'mining',
      v_reward_amount
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'referral_reward_logs_unique_mining' then
        raise;
      end if;

      return jsonb_build_object(
        'processed', false,
        'skipped', true,
        'reason', 'duplicate',
        'level', p_level,
        'referrer_user_id', p_referrer_user_id,
        'earning_transaction_id', p_earning_transaction_id,
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
  )
  values (
    p_referrer_user_id,
    'referral_daily_bonus',
    v_reward_amount,
    'completed',
    v_balance_before,
    v_balance_after,
    format('Level %s daily mining referral bonus (%s%%)', p_level, p_percent),
    p_earning_transaction_id,
    jsonb_build_object(
      'reward_type', 'mining',
      'level', p_level,
      'percentage', p_percent,
      'earning_amount', p_earning_amount,
      'earner_user_id', p_earner_user_id,
      'investment_id', p_investment_id,
      'referral_id', p_referral_id
    )
  )
  returning id into v_tx_id;

  update public.referrals
  set total_mining_rewards = coalesce(total_mining_rewards, 0) + v_reward_amount
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
    'earning_transaction_id', p_earning_transaction_id
  );
end;
$$;

revoke all on function public.credit_mining_referral_reward(uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.credit_mining_referral_reward(uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.credit_mining_referral_reward(uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.credit_mining_referral_reward(uuid, uuid, uuid, uuid, uuid, integer, numeric, numeric) to service_role;
  end if;
end $$;
