-- =========================================================
-- QHash Withdrawal Phase W2
-- Netlify Database-compatible wallet-safe withdrawal RPCs
--
-- Important Netlify DB compatibility:
-- - Existing Netlify migrations use TEXT user IDs:
--   profiles.id text
--   wallets.user_id text
--   transactions.user_id text
--   transactions.reference_id text
-- - Therefore this migration uses text IDs for withdrawals
--   and RPC parameters.
--
-- Design:
-- - User request deducts wallet immediately.
-- - Withdrawal remains pending for review/processing.
-- - No notification is sent when user submits a request.
-- - Approval sends user notification.
-- - Rejection sends user notification and refunds wallet.
-- - Withdrawal fee is 5%.
-- - p_amount is gross amount deducted from wallet.
-- - fee_amount = 5% of p_amount.
-- - net_amount = amount - fee_amount.
-- - User-facing wording must not mention "admin".
-- - withdrawal_processing_hours is display guidance only.
-- =========================================================

begin;

-- ---------------------------------------------------------
-- 0) Ensure required enum types exist
-- ---------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'payment_method_type'
  ) then
    create type public.payment_method_type as enum ('cbe', 'telebirr');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'withdrawal_status'
  ) then
    create type public.withdrawal_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

-- ---------------------------------------------------------
-- 1) Ensure withdrawals table exists
-- ---------------------------------------------------------

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  amount numeric not null check (amount > 0),
  method public.payment_method_type not null,
  account_name text not null,
  account_number text not null,
  status public.withdrawal_status not null default 'pending',
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  fee_percent numeric not null default 5,
  fee_amount numeric not null default 0,
  net_amount numeric not null default 0
);

create index if not exists idx_withdrawals_user_id
  on public.withdrawals(user_id);

create index if not exists idx_withdrawals_status
  on public.withdrawals(status);

create index if not exists idx_withdrawals_created_at
  on public.withdrawals(created_at desc);

-- ---------------------------------------------------------
-- 2) Ensure updated_at trigger exists for withdrawals
-- ---------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_withdrawals_updated_at'
  ) then
    create trigger set_withdrawals_updated_at
    before update on public.withdrawals
    for each row
    execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------
-- 3) Ensure fee columns exist if withdrawals table existed already
-- ---------------------------------------------------------

alter table public.withdrawals
  add column if not exists fee_percent numeric not null default 5,
  add column if not exists fee_amount numeric not null default 0,
  add column if not exists net_amount numeric not null default 0;

comment on column public.withdrawals.fee_percent is
  'Withdrawal fee percentage captured at request time.';

comment on column public.withdrawals.fee_amount is
  'Fee amount deducted from requested gross withdrawal amount.';

comment on column public.withdrawals.net_amount is
  'Net amount payable to the user after fee deduction.';

-- ---------------------------------------------------------
-- 4) Ensure app settings exist
-- ---------------------------------------------------------

insert into public.app_settings (key, value)
values
  ('min_withdrawal_amount', '200'),
  ('withdrawal_fee_percent', '5'),
  ('withdrawals_paused', 'false'),
  ('withdrawal_processing_hours', '24')
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- 5) User request withdrawal transaction
-- ---------------------------------------------------------

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

  -- Setting: withdrawals_paused
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

  -- Setting: minimum withdrawal amount
  select nullif(trim(both '"' from value::text), '')::numeric
    into v_min_amount
  from public.app_settings
  where key = 'min_withdrawal_amount'
  limit 1;

  v_min_amount := coalesce(v_min_amount, 200);

  -- Setting: withdrawal fee percent
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

  -- Reject missing or frozen users.
  select id, is_frozen
    into v_profile
  from public.profiles
  where id = p_user_id
  limit 1;

  if v_profile.id is null or v_profile.is_frozen = true then
    raise exception 'account_frozen_or_unavailable';
  end if;

  -- Lock wallet for atomic balance check/deduction.
  select user_id, balance
    into v_wallet
  from public.wallets
  where user_id = p_user_id
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

  -- Deduct wallet immediately.
  update public.wallets
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  -- Create pending withdrawal.
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

  -- Create pending withdrawal transaction.
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

  -- No notification is sent on withdrawal submission.
  -- User will see the pending request in withdrawal history.
  -- Notification is sent only after approval or rejection.

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

-- ---------------------------------------------------------
-- 6) Approve withdrawal transaction
-- ---------------------------------------------------------

