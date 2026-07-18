-- Retire QHash's native crypto-deposit database capabilities after the
-- application watcher and user/admin runtime were removed. The single live
-- credited deposit is retained as immutable audit evidence because its 9.99
-- USDT remains unswept at the historical BSC address.

set local lock_timeout = '5s';

lock table public.crypto_deposit_addresses in access exclusive mode;
lock table public.crypto_deposits in access exclusive mode;
lock table public.crypto_sweep_jobs in access exclusive mode;
lock table public.crypto_watcher_state in access exclusive mode;
lock table public.app_settings in share row exclusive mode;

do $migration$
declare
  v_address_count bigint;
  v_deposit_count bigint;
  v_is_fresh_replay boolean := false;
  v_expected_rate text;
begin
  if to_regclass('public._qhash_migrations') is null then
    raise exception 'public._qhash_migrations is missing';
  end if;

  if to_regclass('public.crypto_deposit_addresses') is null
    or to_regclass('public.crypto_deposits') is null
    or to_regclass('public.crypto_sweep_jobs') is null
    or to_regclass('public.crypto_watcher_state') is null
  then
    raise exception 'Native crypto database foundation is incomplete';
  end if;

  if (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p', 'v', 'm')
      and relation.relname like 'crypto\_%' escape '\'
  ) <> 4 then
    raise exception 'Unexpected public crypto relation drift';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and pg_get_userbyid(relation.relowner) <> 'postgres'
  ) then
    raise exception 'Unexpected native crypto table owner';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'service_role is missing';
  end if;

  if to_regprocedure(
    'public.apply_bsc_crypto_deposit_confirmation(uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,integer)'
  ) is null
    or to_regprocedure(
      'public.credit_confirmed_bsc_crypto_deposit(uuid,uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,text,text)'
    ) is null
    or to_regprocedure(
      'public.rotate_bsc_crypto_deposit_address(uuid,uuid,uuid,text,text)'
    ) is null
    or to_regprocedure('public.normalize_crypto_deposit_address_activation_status()') is null
    or to_regprocedure('public.set_crypto_updated_at()') is null
  then
    raise exception 'Native crypto function inventory is incomplete';
  end if;

  if (
    select count(*)
    from pg_proc as function_info
    join pg_namespace as namespace
      on namespace.oid = function_info.pronamespace
    where namespace.nspname = 'public'
      and (
        function_info.proname ilike '%crypto%'
        or function_info.proname ilike '%bsc%'
        or function_info.proname ilike '%tron%'
      )
  ) <> 5 then
    raise exception 'Unexpected public crypto function drift';
  end if;

  if (
    select count(*)
    from pg_trigger as trigger_info
    join pg_class as relation
      on relation.oid = trigger_info.tgrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and not trigger_info.tgisinternal
  ) <> 5 or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.crypto_deposit_addresses'::regclass
      and tgname = 'normalize_crypto_deposit_address_activation_status'
      and tgfoid = 'public.normalize_crypto_deposit_address_activation_status()'::regprocedure
      and not tgisinternal
      and tgenabled = 'O'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.crypto_deposit_addresses'::regclass
      and tgname = 'set_crypto_deposit_addresses_updated_at'
      and tgfoid = 'public.set_crypto_updated_at()'::regprocedure
      and not tgisinternal
      and tgenabled = 'O'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.crypto_deposits'::regclass
      and tgname = 'set_crypto_deposits_updated_at'
      and tgfoid = 'public.set_crypto_updated_at()'::regprocedure
      and not tgisinternal
      and tgenabled = 'O'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.crypto_sweep_jobs'::regclass
      and tgname = 'set_crypto_sweep_jobs_updated_at'
      and tgfoid = 'public.set_crypto_updated_at()'::regprocedure
      and not tgisinternal
      and tgenabled = 'O'
  ) or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.crypto_watcher_state'::regclass
      and tgname = 'set_crypto_watcher_state_updated_at'
      and tgfoid = 'public.set_crypto_updated_at()'::regprocedure
      and not tgisinternal
      and tgenabled = 'O'
  ) then
    raise exception 'Unexpected native crypto trigger inventory';
  end if;

  if exists (
    select 1
    from pg_constraint as constraint_info
    join pg_class as relation
      on relation.oid = constraint_info.conrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and not constraint_info.convalidated
  ) then
    raise exception 'An unvalidated native crypto constraint exists';
  end if;

  if exists (
    select 1
    from pg_index as index_info
    join pg_class as relation
      on relation.oid = index_info.indrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and (not index_info.indisvalid or not index_info.indisready)
  ) then
    raise exception 'An invalid native crypto index exists';
  end if;

  if not exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conname = 'crypto_deposits_credit_audit_fields_check'
      and constraint_info.conrelid = 'public.crypto_deposits'::regclass
      and constraint_info.contype = 'c'
      and constraint_info.convalidated
  ) then
    raise exception 'Validated crypto credit audit constraint is missing';
  end if;

  if exists (
    select 1
    from pg_policies as policy_info
    where policy_info.schemaname = 'public'
      and policy_info.tablename in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
  ) then
    raise exception 'Unexpected native crypto RLS policy exists';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and not relation.relrowsecurity
  ) then
    raise exception 'Native crypto RLS is not enabled';
  end if;

  if exists (
    select 1
    from pg_attribute as column_info
    join pg_class as relation
      on relation.oid = column_info.attrelid
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and column_info.attnum > 0
      and not column_info.attisdropped
      and column_info.attacl is not null
  ) then
    raise exception 'Unexpected native crypto column grant exists';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as table_acl
    left join pg_roles as grantee
      on grantee.oid = table_acl.grantee
    where namespace.nspname = 'public'
      and relation.relname in (
        'crypto_deposit_addresses',
        'crypto_deposits',
        'crypto_sweep_jobs',
        'crypto_watcher_state'
      )
      and table_acl.grantee <> relation.relowner
      and grantee.rolname is distinct from 'service_role'
  ) then
    raise exception 'Unexpected native crypto table grantee exists';
  end if;

  if (select count(*) from public.crypto_sweep_jobs) <> 0 then
    raise exception 'Native crypto sweep queue is not empty';
  end if;

  if (
    select count(*)
    from public.app_settings as setting
    where setting.key like 'crypto\_%' escape '\'
       or setting.key = 'usdt_etb_rate'
  ) <> 5 then
    raise exception 'Unexpected native crypto setting inventory';
  end if;

  if not exists (
    select 1
    from public.app_settings as setting
    where setting.key = 'crypto_auto_credit_enabled'
      and lower(btrim(setting.value)) = 'false'
  ) or not exists (
    select 1
    from public.app_settings as setting
    where setting.key = 'crypto_bsc_user_deposits_enabled'
      and lower(btrim(setting.value)) = 'false'
  ) then
    raise exception 'Native crypto exposure or auto-credit is enabled';
  end if;

  select count(*) into v_address_count
  from public.crypto_deposit_addresses;

  select count(*) into v_deposit_count
  from public.crypto_deposits;

  if v_address_count = 0 and v_deposit_count = 0 then
    with expected_migration(id, checksum) as (
      values
        (
          '20260710120000_crypto_deposit_foundation/migration.sql',
          'a2070ab0933d06417ae23d7a33620957af58c3e895e50978b1de7d0415ceee83'
        ),
        (
          '20260716160000_bsc_confirmation_writer/migration.sql',
          '9b34e077d4f3809374b73f1c652fb3560c47aff712f8a32fc609d2fa2d0dd12c'
        ),
        (
          '20260716185000_crypto_manual_crediting_uuid_preflight/migration.sql',
          'e12bcba1ccbe01a14363ac8cb70ab14effd94dfd273ab99d438ab722e8f5cc03'
        ),
        (
          '20260716190000_crypto_manual_crediting/migration.sql',
          '365ebc810be3b02a0d255e8199b2c4ac02566c0521077bd87ebfebb768e60c60'
        ),
        (
          '20260717030000_crypto_user_id_uuid_repair/migration.sql',
          '00f542b707ddaa0f2d39d4afd986daa768712106b3a65c42bae4e2a012ad0173'
        ),
        (
          '20260717130000_crypto_reference_id_uuid_repair/migration.sql',
          'b52ab0141b5fd923c9534f02158b07c7097a340b98f85b0bde412c5430e79ab5'
        ),
        (
          '20260717150000_crypto_schema_reconciliation/migration.sql',
          '335151426330fdc89ab466237a2847c45c4debbc17383a7af2735ed521bfdfdc'
        ),
        (
          '20260717170000_bsc_user_deposit_exposure/migration.sql',
          '246775eb505713eb8389d3c0ec7a13063e4bc8e1805e31916f3516af96c633f4'
        ),
        (
          '20260717221500_bsc_address_rotation/migration.sql',
          '11bb859d467f19171f39033eac55cfe5786d65fe462ccc48f7bc9be993d68a21'
        )
    )
    select
      count(*) = 9
      and bool_and(migration.checksum = expected_migration.checksum)
      and (
        (
          count(migration.commit_ref) = 9
          and count(distinct migration.commit_ref) = 1
        ) or (
          count(migration.commit_ref) = 0
          and bool_and(coalesce(migration.deploy_context, '') <> 'production')
        )
      )
    into v_is_fresh_replay
    from expected_migration
    join public._qhash_migrations as migration
      on migration.id = expected_migration.id;

    if not v_is_fresh_replay then
      raise exception 'Empty crypto evidence is not a verified fresh migration replay';
    end if;

    if (select count(*) from public.crypto_watcher_state) <> 2
      or not exists (
        select 1 from public.crypto_watcher_state
        where network = 'BSC' and last_scanned_block = 0
      )
      or not exists (
        select 1 from public.crypto_watcher_state
        where network = 'TRON' and last_scanned_block = 0
      )
    then
      raise exception 'Fresh replay watcher state is unexpected';
    end if;

    v_expected_rate := '160';
  elsif v_address_count = 2 and v_deposit_count = 1 then
    if not exists (
      select 1
      from public.crypto_deposit_addresses as address
      where address.id = '9cf3da8f-e857-44e7-8f2e-22974bbb1785'::uuid
        and address.user_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
        and address.network = 'BSC'
        and address.asset = 'USDT'
        and lower(address.address) = '0x1fe20b3b2fa149d667610031df6ddbf8105b7616'
        and address.derivation_index is null
        and address.activation_status = 'not_required'
        and address.status = 'disabled'
        and address.created_at = '2026-07-16 22:41:12.604919+00'::timestamptz
        and address.updated_at = '2026-07-17 23:34:35.503055+00'::timestamptz
    ) or not exists (
      select 1
      from public.crypto_deposit_addresses as address
      where address.id = 'f7956929-852e-45e2-9a5c-830ae2b71b15'::uuid
        and address.user_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
        and address.network = 'BSC'
        and address.asset = 'USDT'
        and lower(address.address) = '0xbe19677ee642cfe21fff5899b258f5010651c33e'
        and address.derivation_index is null
        and address.activation_status = 'not_required'
        and address.status = 'active'
        and address.created_at = '2026-07-17 23:34:35.503055+00'::timestamptz
        and address.updated_at = '2026-07-17 23:34:35.503055+00'::timestamptz
    ) then
      raise exception 'Production crypto address evidence differs from the verified state';
    end if;

    if not exists (
      select 1
      from public.crypto_deposits as deposit
      where deposit.id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
        and deposit.user_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
        and deposit.address_id = '9cf3da8f-e857-44e7-8f2e-22974bbb1785'::uuid
        and deposit.network = 'BSC'
        and deposit.asset = 'USDT'
        and lower(deposit.tx_hash) = '0x766ec571a07beddc9b57f8436b05d1cbee7d1cfcac54c8c1003e9b53ddc9320b'
        and deposit.event_index = 115
        and lower(deposit.from_address) = '0x8894e0a0c962cb723c1976a4421c95949be2d4e3'
        and lower(deposit.to_address) = '0x1fe20b3b2fa149d667610031df6ddbf8105b7616'
        and deposit.amount_raw = 9990000000000000000::numeric
        and deposit.amount_usdt = 9.99::numeric
        and deposit.block_number = 110407808
        and deposit.confirmations = 121052
        and deposit.status = 'credited'
        and deposit.confirmed_at = '2026-07-16 23:19:26.712314+00'::timestamptz
        and deposit.exchange_rate_etb = 190::numeric
        and deposit.credited_amount_etb = 1898.10::numeric
        and deposit.credited_at = '2026-07-17 14:09:57.701646+00'::timestamptz
        and deposit.detected_at = '2026-07-16 23:02:14.552539+00'::timestamptz
        and deposit.created_at = '2026-07-16 23:02:14.552539+00'::timestamptz
        and deposit.updated_at = '2026-07-17 14:09:57.701646+00'::timestamptz
        and deposit.credited_transaction_id = '536fe882-dcbc-4b14-9a6d-89ce691425be'::uuid
        and deposit.credited_by_admin_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
        and deposit.swept_at is null
    ) then
      raise exception 'Production crypto deposit evidence differs from the verified state';
    end if;

    if (
      select count(*)
      from public.transactions as ledger
      where ledger.reference_id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
    ) <> 1 or not exists (
      select 1
      from public.transactions as ledger
      where ledger.id = '536fe882-dcbc-4b14-9a6d-89ce691425be'::uuid
        and ledger.user_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
        and ledger.type::text = 'deposit'
        and ledger.status::text = 'completed'
        and ledger.amount = 1898.10::numeric
        and ledger.balance_before = 14703.80::numeric
        and ledger.balance_after = 16601.90::numeric
        and ledger.balance_after - ledger.balance_before = 1898.10::numeric
        and ledger.description = 'Deposit credited'
        and ledger.reference_id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
        and coalesce(ledger.metadata, '{}'::jsonb) = '{}'::jsonb
        and ledger.created_at = '2026-07-17 14:09:57.701646+00'::timestamptz
    ) then
      raise exception 'Production crypto ledger evidence differs from the verified state';
    end if;

    if (select count(*) from public.crypto_watcher_state) <> 2
      or not exists (
        select 1
        from public.crypto_watcher_state
        where network = 'BSC'
          and last_scanned_block = 110698538
          and updated_at = '2026-07-18 11:23:06.179878+00'::timestamptz
      )
      or not exists (
        select 1
        from public.crypto_watcher_state
        where network = 'TRON'
          and last_scanned_block = 0
          and updated_at = '2026-07-10 10:52:56.951011+00'::timestamptz
      )
    then
      raise exception 'Production watcher cutoff differs from the verified stopped state';
    end if;

    v_expected_rate := '190';
  else
    raise exception 'Unexpected native crypto evidence row counts';
  end if;

  if not exists (
    select 1 from public.app_settings
    where key = 'crypto_bsc_min_usdt' and btrim(value) = '5'
  ) or not exists (
    select 1 from public.app_settings
    where key = 'crypto_tron_min_usdt' and btrim(value) = '10'
  ) or not exists (
    select 1 from public.app_settings
    where key = 'usdt_etb_rate' and btrim(value) = v_expected_rate
  ) then
    raise exception 'Native crypto numeric settings differ from the verified state';
  end if;
