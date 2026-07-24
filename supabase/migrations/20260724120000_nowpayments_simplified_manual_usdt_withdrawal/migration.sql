-- Simplify manual USDT-BEP20 withdrawal administration without changing
-- reservation accounting or enabling withdrawals.

do $preflight$
declare
  v_trigger_definition text;
begin
  if to_regprocedure(
      'public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)'
    ) is not null
    or to_regprocedure(
      'public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)'
    ) is not null
  then
    raise exception 'simplified NOWPayments USDT withdrawal functions already exist';
  end if;

  if to_regprocedure(
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)'
    ) is null
    or to_regprocedure(
      'public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)'
    ) is null
    or to_regprocedure(
      'public.reject_nowpayments_usdt_withdrawal(uuid,uuid,text,text)'
    ) is null
    or to_regprocedure(
      'public.assert_safe_nowpayments_usdt_withdrawal_destination(text)'
    ) is null
  then
    raise exception 'unexpected deployed NOWPayments USDT withdrawal function fingerprint';
  end if;

  if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'request_nowpayments_usdt_withdrawal'
        and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_request_id text, p_gross_amount_usdt text, p_destination_address text'
        and p.prosecdef
        and p.proowner = 'postgres'::regrole
        and p.proconfig = array['search_path=pg_catalog, public']
    )
    or not has_function_privilege(
      'service_role',
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'anon',
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'unexpected deployed NOWPayments USDT withdrawal request security';
  end if;

  if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.nowpayments_usdt_withdrawals'::regclass
        and conname = 'nowpayments_usdt_withdrawals_state_timestamps_check'
    )
    or not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.nowpayments_usdt_withdrawal_events'::regclass
        and conname = 'nowpayments_usdt_withdrawal_events_status_check'
    )
  then
    raise exception 'unexpected deployed NOWPayments USDT withdrawal constraints';
  end if;

  select pg_get_triggerdef(t.oid)
    into v_trigger_definition
  from pg_trigger t
  where t.tgrelid = 'public.nowpayments_usdt_withdrawals'::regclass
    and t.tgname = 'enforce_nowpayments_usdt_withdrawal_immutability'
    and not t.tgisinternal;

  if v_trigger_definition is null
    or to_regprocedure(
      'public.enforce_nowpayments_usdt_withdrawal_immutability()'
    ) is null
  then
    raise exception 'unexpected deployed NOWPayments USDT withdrawal immutability trigger';
  end if;

  if not exists (
      select 1
      from public.nowpayments_usdt_config
      where id = 'USDT-BEP20'
        and withdrawals_enabled is false
        and withdrawal_minimum_usdt = 2
        and withdrawal_fee_percent = 5
        and asset = 'USDT'
        and network = 'BEP20'
        and provider_currency = 'usdtbsc'
    )
  then
    raise exception 'unexpected NOWPayments USDT withdrawal configuration';
  end if;

  if exists (
      select 1
      from public.nowpayments_usdt_withdrawals
      where status in ('send_locked', 'broadcasted')
    )
  then
    raise exception 'unexpected legacy NOWPayments USDT withdrawal send-boundary state';
  end if;
end;
$preflight$;

alter table public.nowpayments_usdt_withdrawals
  drop constraint nowpayments_usdt_withdrawals_state_timestamps_check,
  add constraint nowpayments_usdt_withdrawals_state_timestamps_check
    check (
      (status = 'reserved'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'reviewing'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'send_locked'
        and send_locked_at is not null and broadcasted_at is null
        and completed_at is null and rejected_at is null)
      or (status = 'broadcasted'
        and send_locked_at is not null and broadcasted_at is not null
        and completed_at is null and rejected_at is null)
      or (status = 'completed'
        and completed_at is not null and rejected_at is null
        and (
          (send_locked_at is not null and broadcasted_at is not null)
          or (
            send_locked_at is null
            and (
              (current_broadcast_id is null and broadcasted_at is null)
              or (current_broadcast_id is not null and broadcasted_at is not null)
            )
          )
        ))
      or (status = 'rejected'
        and send_locked_at is null and broadcasted_at is null
        and completed_at is null and rejected_at is not null
        and rejection_reason is not null and btrim(rejection_reason) <> '')
    );