create or replace function public.approve_withdrawal_tx(
  p_admin_id text,
  p_withdrawal_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_withdrawal record;
  v_payable_amount numeric := 0;
begin
  if p_admin_id is null or length(trim(p_admin_id)) = 0 or p_withdrawal_id is null then
    raise exception 'missing_required_id';
  end if;

  select id, is_admin, is_frozen
    into v_admin
  from public.profiles
  where id = p_admin_id
  limit 1;

  if v_admin.id is null or v_admin.is_admin is not true then
    raise exception 'not_admin';
  end if;

  if v_admin.is_frozen = true then
    raise exception 'admin_frozen';
  end if;

  select *
    into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_withdrawal.status <> 'pending' then
    raise exception 'withdrawal_not_pending';
  end if;

  v_payable_amount :=
    case
      when coalesce(v_withdrawal.net_amount, 0) > 0 then v_withdrawal.net_amount
      else round((v_withdrawal.amount * 95 / 100)::numeric, 2)
    end;

  update public.withdrawals
  set status = 'approved',
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
      updated_at = now()
  where id = p_withdrawal_id;

  update public.transactions
  set status = 'completed'
  where type = 'withdrawal'
    and reference_id = p_withdrawal_id::text
    and status = 'pending';

  insert into public.notifications (
    user_id,
    title,
    message,
    is_read
  )
  values (
    v_withdrawal.user_id,
    'Withdrawal approved',
    'Your withdrawal request has been approved. Net payout: ' || v_payable_amount || ' ETB.',
    false
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'approved',
    'amount', v_withdrawal.amount,
    'fee_amount', coalesce(v_withdrawal.fee_amount, round((v_withdrawal.amount * 5 / 100)::numeric, 2)),
    'net_amount', v_payable_amount
  );
end;
$$;

-- ---------------------------------------------------------
-- 7) Reject withdrawal transaction
-- ---------------------------------------------------------

create or replace function public.reject_withdrawal_tx(
  p_admin_id text,
  p_withdrawal_id uuid,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_withdrawal record;
  v_wallet record;
begin
  if p_admin_id is null or length(trim(p_admin_id)) = 0 or p_withdrawal_id is null then
    raise exception 'missing_required_id';
  end if;

  select id, is_admin, is_frozen
    into v_admin
  from public.profiles
  where id = p_admin_id
  limit 1;

  if v_admin.id is null or v_admin.is_admin is not true then
    raise exception 'not_admin';
  end if;

  if v_admin.is_frozen = true then
    raise exception 'admin_frozen';
  end if;

  select *
    into v_withdrawal
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if v_withdrawal.id is null then
    raise exception 'withdrawal_not_found';
  end if;

  if v_withdrawal.status <> 'pending' then
    raise exception 'withdrawal_not_pending';
  end if;

  select user_id, balance
    into v_wallet
  from public.wallets
  where user_id = v_withdrawal.user_id
  for update;

  if v_wallet.user_id is null then
    raise exception 'wallet_not_found';
  end if;

  -- Refund the gross amount originally deducted.
  update public.wallets
  set balance = balance + v_withdrawal.amount,
      updated_at = now()
  where user_id = v_withdrawal.user_id;

  update public.withdrawals
  set status = 'rejected',
      reviewed_by = p_admin_id,
      reviewed_at = now(),
      admin_note = nullif(trim(coalesce(p_admin_note, '')), ''),
      updated_at = now()
  where id = p_withdrawal_id;

  update public.transactions
  set status = 'failed'
  where type = 'withdrawal'
    and reference_id = p_withdrawal_id::text
    and status = 'pending';

  -- Record refund as admin adjustment for auditability.
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
    v_withdrawal.user_id,
    'admin_adjustment',
    v_withdrawal.amount,
    'completed',
    p_withdrawal_id::text,
    v_wallet.balance,
    v_wallet.balance + v_withdrawal.amount
  );

  insert into public.notifications (
    user_id,
    title,
    message,
    is_read
  )
  values (
    v_withdrawal.user_id,
    'Withdrawal rejected',
    'Your withdrawal request was rejected and the full amount was returned to your wallet.',
    false
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'rejected',
    'refunded_amount', v_withdrawal.amount,
    'balance_before', v_wallet.balance,
    'balance_after', v_wallet.balance + v_withdrawal.amount
  );
end;
$$;

-- ---------------------------------------------------------
-- ---------------------------------------------------------
-- 8) Function execution permissions
-- ---------------------------------------------------------
--
-- Do not reference Supabase-only roles here.
-- Netlify Database migration environments may not have:
-- - anon
-- - authenticated
-- - service_role
--
-- Production Supabase permissions were already applied manually.
-- This migration must remain portable for Netlify Database builds.

revoke all on function public.request_withdrawal_tx(
  text,
  numeric,
  public.payment_method_type,
  text,
  text
) from public;

revoke all on function public.approve_withdrawal_tx(
  text,
  uuid,
  text
) from public;

revoke all on function public.reject_withdrawal_tx(
  text,
  uuid,
  text
) from public;

commit;