end;
$migration$;

update public.crypto_deposit_addresses
set status = 'disabled'
where status <> 'disabled';

update public.transactions
set metadata = jsonb_build_object(
  'native_crypto_decommission',
  jsonb_build_object(
    'version', 1,
    'custody_status', 'unswept_external_asset_pending',
    'network', 'BSC',
    'asset', 'USDT',
    'deposit_id', 'fcd260e7-970b-44a1-9089-d5a37a88d93d',
    'ledger_transaction_id', '536fe882-dcbc-4b14-9a6d-89ce691425be',
    'deposit_address_id', '9cf3da8f-e857-44e7-8f2e-22974bbb1785',
    'deposit_address', '0x1fe20b3b2fa149d667610031df6ddbf8105b7616',
    'deposit_address_created_at', '2026-07-16T22:41:12.604919Z',
    'deposit_address_disabled_at', '2026-07-17T23:34:35.503055Z',
    'disabled_treasury_address_id', 'f7956929-852e-45e2-9a5c-830ae2b71b15',
    'disabled_treasury_address', '0xbe19677ee642cfe21fff5899b258f5010651c33e',
    'treasury_address_assigned_at', '2026-07-17T23:34:35.503055Z',
    'chain_tx_hash', '0x766ec571a07beddc9b57f8436b05d1cbee7d1cfcac54c8c1003e9b53ddc9320b',
    'event_index', 115,
    'deposit_block_number', 110407808,
    'amount_usdt', '9.99',
    'exchange_rate_etb', '190',
    'credited_amount_etb', '1898.10',
    'deposit_detected_at', '2026-07-16T23:02:14.552539Z',
    'deposit_confirmed_at', '2026-07-16T23:19:26.712314Z',
    'deposit_credited_at', '2026-07-17T14:09:57.701646Z',
    'bsc_watcher_last_scanned_block', 110698538,
    'bsc_watcher_last_updated_at', '2026-07-18T11:23:06.179878Z',
    'tron_watcher_last_scanned_block', 0,
    'tron_watcher_last_updated_at', '2026-07-10T10:52:56.951011Z',
    'archived_at', statement_timestamp()
  )
)
where id = '536fe882-dcbc-4b14-9a6d-89ce691425be'::uuid
  and user_id = 'bd44f308-7d49-4878-bee5-d5ea78969a9c'::uuid
  and type::text = 'deposit'
  and status::text = 'completed'
  and amount = 1898.10::numeric
  and balance_before = 14703.80::numeric
  and balance_after = 16601.90::numeric
  and description = 'Deposit credited'
  and reference_id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
  and created_at = '2026-07-17 14:09:57.701646+00'::timestamptz
  and coalesce(metadata, '{}'::jsonb) = '{}'::jsonb
  and exists (
    select 1
    from public.crypto_deposits as deposit
    where deposit.id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
  );

