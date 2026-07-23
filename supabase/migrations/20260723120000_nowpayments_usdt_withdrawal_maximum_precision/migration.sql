do $preflight$
declare
  v_function regprocedure :=
    to_regprocedure('public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)');
  v_expected_owner oid := to_regrole('postgres');
  v_service_role oid := to_regrole('service_role');
  v_anon_role oid := to_regrole('anon');
  v_authenticated_role oid := to_regrole('authenticated');
begin
  if v_function is null
    or v_expected_owner is null
    or v_service_role is null
    or v_anon_role is null
    or v_authenticated_role is null
  then
    raise exception 'Unexpected withdrawal-request function fingerprint';
  end if;

  perform 1
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_function
    and n.nspname = 'public'
    and p.proname = 'request_nowpayments_usdt_withdrawal'
    and p.prokind = 'f'
    and p.prorettype = 'jsonb'::regtype
    and l.lanname = 'plpgsql'
    and p.prosecdef
    and not p.proisstrict
    and not p.proleakproof
    and p.provolatile = 'v'
    and p.proparallel = 'u'
    and p.proargtypes = '2950 25 25 25'::oidvector
    and p.proargnames = array[
      'p_user_id',
      'p_request_id',
      'p_gross_amount_usdt',
      'p_destination_address'
    ]::text[]
    and p.proconfig = array['search_path=pg_catalog, public']::text[]
    and pg_catalog.length(p.prosrc) = 5738
    and pg_catalog.md5(p.prosrc) = 'db604f242d56375f6d3cb96236d863d8'
    and pg_catalog.strpos(
      p.prosrc,
      'trunc(v_wallet.available_balance_usdt * 1000000) / 1000000'
    ) > 0
    and pg_catalog.strpos(
      p.prosrc,
      'trunc(v_wallet.available_balance_usdt, 6)'
    ) = 0;

  if not found then
    raise exception 'Unexpected withdrawal-request function fingerprint';
  end if;

  perform 1
  from pg_catalog.pg_proc p
  where p.oid = v_function
    and p.proowner = v_expected_owner
    and p.proacl is not null
    and pg_catalog.has_function_privilege(
      'service_role',
      v_function::oid,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      v_function::oid,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      v_function::oid,
      'EXECUTE'
    )
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee = v_expected_owner
        and acl.grantor = v_expected_owner
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_expected_owner
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and not exists (
      select 1
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee in (0::oid, v_anon_role, v_authenticated_role)
        and acl.privilege_type = 'EXECUTE'
    );

  if not found then
    raise exception 'Unexpected withdrawal-request function privileges';
  end if;
end
$preflight$;

