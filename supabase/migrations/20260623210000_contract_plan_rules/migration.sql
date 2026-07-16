-- Add professional QHash contract plans, eligibility rules, and expiry notifications.
-- The migration runner owns transaction boundaries; keep this file free of explicit transaction-control statements.

alter table public.plans
  add column if not exists max_active_per_user integer not null default 1,
  add column if not exists required_active_level1_referrals integer not null default 0,
  add column if not exists required_active_level2_referrals integer not null default 0,
  add column if not exists required_active_level3_referrals integer not null default 0,
  add column if not exists display_order integer not null default 0,
  add column if not exists is_popular boolean not null default false,
  add column if not exists icon_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_max_active_per_user_positive'
  ) then
    alter table public.plans
      add constraint plans_max_active_per_user_positive check (max_active_per_user > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_required_level1_nonnegative'
  ) then
    alter table public.plans
      add constraint plans_required_level1_nonnegative check (required_active_level1_referrals >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_required_level2_nonnegative'
  ) then
    alter table public.plans
      add constraint plans_required_level2_nonnegative check (required_active_level2_referrals >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_required_level3_nonnegative'
  ) then
    alter table public.plans
      add constraint plans_required_level3_nonnegative check (required_active_level3_referrals >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.plans'::regclass
      and conname = 'plans_display_order_nonnegative'
  ) then
    alter table public.plans
      add constraint plans_display_order_nonnegative check (display_order >= 0) not valid;
  end if;
end $$;

-- Hide the previous plan set from new purchases while preserving historical plan_id references.
update public.plans
set is_active = false
where is_active = true
  and name not like 'QH-% Contract';

with desired(
  name,
  investment_amount,
  daily_earning,
  duration_days,
  max_active_per_user,
  required_active_level1_referrals,
  required_active_level2_referrals,
  required_active_level3_referrals,
  display_order,
  is_popular,
  icon_key
) as (
  values
    ('QH-1K Contract', 1000::double precision, 50::double precision, 50, 1, 0, 0, 0, 10, false, 'contract'),
    ('QH-3K Contract', 3000::double precision, 150::double precision, 50, 2, 1, 0, 0, 20, false, 'hashrate'),
    ('QH-5K Contract', 5000::double precision, 250::double precision, 50, 3, 3, 1, 0, 30, true, 'growth'),
    ('QH-10K Contract', 10000::double precision, 500::double precision, 60, 3, 5, 3, 1, 40, false, 'node'),
    ('QH-30K Contract', 30000::double precision, 1500::double precision, 60, 3, 7, 5, 3, 50, false, 'cluster'),
    ('QH-50K Contract', 50000::double precision, 2500::double precision, 60, 3, 9, 7, 5, 60, false, 'vault'),
    ('QH-100K Contract', 100000::double precision, 5000::double precision, 60, 3, 11, 9, 7, 70, false, 'enterprise')
)
insert into public.plans (
  name,
  investment_amount,
  daily_earning,
  duration_days,
  is_active,
  max_active_per_user,
  required_active_level1_referrals,
  required_active_level2_referrals,
  required_active_level3_referrals,
  display_order,
  is_popular,
  icon_key
)
select
  d.name,
  d.investment_amount,
  d.daily_earning,
  d.duration_days,
  true,
  d.max_active_per_user,
  d.required_active_level1_referrals,
  d.required_active_level2_referrals,
  d.required_active_level3_referrals,
  d.display_order,
  d.is_popular,
  d.icon_key
from desired d
where not exists (
  select 1
  from public.plans p
  where p.name = d.name
);