delete from public.app_settings
where key in (
  'crypto_auto_credit_enabled',
  'crypto_bsc_min_usdt',
  'crypto_bsc_user_deposits_enabled',
  'crypto_tron_min_usdt',
  'usdt_etb_rate'
);

drop function public.apply_bsc_crypto_deposit_confirmation(
  uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, integer
) restrict;

drop function public.credit_confirmed_bsc_crypto_deposit(
  uuid, uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, text, text
) restrict;

drop function public.rotate_bsc_crypto_deposit_address(
  uuid, uuid, uuid, text, text
) restrict;

drop table public.crypto_sweep_jobs restrict;
drop table public.crypto_watcher_state restrict;

drop trigger normalize_crypto_deposit_address_activation_status
  on public.crypto_deposit_addresses;
drop trigger set_crypto_deposit_addresses_updated_at
  on public.crypto_deposit_addresses;
drop trigger set_crypto_deposits_updated_at
  on public.crypto_deposits;

drop function public.normalize_crypto_deposit_address_activation_status() restrict;
drop function public.set_crypto_updated_at() restrict;

revoke all on table public.crypto_deposit_addresses from public;
revoke all on table public.crypto_deposits from public;

do $permissions$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.crypto_deposit_addresses from anon;
    revoke all on table public.crypto_deposits from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.crypto_deposit_addresses from authenticated;
    revoke all on table public.crypto_deposits from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.crypto_deposit_addresses from service_role;
    revoke all on table public.crypto_deposits from service_role;
    grant select on table public.crypto_deposit_addresses to service_role;
    grant select on table public.crypto_deposits to service_role;
  end if;
