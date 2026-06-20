-- Atomic wallet increment helper used by earning/referral processors.
-- Live production IDs are UUID, so keep this function UUID-based.
create or replace function public.increment_wallet_balance(
  p_user_id uuid,
  p_amount numeric
)
returns table (
  balance_before numeric,
  balance_after numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance_before numeric;
  v_balance_after numeric;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if p_amount is null or p_amount = 0 then
    raise exception 'invalid_amount';
  end if;

  update public.wallets
  set balance = balance + p_amount,
      updated_at = now()
  where user_id = p_user_id
  returning balance - p_amount, balance
  into v_balance_before, v_balance_after;

  if v_balance_after is null then
    raise exception 'wallet_not_found';
  end if;

  balance_before := v_balance_before;
  balance_after := v_balance_after;
  return next;
end;
$$;

comment on function public.increment_wallet_balance(uuid, numeric) is
  'Atomically increments a wallet balance and returns the before/after balances.';

alter table public.investments
  add column if not exists ends_at timestamptz,
  add column if not exists next_earning_at timestamptz;

comment on column public.investments.ends_at is
  'Precise timestamp when the investment term ends.';

comment on column public.investments.next_earning_at is
  'Precise timestamp when the next mining earning becomes due.';

update public.investments i
set
  ends_at = coalesce(
    i.ends_at,
    i.created_at + ((p.duration_days || ' days')::interval)
  ),
  next_earning_at = coalesce(
    i.next_earning_at,
    coalesce(i.last_earning_at, i.created_at) + interval '24 hours'
  )
from public.plans p
where p.id::text = i.plan_id::text
  and (i.ends_at is null or i.next_earning_at is null);

create index if not exists idx_investments_due_earnings
  on public.investments (next_earning_at)
  where status = 'active';