alter table public.nowpayments_usdt_withdrawal_events
  drop constraint nowpayments_usdt_withdrawal_events_status_check,
  add constraint nowpayments_usdt_withdrawal_events_status_check
    check (
      (action_type = 'request' and from_status is null and to_status = 'reserved')
      or (action_type = 'claim_review' and from_status = 'reserved' and to_status = 'reviewing')
      or (action_type = 'send_lock' and from_status = 'reviewing' and to_status = 'send_locked')
      or (action_type = 'record_broadcast'
        and from_status in ('send_locked', 'broadcasted') and to_status = 'broadcasted')
      or (action_type = 'complete'
        and from_status in ('reserved', 'reviewing', 'broadcasted') and to_status = 'completed')
      or (action_type = 'reject'
        and from_status in ('reserved', 'reviewing') and to_status = 'rejected')
      or (action_type = 'admin_takeover'
        and from_status in ('reviewing', 'send_locked', 'broadcasted') and to_status = from_status)
    );

create or replace function public.enforce_nowpayments_usdt_withdrawal_immutability()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if old.status in ('completed', 'rejected') then
    raise exception 'terminal_nowpayments_usdt_withdrawal_is_immutable';
  end if;

  if new.id <> old.id
    or new.user_id <> old.user_id
    or new.destination_address <> old.destination_address
    or new.asset <> old.asset
    or new.network <> old.network
    or new.provider_currency <> old.provider_currency
    or new.gross_amount_usdt <> old.gross_amount_usdt
    or new.fee_percent <> old.fee_percent
    or new.fee_amount_usdt <> old.fee_amount_usdt
    or new.net_amount_usdt <> old.net_amount_usdt
    or new.requested_at <> old.requested_at
    or new.created_at <> old.created_at
    or new.initial_admin_id is distinct from old.initial_admin_id
       and old.initial_admin_id is not null
  then
    raise exception 'immutable_nowpayments_usdt_withdrawal_snapshot';
  end if;

  if not (
    (old.status = 'reserved' and new.status in ('reviewing', 'completed', 'rejected'))
    or (old.status = 'reviewing'
      and new.status in ('reviewing', 'send_locked', 'completed', 'rejected'))
    or (old.status = 'send_locked' and new.status in ('send_locked', 'broadcasted'))
    or (old.status = 'broadcasted' and new.status in ('broadcasted', 'completed'))
  ) then
    raise exception 'invalid_nowpayments_usdt_withdrawal_transition';
  end if;

  if old.status in ('send_locked', 'broadcasted')
    and new.current_admin_id is distinct from old.current_admin_id
    and new.status <> old.status
  then
    raise exception 'takeover_must_be_a_separate_audited_action';
  end if;

  return new;
end;
$function$;

create function public.complete_nowpayments_usdt_withdrawal_manual(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text,
  p_transaction_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_hash text;
  v_payload text;
  v_from_status text;
  v_created_at timestamptz := clock_timestamp();
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_broadcast public.nowpayments_usdt_withdrawal_broadcasts%rowtype;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
  then
    raise exception 'invalid_nowpayments_usdt_manual_completion';
  end if;
  v_action_id := p_action_id::uuid;
  v_hash := nullif(lower(btrim(p_transaction_hash)), '');
  if v_hash is not null and v_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'invalid_nowpayments_usdt_manual_completion';
  end if;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text
    || '|' || coalesce(v_hash, '');

  select user_id
    into v_user_id
  from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_not_found';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_user_missing';
  end if;
  select *
    into v_withdrawal
  from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_not_found';
  end if;
  select is_admin and not is_frozen
    into v_admin_ok
  from public.profiles
  where id = p_admin_id
  for share;
  if not found or not v_admin_ok then
    raise exception 'nowpayments_usdt_admin_ineligible';
  end if;
  perform 1
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20'
  for share;
  if not found then
    raise exception 'nowpayments_usdt_configuration_missing';
  end if;

  select *
    into v_existing_event
  from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id
  for update;
  if found then
    if v_existing_event.action_type <> 'complete'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then
      raise exception 'nowpayments_usdt_action_id_conflict';
    end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status not in ('reserved', 'reviewing') then
    raise exception 'invalid_nowpayments_usdt_withdrawal_owner_or_state';
  end if;
  perform public.assert_safe_nowpayments_usdt_withdrawal_destination(
    v_withdrawal.destination_address
  );

  select *
    into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = v_user_id
  for update;
  if not found
    or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt
  then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;
  v_from_status := v_withdrawal.status;

  if v_hash is not null then
    insert into public.nowpayments_usdt_withdrawal_broadcasts (
      withdrawal_id,
      recorded_by,
      transaction_hash,
      destination_address,
      net_amount_usdt,
      recorded_at
    ) values (
      v_withdrawal.id,
      p_admin_id,
      v_hash,
      v_withdrawal.destination_address,
      v_withdrawal.net_amount_usdt,
      v_created_at
    )
    returning * into v_broadcast;
  end if;

  update public.nowpayments_usdt_wallets
  set reserved_balance_usdt =
        v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id,
    entry_type,
    asset,
    available_delta_usdt,
    reserved_delta_usdt,
    available_before_usdt,
    available_after_usdt,
    reserved_before_usdt,
    reserved_after_usdt,
    withdrawal_id,
    description,
    metadata
  ) values (
    v_user_id,
    'withdrawal_settlement',
    'USDT',
    0,
    -v_withdrawal.gross_amount_usdt,
    v_wallet.available_balance_usdt,
    v_wallet.available_balance_usdt,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
    v_withdrawal.id,
    'Administrator-confirmed manual USDT-BEP20 withdrawal settled',
    jsonb_strip_nulls(jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
      'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
      'transaction_hash', v_hash
    ))
  );

  update public.nowpayments_usdt_withdrawals
  set status = 'completed',
      initial_admin_id = coalesce(initial_admin_id, p_admin_id),
      current_admin_id = p_admin_id,
      claimed_at = coalesce(claimed_at, v_created_at),
      broadcasted_at = case when v_hash is null then null else v_created_at end,
      current_broadcast_id = case when v_hash is null then null else v_broadcast.id end,
      completed_at = v_created_at,
      updated_at = now()
  where id = v_withdrawal.id
  returning * into v_withdrawal;

  v_result := jsonb_strip_nulls(jsonb_build_object(
    'withdrawal_id', v_withdrawal.id,
    'status', 'completed',
    'transaction_hash', v_hash,
    'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
    'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
    'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
    'available_balance_usdt', v_wallet.available_balance_usdt::text,
    'reserved_balance_usdt',
      (v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt)::text
  ));
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id,
    user_id,
    actor_id,
    action_id,
    action_type,
    from_status,
    to_status,
    canonical_payload,
    result_snapshot
  ) values (
    v_withdrawal.id,
    v_user_id,
    p_admin_id,
    v_action_id,
    'complete',
    v_from_status,
    'completed',
    v_payload,
    v_result
  );
  return v_result;