create or replace function public.request_nowpayments_usdt_withdrawal(
  p_user_id uuid,
  p_request_id text,
  p_gross_amount_usdt text,
  p_destination_address text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_request_id uuid;
  v_gross numeric(36, 6);
  v_destination text;
  v_payload text;
  v_enabled boolean;
  v_is_frozen boolean;
  v_is_admin boolean;
  v_wallet public.nowpayments_usdt_wallets%rowtype;
  v_withdrawal public.nowpayments_usdt_withdrawals%rowtype;
  v_existing_event public.nowpayments_usdt_withdrawal_events%rowtype;
  v_result jsonb;
  v_max numeric(36, 6);
begin
  if p_user_id is null
    or not public.is_canonical_uuid_v4(p_request_id)
    or p_gross_amount_usdt is null
    or p_gross_amount_usdt !~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,6})?$'
    or p_destination_address is null
  then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end if;

  begin
    v_request_id := p_request_id::uuid;
    v_gross := p_gross_amount_usdt::numeric(36, 6);
  exception when numeric_value_out_of_range then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end;

  v_destination := lower(btrim(p_destination_address));
  if v_destination !~ '^0x[0-9a-f]{40}$' or v_gross < 2 then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end if;
  v_payload := p_user_id::text || '|' || v_gross::text || '|' || v_destination;

  select is_frozen, is_admin into v_is_frozen, v_is_admin
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen or v_is_admin then
    raise exception 'nowpayments_usdt_withdrawal_user_ineligible';
  end if;

  select * into v_withdrawal
  from public.nowpayments_usdt_withdrawals
  where id = v_request_id
  for update;
  if found then
    select * into v_existing_event
    from public.nowpayments_usdt_withdrawal_events
    where action_id = v_request_id
    for update;
    if not found
      or v_withdrawal.user_id <> p_user_id
      or v_existing_event.action_type <> 'request'
      or v_existing_event.user_id <> p_user_id
      or v_existing_event.actor_id <> p_user_id
      or v_existing_event.withdrawal_id <> v_request_id
      or v_existing_event.canonical_payload <> v_payload
    then
      raise exception 'nowpayments_usdt_action_id_conflict';
    end if;
    return v_existing_event.result_snapshot;
  end if;

  select * into v_withdrawal
  from public.nowpayments_usdt_withdrawals
  where user_id = p_user_id
    and status in ('reserved', 'reviewing', 'send_locked', 'broadcasted')
  order by created_at, id
  limit 1
  for update;
  if found then
    raise exception 'open_nowpayments_usdt_withdrawal_exists';
  end if;

  select * into v_existing_event
  from public.nowpayments_usdt_withdrawal_events
  where action_id = v_request_id
  for update;
  if found then
    raise exception 'nowpayments_usdt_action_id_conflict';
  end if;

  select withdrawals_enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20'
  for share;
  if not found then
    raise exception 'nowpayments_usdt_configuration_missing';
  end if;

  if not v_enabled then
    raise exception 'nowpayments_usdt_withdrawals_disabled';
  end if;

  v_destination := public.assert_safe_nowpayments_usdt_withdrawal_destination(v_destination);

  select * into v_wallet
  from public.nowpayments_usdt_wallets
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_max := trunc(v_wallet.available_balance_usdt, 6);
  if v_gross > v_max then
    raise exception 'insufficient_nowpayments_usdt_available_balance';
  end if;

  insert into public.nowpayments_usdt_withdrawals (
    id, user_id, destination_address, asset, network, provider_currency,
    gross_amount_usdt, fee_percent, status, requested_at
  ) values (
    v_request_id, p_user_id, v_destination, 'USDT', 'BEP20', 'usdtbsc',
    v_gross, 5, 'reserved', now()
  ) returning * into v_withdrawal;

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_wallet.available_balance_usdt - v_gross,
      reserved_balance_usdt = v_wallet.reserved_balance_usdt + v_gross,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.nowpayments_usdt_ledger_entries (
    user_id, entry_type, asset,
    available_delta_usdt, reserved_delta_usdt,
    available_before_usdt, available_after_usdt,
    reserved_before_usdt, reserved_after_usdt,
    withdrawal_id, description, metadata
  ) values (
    p_user_id, 'withdrawal_reserve', 'USDT',
    -v_gross, v_gross,
    v_wallet.available_balance_usdt, v_wallet.available_balance_usdt - v_gross,
    v_wallet.reserved_balance_usdt, v_wallet.reserved_balance_usdt + v_gross,
    v_withdrawal.id, 'Manual USDT-BEP20 withdrawal gross amount reserved',
    jsonb_build_object(
      'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
      'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
      'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
      'asset', 'USDT', 'network', 'BEP20'
    )
  );

  v_result := jsonb_build_object(
    'withdrawal_id', v_withdrawal.id,
    'status', 'reserved',
    'destination_address', v_withdrawal.destination_address,
    'gross_amount_usdt', v_withdrawal.gross_amount_usdt::text,
    'fee_amount_usdt', v_withdrawal.fee_amount_usdt::text,
    'net_amount_usdt', v_withdrawal.net_amount_usdt::text,
    'available_balance_usdt', (v_wallet.available_balance_usdt - v_gross)::text,
    'reserved_balance_usdt', (v_wallet.reserved_balance_usdt + v_gross)::text
  );

  insert into public.nowpayments_usdt_withdrawal_events (
    withdrawal_id, user_id, actor_id, action_id, action_type,
    from_status, to_status, canonical_payload, result_snapshot
  ) values (
    v_withdrawal.id, p_user_id, p_user_id, v_request_id, 'request',
    null, 'reserved', v_payload, v_result
  );

  return v_result;
end;
$function$;

do $postflight$
declare
  v_function regprocedure :=
    to_regprocedure('public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)');
  v_expected_owner oid := to_regrole('postgres');
  v_service_role oid := to_regrole('service_role');
  v_anon_role oid := to_regrole('anon');
  v_authenticated_role oid := to_regrole('authenticated');
begin
  perform 1
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = v_function
    and n.nspname = 'public'
    and p.proname = 'request_nowpayments_usdt_withdrawal'
    and p.prokind = 'f'
    and p.prorettype = 'jsonb'::regtype
    and l.lanname = 'plpgsql'
    and p.prosecdef
    and not p.proisstrict
    and not p.proleakproof
    and p.provolatile = 'v'
    and p.proparallel = 'u'
    and p.proargtypes = '2950 25 25 25'::oidvector
    and p.proargnames = array[
      'p_user_id',
      'p_request_id',
      'p_gross_amount_usdt',
      'p_destination_address'
    ]::text[]
    and p.proconfig = array['search_path=pg_catalog, public']::text[]
    and pg_catalog.length(p.prosrc) = 5721
    and pg_catalog.md5(p.prosrc) = '98e013f184aedfdabb061e31b43a9d65'
    and pg_catalog.strpos(
      p.prosrc,
      'trunc(v_wallet.available_balance_usdt, 6)'
    ) > 0
    and pg_catalog.strpos(
      p.prosrc,
      'trunc(v_wallet.available_balance_usdt * 1000000) / 1000000'
    ) = 0;

  if not found then
    raise exception 'Withdrawal-request function replacement failed';
  end if;

  perform 1
  from pg_catalog.pg_proc p
  where p.oid = v_function
    and p.proowner = v_expected_owner
    and p.proacl is not null
    and pg_catalog.has_function_privilege(
      'service_role',
      v_function::oid,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'anon',
      v_function::oid,
      'EXECUTE'
    )
    and not pg_catalog.has_function_privilege(
      'authenticated',
      v_function::oid,
      'EXECUTE'
    )
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee = v_expected_owner
        and acl.grantor = v_expected_owner
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_expected_owner
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and not exists (
      select 1
      from pg_catalog.aclexplode(p.proacl) acl
      where acl.grantee in (0::oid, v_anon_role, v_authenticated_role)
        and acl.privilege_type = 'EXECUTE'
    );

  if not found then
    raise exception 'Withdrawal-request function privilege preservation failed';
  end if;
end
$postflight$;