end;
$permissions$;

create function public.reject_retired_native_crypto_evidence_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'Retired native crypto evidence is immutable';
  return null;
end;
$function$;

revoke all on function public.reject_retired_native_crypto_evidence_mutation()
  from public;

do $permissions$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.reject_retired_native_crypto_evidence_mutation()
      from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.reject_retired_native_crypto_evidence_mutation()
      from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.reject_retired_native_crypto_evidence_mutation()
      from service_role;
  end if;
end;
$permissions$;

create trigger reject_retired_crypto_deposit_addresses_mutation
before insert or update or delete or truncate
on public.crypto_deposit_addresses
for each statement
execute function public.reject_retired_native_crypto_evidence_mutation();

create trigger reject_retired_crypto_deposits_mutation
before insert or update or delete or truncate
on public.crypto_deposits
for each statement
execute function public.reject_retired_native_crypto_evidence_mutation();

comment on table public.crypto_deposit_addresses is
  'Retired native crypto address evidence. All addresses are disabled and immutable; service_role has read-only audit access.';

comment on table public.crypto_deposits is
  'Retired native crypto deposit evidence retained for financial reconciliation while the historical 9.99 USDT remains unswept. Immutable; service_role has read-only audit access.';

comment on function public.reject_retired_native_crypto_evidence_mutation() is
  'Rejects every mutation of retired native crypto audit evidence, including owner-issued writes and truncation.';

