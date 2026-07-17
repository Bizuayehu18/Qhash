-- Preserve historical BSC deposit-address rows while allowing an administrator
-- to rotate one active public address atomically. No private-key handling,
-- signing, sweeping, confirmation, or wallet crediting is introduced here.

do $migration$
declare
  v_user_id_type text;
  v_constraint_definition text;
begin
  if to_regclass('public.crypto_deposit_addresses') is null
    or to_regclass('public.crypto_deposits') is null
    or to_regclass('public.crypto_watcher_state') is null
    or to_regclass('public.app_settings') is null
    or to_regclass('public.profiles') is null
  then
    raise exception 'Required BSC address-rotation tables are missing';
  end if;

  select format_type(attribute.atttypid, attribute.atttypmod)
    into v_user_id_type
  from pg_attribute as attribute
  where attribute.attrelid = 'public.crypto_deposit_addresses'::regclass
    and attribute.attname = 'user_id'
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_user_id_type is distinct from 'uuid' then
    raise exception 'Unexpected crypto_deposit_addresses.user_id type: %', coalesce(v_user_id_type, 'missing');
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
    into v_constraint_definition
  from pg_constraint as constraint_info
  where constraint_info.conrelid = 'public.crypto_deposit_addresses'::regclass
    and constraint_info.conname = 'crypto_deposit_addresses_user_network_asset_key';

  if v_constraint_definition is not null
    and v_constraint_definition <> 'UNIQUE (user_id, network, asset)'
  then
    raise exception 'crypto_deposit_addresses_user_network_asset_key has an unexpected definition';
  end if;

  if exists (
    select 1
    from public.crypto_deposit_addresses
    where status = 'active'
    group by user_id, network, asset
    having count(*) > 1
  ) then
    raise exception 'Multiple active crypto addresses already exist for one user and network';
  end if;
end;
$migration$;

alter table public.crypto_deposit_addresses
  drop constraint if exists crypto_deposit_addresses_user_network_asset_key;

create unique index if not exists crypto_deposit_addresses_active_user_network_asset_key
  on public.crypto_deposit_addresses (user_id, network, asset)
  where status = 'active';