with desired(
  name,
  investment_amount,
  daily_earning,
  duration_days,
  max_active_per_user,
  required_active_level1_referrals,
  required_active_level2_referrals,
  required_active_level3_referrals,
  display_order,
  is_popular,
  icon_key
) as (
  values
    ('QH-1K Contract', 1000::double precision, 50::double precision, 50, 1, 0, 0, 0, 10, false, 'contract'),
    ('QH-3K Contract', 3000::double precision, 150::double precision, 50, 2, 1, 0, 0, 20, false, 'hashrate'),
    ('QH-5K Contract', 5000::double precision, 250::double precision, 50, 3, 3, 1, 0, 30, true, 'growth'),
    ('QH-10K Contract', 10000::double precision, 500::double precision, 60, 3, 5, 3, 1, 40, false, 'node'),
    ('QH-30K Contract', 30000::double precision, 1500::double precision, 60, 3, 7, 5, 3, 50, false, 'cluster'),
    ('QH-50K Contract', 50000::double precision, 2500::double precision, 60, 3, 9, 7, 5, 60, false, 'vault'),
    ('QH-100K Contract', 100000::double precision, 5000::double precision, 60, 3, 11, 9, 7, 70, false, 'enterprise')
)
update public.plans p
set investment_amount = d.investment_amount,
    daily_earning = d.daily_earning,
    duration_days = d.duration_days,
    is_active = true,
    max_active_per_user = d.max_active_per_user,
    required_active_level1_referrals = d.required_active_level1_referrals,
    required_active_level2_referrals = d.required_active_level2_referrals,
    required_active_level3_referrals = d.required_active_level3_referrals,
    display_order = d.display_order,
    is_popular = d.is_popular,
    icon_key = d.icon_key