do $migration$
begin
  if to_regclass('public.crypto_deposit_addresses') is null
    or to_regclass('public.crypto_deposits') is null
    or to_regclass('public.crypto_sweep_jobs') is not null
    or to_regclass('public.crypto_watcher_state') is not null
  then
    raise exception 'Native crypto retirement table postcondition failed';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in ('crypto_deposit_addresses', 'crypto_deposits')
      and pg_get_userbyid(relation.relowner) <> 'postgres'
  ) then
    raise exception 'Native crypto archive owner postcondition failed';
  end if;

  if to_regprocedure(
    'public.apply_bsc_crypto_deposit_confirmation(uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,integer)'
  ) is not null
    or to_regprocedure(
      'public.credit_confirmed_bsc_crypto_deposit(uuid,uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,text,text)'
    ) is not null
    or to_regprocedure(
      'public.rotate_bsc_crypto_deposit_address(uuid,uuid,uuid,text,text)'
    ) is not null
    or to_regprocedure('public.normalize_crypto_deposit_address_activation_status()') is not null
    or to_regprocedure('public.set_crypto_updated_at()') is not null
    or to_regprocedure('public.reject_retired_native_crypto_evidence_mutation()') is null
  then
    raise exception 'Native crypto retirement function postcondition failed';
  end if;

  if exists (
    select 1
    from public.app_settings as setting
    where setting.key like 'crypto\_%' escape '\'
       or setting.key = 'usdt_etb_rate'
  ) then
    raise exception 'Native crypto settings remain after retirement';
  end if;

  if exists (
    select 1
    from public.crypto_deposit_addresses
    where status <> 'disabled'
  ) then
    raise exception 'A native crypto address remains active';
  end if;

  if not (
    (
      (select count(*) from public.crypto_deposits) = 0
      and (select count(*) from public.crypto_deposit_addresses) = 0
    ) or (
      (select count(*) from public.crypto_deposits) = 1
      and (select count(*) from public.crypto_deposit_addresses) = 2
    )
  )
  then
    raise exception 'Native crypto archive row counts changed unexpectedly';
  end if;

  if exists (select 1 from public.crypto_deposits) and not exists (
    select 1
    from public.crypto_deposits as deposit
    join public.transactions as ledger
      on ledger.id = deposit.credited_transaction_id
    where deposit.id = 'fcd260e7-970b-44a1-9089-d5a37a88d93d'::uuid
      and deposit.status = 'credited'
      and deposit.amount_usdt = 9.99::numeric
      and deposit.exchange_rate_etb = 190::numeric
      and deposit.credited_amount_etb = 1898.10::numeric
      and deposit.swept_at is null
      and ledger.id = '536fe882-dcbc-4b14-9a6d-89ce691425be'::uuid
      and ledger.reference_id = deposit.id
      and ledger.status::text = 'completed'
      and ledger.amount = 1898.10::numeric
      and ledger.balance_after - ledger.balance_before = 1898.10::numeric
      and ledger.metadata @> jsonb_build_object(
        'native_crypto_decommission',
        jsonb_build_object(
          'version', 1,
          'custody_status', 'unswept_external_asset_pending',
          'network', 'BSC',
          'asset', 'USDT',
          'deposit_id', 'fcd260e7-970b-44a1-9089-d5a37a88d93d',
          'chain_tx_hash', '0x766ec571a07beddc9b57f8436b05d1cbee7d1cfcac54c8c1003e9b53ddc9320b',
          'amount_usdt', '9.99',
          'exchange_rate_etb', '190',
          'credited_amount_etb', '1898.10',
          'bsc_watcher_last_scanned_block', 110698538,
          'bsc_watcher_last_updated_at', '2026-07-18T11:23:06.179878Z',
          'tron_watcher_last_scanned_block', 0,
          'tron_watcher_last_updated_at', '2026-07-10T10:52:56.951011Z'
        )
      )
  ) then
    raise exception 'Native crypto financial evidence changed during retirement';
  end if;

  if not exists (
    select 1
    from pg_trigger as trigger_info
    where trigger_info.tgrelid = 'public.crypto_deposit_addresses'::regclass
      and trigger_info.tgname = 'reject_retired_crypto_deposit_addresses_mutation'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled = 'O'
      and trigger_info.tgfoid =
        'public.reject_retired_native_crypto_evidence_mutation()'::regprocedure
      and trigger_info.tgtype = 62
  ) or not exists (
    select 1
    from pg_trigger as trigger_info
    where trigger_info.tgrelid = 'public.crypto_deposits'::regclass
      and trigger_info.tgname = 'reject_retired_crypto_deposits_mutation'
      and not trigger_info.tgisinternal
      and trigger_info.tgenabled = 'O'
      and trigger_info.tgfoid =
        'public.reject_retired_native_crypto_evidence_mutation()'::regprocedure
      and trigger_info.tgtype = 62
  ) then
    raise exception 'Native crypto immutable archive trigger is missing';
  end if;

  if (
    select count(*)
    from pg_trigger as trigger_info
    where trigger_info.tgrelid in (
      'public.crypto_deposit_addresses'::regclass,
      'public.crypto_deposits'::regclass
    )
      and not trigger_info.tgisinternal
  ) <> 2 then
    raise exception 'Unexpected native crypto archive trigger remains';
  end if;

  if exists (
    select 1
    from pg_policies as policy_info
    where policy_info.schemaname = 'public'
      and policy_info.tablename in ('crypto_deposit_addresses', 'crypto_deposits')
  ) then
    raise exception 'Unexpected native crypto archive policy exists';
  end if;

  if exists (
    select 1
    from pg_attribute as column_info
    where column_info.attrelid in (
      'public.crypto_deposit_addresses'::regclass,
      'public.crypto_deposits'::regclass
    )
      and column_info.attnum > 0
      and not column_info.attisdropped
      and column_info.attacl is not null
  ) then
    raise exception 'Unexpected native crypto archive column grant exists';
  end if;

  if exists (
    select 1
    from pg_class as relation
    join pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) as table_acl
    left join pg_roles as grantee
      on grantee.oid = table_acl.grantee
    where namespace.nspname = 'public'
      and relation.relname in ('crypto_deposit_addresses', 'crypto_deposits')
      and table_acl.grantee <> relation.relowner
      and (
        grantee.rolname is distinct from 'service_role'
        or table_acl.privilege_type <> 'SELECT'
        or table_acl.is_grantable
      )
  ) then
    raise exception 'Unexpected native crypto archive table grant remains';
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    if not has_table_privilege(
      'service_role', 'public.crypto_deposit_addresses', 'SELECT'
    ) or not has_table_privilege(
      'service_role', 'public.crypto_deposits', 'SELECT'
    ) or has_table_privilege(
      'service_role', 'public.crypto_deposit_addresses', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    ) or has_table_privilege(
      'service_role', 'public.crypto_deposits', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
    ) then
      raise exception 'service_role native crypto archive privileges are not read-only';
    end if;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') and (
    has_table_privilege('anon', 'public.crypto_deposit_addresses', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_table_privilege('anon', 'public.crypto_deposits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ) then
    raise exception 'anon retains native crypto archive privileges';
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') and (
    has_table_privilege('authenticated', 'public.crypto_deposit_addresses', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    or has_table_privilege('authenticated', 'public.crypto_deposits', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  ) then
    raise exception 'authenticated retains native crypto archive privileges';
  end if;
end;
$migration$;