end;
$function$;

create function public.reject_nowpayments_usdt_withdrawal_manual(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_action_id uuid;
  v_user_id uuid;
  v_admin_ok boolean;
  v_payload text;
  v_from_status text;
  v_created_at timestamptz := clock_timestamp();
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_result jsonb;
begin
  if p_withdrawal_id is null or p_admin_id is null
    or not public.is_canonical_uuid_v4(p_action_id)
  then
    raise exception 'invalid_nowpayments_usdt_manual_rejection';
  end if;
  v_action_id := p_action_id::uuid;
  v_payload := p_withdrawal_id::text || '|' || p_admin_id::text || '|reject';

  select user_id
    into v_user_id
  from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_not_found';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_user_missing';
  end if;
  select *
    into v_withdrawal
  from public.nowpayments_usdt_withdrawals
  where id = p_withdrawal_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_withdrawal_not_found';
  end if;
  select is_admin and not is_frozen
    into v_admin_ok
  from public.profiles
  where id = p_admin_id
  for share;
  if not found or not v_admin_ok then
    raise exception 'nowpayments_usdt_admin_ineligible';
  end if;
  perform 1
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20'
  for share;
  if not found then
    raise exception 'nowpayments_usdt_configuration_missing';
  end if;

  select *
    into v_existing_event
  from public.nowpayments_usdt_withdrawal_events
  where action_id = v_action_id
  for update;
  if found then
    if v_existing_event.action_type <> 'reject'
      or v_existing_event.withdrawal_id <> p_withdrawal_id
      or v_existing_event.actor_id <> p_admin_id
      or v_existing_event.canonical_payload <> v_payload
    then
      raise exception 'nowpayments_usdt_action_id_conflict';
    end if;
    return v_existing_event.result_snapshot;
  end if;

  if v_withdrawal.status not in ('reserved', 'reviewing') then
    raise exception 'withdrawal_cannot_be_rejected_after_send_lock';
  end if;
  perform public.assert_safe_nowpayments_usdt_withdrawal_destination(
    v_withdrawal.destination_address
  );

  select *
    into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = v_user_id
  for update;
  if not found
    or v_wallet.reserved_balance_usdt < v_withdrawal.gross_amount_usdt
  then
    raise exception 'nowpayments_usdt_reserved_balance_mismatch';
  end if;
  v_from_status := v_withdrawal.status;

  update public.nowpayments_usdt_wallets
  set available_balance_usdt =
        v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt,
      reserved_balance_usdt =
        v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
      updated_at = now()
  where user_id = v_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id,
    entry_type,
    asset,
    available_delta_usdt,
    reserved_delta_usdt,
    available_before_usdt,
    available_after_usdt,
    reserved_before_usdt,
    reserved_after_usdt,
    withdrawal_id,
    description,
    metadata
  ) values (
    v_user_id,
    'withdrawal_release',
    'USDT',
    v_withdrawal.gross_amount_usdt,
    -v_withdrawal.gross_amount_usdt,
    v_wallet.available_balance_usdt,
    v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt,
    v_withdrawal.id,
    'Rejected manual USDT-BEP20 withdrawal fully released',
    jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'fee_retained_usdt', '0'
    )
  );

  update public.nowpayments_usdt_withdrawals
  set status = 'rejected',
      initial_admin_id = coalesce(initial_admin_id, p_admin_id),
      current_admin_id = p_admin_id,
      claimed_at = coalesce(claimed_at, v_created_at),
      rejected_at = v_created_at,
      rejection_reason = 'Rejected by administrator',
      updated_at = now()
  where id = v_withdrawal.id
  returning * into v_withdrawal;

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id,
    'status', 'rejected',
    'available_balance_usdt',
      (v_wallet.available_balance_usdt + v_withdrawal.gross_amount_usdt)::text,
    'reserved_balance_usdt',
      (v_wallet.reserved_balance_usdt - v_withdrawal.gross_amount_usdt)::text
  );
  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id,
    user_id,
    actor_id,
    action_id,
    action_type,
    from_status,
    to_status,
    canonical_payload,
    result_snapshot
  ) values (
    v_withdrawal.id,
    v_user_id,
    p_admin_id,
    v_action_id,
    'reject',
    v_from_status,
    'rejected',
    v_payload,
    v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)
  to service_role;