create or replace function public.rotate_bsc_crypto_deposit_address(
  p_user_id uuid,
  p_admin_id uuid,
  p_expected_current_address_id uuid,
  p_expected_current_address text,
  p_new_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_admin record;
  v_user_exists boolean;
  v_current_address record;
  v_new_address record;
  v_exposure_setting text;
  v_watcher_updated_at timestamptz;
  v_normalized_expected_address text;
  v_normalized_new_address text;
begin
  if p_user_id is null
    or p_admin_id is null
    or p_expected_current_address_id is null
    or p_expected_current_address is null
    or p_new_address is null
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  v_normalized_expected_address := lower(btrim(p_expected_current_address));
  v_normalized_new_address := lower(btrim(p_new_address));

  if v_normalized_expected_address !~ '^0x[0-9a-f]{40}$'
    or v_normalized_new_address !~ '^0x[0-9a-f]{40}$'
    or v_normalized_expected_address = v_normalized_new_address
  then
    return jsonb_build_object('success', false, 'code', 'invalid_input');
  end if;

  select profile.id, profile.is_admin, profile.is_frozen
    into v_admin
  from public.profiles as profile
  where profile.id = p_admin_id
  for share;

  if not found then
    return jsonb_build_object('success', false, 'code', 'admin_not_found');
  end if;

  if v_admin.is_admin is not true then
    return jsonb_build_object('success', false, 'code', 'not_admin');
  end if;

  if v_admin.is_frozen is true then
    return jsonb_build_object('success', false, 'code', 'admin_frozen');
  end if;

  select true
    into v_user_exists
  from public.profiles as profile
  where profile.id = p_user_id
  for key share;

  if v_user_exists is not true then
    return jsonb_build_object('success', false, 'code', 'user_not_found');
  end if;

  select setting.value
    into v_exposure_setting
  from public.app_settings as setting
  where setting.key = 'crypto_bsc_user_deposits_enabled'
  limit 1
  for share;

  if v_exposure_setting is distinct from 'false' then
    return jsonb_build_object('success', false, 'code', 'exposure_must_be_disabled');
  end if;

  select watcher.updated_at
    into v_watcher_updated_at
  from public.crypto_watcher_state as watcher
  where watcher.network = 'BSC'
  for share;

  if v_watcher_updated_at is null
    or v_watcher_updated_at < now() - interval '10 minutes'
  then
    return jsonb_build_object('success', false, 'code', 'watcher_stale');
  end if;

  select address_row.*
    into v_current_address
  from public.crypto_deposit_addresses as address_row
  where address_row.id = p_expected_current_address_id
    and address_row.user_id = p_user_id
    and address_row.network = 'BSC'
    and address_row.asset = 'USDT'
  for update;

  if not found
    or v_current_address.status <> 'active'
    or v_current_address.activation_status <> 'not_required'
    or lower(v_current_address.address) <> v_normalized_expected_address
  then
    return jsonb_build_object('success', false, 'code', 'stale_current_address');
  end if;

  if exists (
    select 1
    from public.crypto_deposits as deposit
    where deposit.address_id = v_current_address.id
      and deposit.status in ('detected', 'confirmed')
  ) then
    return jsonb_build_object('success', false, 'code', 'unsettled_deposits');
  end if;

  begin
    update public.crypto_deposit_addresses
    set status = 'disabled',
        updated_at = now()
    where id = v_current_address.id
      and status = 'active';

    if not found then
      return jsonb_build_object('success', false, 'code', 'stale_current_address');
    end if;

    insert into public.crypto_deposit_addresses (
      user_id,
      network,
      asset,
      address,
      activation_status,
      status
    ) values (
      p_user_id,
      'BSC',
      'USDT',
      v_normalized_new_address,
      'not_required',
      'active'
    )
    returning * into v_new_address;
  exception
    when unique_violation then
      return jsonb_build_object('success', false, 'code', 'address_conflict');
  end;

  return jsonb_build_object(
    'success', true,
    'code', 'rotated',
    'user_id', p_user_id,
    'previous_address_id', v_current_address.id,
    'previous_address', v_current_address.address,
    'new_address_id', v_new_address.id,
    'new_address', v_new_address.address
  );
end;
$function$;

revoke all on function public.rotate_bsc_crypto_deposit_address(uuid, uuid, uuid, text, text) from public;

do $migration$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.rotate_bsc_crypto_deposit_address(uuid, uuid, uuid, text, text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.rotate_bsc_crypto_deposit_address(uuid, uuid, uuid, text, text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rotate_bsc_crypto_deposit_address(uuid, uuid, uuid, text, text) to service_role;
  end if;
end;
$migration$;

comment on function public.rotate_bsc_crypto_deposit_address(uuid, uuid, uuid, text, text) is
  'Atomically disables one active historical BSC USDT address and inserts its replacement. Public addresses only; no fund movement.';

comment on table public.crypto_deposit_addresses is
  'Current and historical per-user public USDT deposit addresses for TRON and BSC. Stores no private keys.';

do $migration$
declare
  v_index record;
begin
  select
    index_info.indisunique,
    index_info.indisvalid,
    index_info.indisready,
    pg_get_expr(index_info.indpred, index_info.indrelid) as predicate,
    array(
      select attribute_info.attname
      from unnest(index_info.indkey) with ordinality as index_key(attnum, position)
      join pg_attribute as attribute_info
        on attribute_info.attrelid = index_info.indrelid
       and attribute_info.attnum = index_key.attnum
      order by index_key.position
    ) as columns
  into v_index
  from pg_class as index_class
  join pg_namespace as index_namespace
    on index_namespace.oid = index_class.relnamespace
  join pg_index as index_info
    on index_info.indexrelid = index_class.oid
  where index_namespace.nspname = 'public'
    and index_class.relname = 'crypto_deposit_addresses_active_user_network_asset_key';

  if not found
    or v_index.indisunique is not true
    or v_index.indisvalid is not true
    or v_index.indisready is not true
    or v_index.columns is distinct from array['user_id', 'network', 'asset']::name[]
    or v_index.predicate is distinct from '(status = ''active''::text)'
  then
    raise exception 'crypto_deposit_addresses_active_user_network_asset_key has an unexpected definition';
  end if;

  if to_regprocedure('public.rotate_bsc_crypto_deposit_address(uuid,uuid,uuid,text,text)') is null then
    raise exception 'rotate_bsc_crypto_deposit_address was not created';
  end if;
end;
$migration$;