from desired d
where p.name = d.name;

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
  v_active_plan_count integer := 0;
  v_active_level1_count integer := 0;
  v_active_level2_count integer := 0;
  v_active_level3_count integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('success', false, 'code', 'missing_user_id');
  end if;

  if p_plan_id is null then
    return jsonb_build_object('success', false, 'code', 'missing_plan_id');
  end if;

  select id, is_frozen
    into v_profile
  from public.profiles
  where id = p_user_id;

  if v_profile.id is null then
    return jsonb_build_object('success', false, 'code', 'profile_not_found');
  end if;

  if coalesce(v_profile.is_frozen, false) then
    return jsonb_build_object('success', false, 'code', 'account_frozen');
  end if;

  select
    id,
    name,
    investment_amount::numeric as investment_amount,
    daily_earning::numeric as daily_earning,
    duration_days::integer as duration_days,
    max_active_per_user::integer as max_active_per_user,
    required_active_level1_referrals::integer as required_active_level1_referrals,
    required_active_level2_referrals::integer as required_active_level2_referrals,
    required_active_level3_referrals::integer as required_active_level3_referrals
    into v_plan
  from public.plans
  where id = p_plan_id
    and is_active = true;

  if v_plan.id is null then
    return jsonb_build_object('success', false, 'code', 'plan_not_found_or_inactive');
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

  if v_plan.max_active_per_user is null or v_plan.max_active_per_user <= 0 then
    raise exception 'invalid_plan_active_limit';
  end if;

  select user_id, balance::numeric as balance
    into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_wallet.user_id is null then
    return jsonb_build_object('success', false, 'code', 'wallet_not_found');
  end if;

  select count(*)::integer
    into v_active_plan_count
  from public.investments
  where user_id = p_user_id
    and plan_id = v_plan.id
    and status = 'active'::public.investment_status;

  if v_active_plan_count >= v_plan.max_active_per_user then
    return jsonb_build_object(
      'success', false,
      'code', 'plan_limit_reached',
      'active_plan_count', v_active_plan_count,
      'max_active_per_user', v_plan.max_active_per_user
    );
  end if;

  select count(distinct r.referred_user_id)::integer
    into v_active_level1_count
  from public.referrals r
  where r.referrer_id = p_user_id
    and r.level = 1
    and exists (
      select 1
      from public.investments i
      where i.user_id = r.referred_user_id
        and i.status = 'active'::public.investment_status
    );

  select count(distinct r.referred_user_id)::integer
    into v_active_level2_count
  from public.referrals r
  where r.referrer_id = p_user_id
    and r.level = 2
    and exists (
      select 1
      from public.investments i
      where i.user_id = r.referred_user_id
        and i.status = 'active'::public.investment_status
    );

  select count(distinct r.referred_user_id)::integer
    into v_active_level3_count
  from public.referrals r
  where r.referrer_id = p_user_id
    and r.level = 3
    and exists (
      select 1
      from public.investments i
      where i.user_id = r.referred_user_id
        and i.status = 'active'::public.investment_status
    );

  if v_active_level1_count < v_plan.required_active_level1_referrals
     or v_active_level2_count < v_plan.required_active_level2_referrals
     or v_active_level3_count < v_plan.required_active_level3_referrals then
    return jsonb_build_object(
      'success', false,
      'code', 'referral_requirement_not_met',
      'active_referrals', jsonb_build_object(
        'level1', v_active_level1_count,
        'level2', v_active_level2_count,
        'level3', v_active_level3_count
      ),
      'required_referrals', jsonb_build_object(
        'level1', v_plan.required_active_level1_referrals,
        'level2', v_plan.required_active_level2_referrals,
        'level3', v_plan.required_active_level3_referrals
      )
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

create or replace function public.process_due_investment_earning(
  p_investment_id uuid,
  p_run_id text default null,
  p_trigger_type text default 'scheduled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_investment record;
  v_due_at timestamptz;
  v_next_at timestamptz;
  v_new_status public.investment_status := 'active';
  v_balance_before numeric;
  v_balance_after numeric;
  v_transaction_id uuid;
  v_total_earned_after numeric;
  v_day_index integer;
begin
  if p_investment_id is null then
    raise exception 'missing_investment_id';
  end if;

  select
    id,
    user_id,
    daily_earning,
    total_earned,
    status,
    created_at,
    start_date,
    end_date,
    last_earning_at,
    ends_at,
    next_earning_at
  into v_investment
  from public.investments
  where id = p_investment_id
  for update;

  if v_investment.id is null then
    return jsonb_build_object(
      'processed', false,
      'reason', 'investment_not_found',
      'investment_id', p_investment_id
    );
  end if;

  if v_investment.status <> 'active'::public.investment_status then
    return jsonb_build_object(
      'processed', false,
      'reason', 'investment_not_active',
      'investment_id', v_investment.id,
      'user_id', v_investment.user_id,
      'status', v_investment.status
    );
  end if;

  if v_investment.next_earning_at is null then
    return jsonb_build_object(
      'processed', false,
      'reason', 'missing_next_earning_at',
      'investment_id', v_investment.id,
      'user_id', v_investment.user_id
    );
  end if;

  if now() < v_investment.next_earning_at then
    return jsonb_build_object(
      'processed', false,
      'reason', 'not_due',
      'investment_id', v_investment.id,
      'user_id', v_investment.user_id,
      'next_earning_at', v_investment.next_earning_at
    );
  end if;

  v_due_at := v_investment.next_earning_at;

  if v_investment.ends_at is not null and v_due_at > v_investment.ends_at then
    update public.investments
    set status = 'completed'::public.investment_status,
        updated_at = now()
    where id = v_investment.id;

    insert into public.notifications (user_id, title, message, is_read, metadata)
    select
      v_investment.user_id,
      'Mining Plan Expired',
      'Your mining plan has expired. You can purchase a new plan if eligible.',
      false,
      jsonb_build_object(
        'type', 'mining_plan_expired',
        'investment_id', v_investment.id,
        'expired_at', now(),
        'source', coalesce(p_trigger_type, 'scheduled'),
        'run_id', p_run_id
      )
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = v_investment.user_id
        and n.metadata->>'type' = 'mining_plan_expired'
        and n.metadata->>'investment_id' = v_investment.id::text
    );

    return jsonb_build_object(
      'processed', false,
      'reason', 'investment_completed',
      'investment_id', v_investment.id,
      'user_id', v_investment.user_id,
      'status', 'completed'
    );
  end if;

  if v_investment.daily_earning is null or v_investment.daily_earning <= 0 then
    raise exception 'invalid_daily_earning';
  end if;

  select balance_before, balance_after
    into v_balance_before, v_balance_after
  from public.increment_wallet_balance(
    v_investment.user_id,
    v_investment.daily_earning
  );

  v_day_index := greatest(
    1,
    floor(
      extract(epoch from (v_due_at - coalesce(v_investment.created_at, v_investment.start_date))) / 86400
    )::integer
  );

  insert into public.transactions (
    user_id,
    type,
    amount,
    status,
    description,
    reference_id,
    balance_before,
    balance_after,
    metadata
  )
  values (
    v_investment.user_id,
    'earning',
    v_investment.daily_earning,
    'completed',
    'Daily mining earnings',
    v_investment.id,
    v_balance_before,
    v_balance_after,
    jsonb_build_object(
      'source', coalesce(p_trigger_type, 'scheduled'),
      'run_id', p_run_id,
      'investment_id', v_investment.id,
      'earning_due_at', v_due_at,
      'earning_date', to_char(v_due_at at time zone 'UTC', 'YYYY-MM-DD'),
      'earning_day_index', v_day_index
    )
  )
  returning id into v_transaction_id;

  v_next_at := v_due_at + interval '24 hours';
  v_total_earned_after := coalesce(v_investment.total_earned, 0) + v_investment.daily_earning;

  if v_investment.ends_at is not null and v_next_at > v_investment.ends_at then
    v_new_status := 'completed'::public.investment_status;
  end if;

  update public.investments
  set last_earning_at = v_due_at,
      next_earning_at = v_next_at,
      total_earned = v_total_earned_after,
      status = v_new_status,
      updated_at = now()
  where id = v_investment.id;

  if v_new_status = 'completed'::public.investment_status then
    insert into public.notifications (user_id, title, message, is_read, metadata)
    select
      v_investment.user_id,
      'Mining Plan Expired',
      'Your mining plan has expired. You can purchase a new plan if eligible.',
      false,
      jsonb_build_object(
        'type', 'mining_plan_expired',
        'investment_id', v_investment.id,
        'expired_at', now(),
        'source', coalesce(p_trigger_type, 'scheduled'),
        'run_id', p_run_id,
        'final_earning_transaction_id', v_transaction_id
      )
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = v_investment.user_id
        and n.metadata->>'type' = 'mining_plan_expired'
        and n.metadata->>'investment_id' = v_investment.id::text
    );
  end if;

  return jsonb_build_object(
    'processed', true,
    'investment_id', v_investment.id,
    'user_id', v_investment.user_id,
    'amount', v_investment.daily_earning,
    'transaction_id', v_transaction_id,
    'earning_due_at', v_due_at,
    'earning_date', to_char(v_due_at at time zone 'UTC', 'YYYY-MM-DD'),
    'earning_day_index', v_day_index,
    'balance_before', v_balance_before,
    'balance_after', v_balance_after,
    'next_earning_at', v_next_at,
    'status', v_new_status,
    'total_earned_after', v_total_earned_after
  );
end;
$$;

revoke all on function public.purchase_plan_tx(uuid, uuid) from public;
revoke all on function public.process_due_investment_earning(uuid, text, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.purchase_plan_tx(uuid, uuid) from anon;
    revoke all on function public.process_due_investment_earning(uuid, text, text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.purchase_plan_tx(uuid, uuid) from authenticated;
    revoke all on function public.process_due_investment_earning(uuid, text, text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.purchase_plan_tx(uuid, uuid) to service_role;
    grant execute on function public.process_due_investment_earning(uuid, text, text) to service_role;
  end if;
end $$;