grant execute on function public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)
  to service_role;

-- Retire the runtime's former multi-step action surface. Definitions remain for
-- historical audit compatibility, but only the simplified functions are callable.
revoke execute on function public.claim_nowpayments_usdt_withdrawal_review(uuid,uuid,text)
  from service_role;
revoke execute on function public.lock_nowpayments_usdt_withdrawal_send(uuid,uuid,text,boolean,boolean)
  from service_role;
revoke execute on function public.record_nowpayments_usdt_withdrawal_broadcast(uuid,uuid,text,text,text)
  from service_role;
revoke execute on function public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)
  from service_role;
revoke execute on function public.reject_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  from service_role;
revoke execute on function public.take_over_nowpayments_usdt_withdrawal(uuid,uuid,text,text)
  from service_role;

comment on function public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text) is
  'Atomically settles one pending manual USDT-BEP20 withdrawal after an administrator confirms the exact net amount was sent; optional hash is private audit evidence.';
comment on function public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text) is
  'Atomically rejects one pending manual USDT-BEP20 withdrawal and releases its full reserved gross amount.';

do $postflight$
begin
  if not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'complete_nowpayments_usdt_withdrawal_manual',
          'reject_nowpayments_usdt_withdrawal_manual'
        )
        and p.prosecdef
        and p.proowner = 'postgres'::regrole
        and p.proconfig = array['search_path=pg_catalog, public']
      group by n.nspname
      having count(*) = 2
    )
    or not has_function_privilege(
      'service_role',
      'public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)',
      'EXECUTE'
    )
    or exists (
      select 1
      from pg_proc p
      cross join lateral aclexplode(p.proacl) acl
      where p.oid in (
        'public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)'::regprocedure,
        'public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)'::regprocedure
      )
        and acl.privilege_type = 'EXECUTE'
        and (
          acl.grantee = 0
          or acl.grantee not in (p.proowner, 'service_role'::regrole)
          or acl.is_grantable
        )
    )
    or (
      select count(*)
      from pg_proc p
      cross join lateral aclexplode(p.proacl) acl
      where p.oid in (
        'public.complete_nowpayments_usdt_withdrawal_manual(uuid,uuid,text,text)'::regprocedure,
        'public.reject_nowpayments_usdt_withdrawal_manual(uuid,uuid,text)'::regprocedure
      )
        and acl.grantee = 'service_role'::regrole
        and acl.grantor = p.proowner
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) <> 2
    or has_function_privilege(
      'service_role',
      'public.claim_nowpayments_usdt_withdrawal_review(uuid,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.lock_nowpayments_usdt_withdrawal_send(uuid,uuid,text,boolean,boolean)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.record_nowpayments_usdt_withdrawal_broadcast(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.complete_nowpayments_usdt_withdrawal(uuid,uuid,text,text,integer,text,boolean,boolean,text,text,bigint,integer,integer,timestamptz)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.reject_nowpayments_usdt_withdrawal(uuid,uuid,text,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role',
      'public.take_over_nowpayments_usdt_withdrawal(uuid,uuid,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'unexpected simplified NOWPayments USDT withdrawal security';
  end if;
end;
$postflight$;
