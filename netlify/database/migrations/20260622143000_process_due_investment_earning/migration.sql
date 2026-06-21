-- Add an atomic due-investment earning processor.
-- This keeps earning payouts tied to each investment's exact next_earning_at timestamp.
-- Do not edit earlier applied Netlify migrations.

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

revoke all on function public.process_due_investment_earning(uuid, text, text) from public;
revoke all on function public.process_due_investment_earning(uuid, text, text) from anon;
revoke all on function public.process_due_investment_earning(uuid, text, text) from authenticated;
grant execute on function public.process_due_investment_earning(uuid, text, text) to service_role;
