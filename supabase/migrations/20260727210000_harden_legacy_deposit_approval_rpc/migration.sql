-- Harden the legacy fiat-deposit approval boundary without changing its
-- signature, source, return contract, or financial behavior.
--
-- The production migration runner owns the transaction. Do not add file-level
-- transaction control here.

do $preflight$
declare
  v_function_oid oid :=
    pg_catalog.to_regprocedure(
      'public.approve_deposit_tx(uuid,uuid,text,text,numeric)'
    );
  v_public_schema oid := pg_catalog.to_regnamespace('public');
  v_postgres oid := pg_catalog.to_regrole('postgres');
  v_anon oid := pg_catalog.to_regrole('anon');
  v_authenticated oid := pg_catalog.to_regrole('authenticated');
  v_service_role oid := pg_catalog.to_regrole('service_role');
  v_named_function_count bigint;
  v_function record;
begin
  if v_public_schema is null
    or v_postgres is null
    or v_anon is null
    or v_authenticated is null
    or v_service_role is null
  then
    raise exception
      'legacy deposit approval hardening requires the expected Supabase roles and public schema';
  end if;

  select pg_catalog.count(*)
    into v_named_function_count
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
   where namespace_row.nspname = 'public'
     and procedure_row.proname = 'approve_deposit_tx';

  if v_named_function_count <> 1 or v_function_oid is null then
    raise exception
      'unexpected legacy deposit approval function identity';
  end if;

  select
    procedure_row.oid,
    pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
    language_row.lanname as language_name,
    procedure_row.prokind,
    procedure_row.pronargs,
    procedure_row.pronargdefaults,
    procedure_row.proretset,
    procedure_row.proleakproof,
    procedure_row.procost,
    procedure_row.prorows,
    procedure_row.prosupport,
    procedure_row.prosecdef,
    procedure_row.provolatile,
    procedure_row.proisstrict,
    procedure_row.proparallel,
    procedure_row.proconfig,
    procedure_row.proacl,
    pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
      as identity_arguments,
    pg_catalog.pg_get_function_arguments(procedure_row.oid)
      as arguments_with_defaults,
    pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
    pg_catalog.md5(
      pg_catalog.replace(procedure_row.prosrc, E'\r\n', E'\n')
    ) as normalized_source_md5
    into strict v_function
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure_row.prolang
   where procedure_row.oid = v_function_oid;

  if v_function.owner_name <> 'postgres'
    or v_function.language_name <> 'plpgsql'
    or v_function.prokind <> 'f'
    or v_function.pronargs <> 5
    or v_function.pronargdefaults <> 2
    or v_function.proretset
    or v_function.proleakproof
    or v_function.procost <> 100
    or v_function.prorows <> 0
    or v_function.prosupport::oid <> 0::oid
    or not v_function.prosecdef
    or v_function.provolatile <> 'v'
    or v_function.proisstrict
    or v_function.proparallel <> 'u'
    or v_function.proconfig is not null
    or v_function.identity_arguments <>
      'p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text, p_amount numeric'
    or v_function.arguments_with_defaults <>
      'p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric'
    or v_function.result_type <> 'jsonb'
    or v_function.normalized_source_md5 <>
      '34836ec867a8cd81a8e14d3cd55646ce'
  then
    raise exception
      'unexpected legacy deposit approval function catalog';
  end if;

  if exists (
    with actual as (
      select
        acl_row.grantee,
        acl_row.grantor,
        acl_row.privilege_type,
        acl_row.is_grantable
        from pg_catalog.aclexplode(v_function.proacl) acl_row
    ),
    expected(grantee, grantor, privilege_type, is_grantable) as (
      values
        (0::oid, v_postgres, 'EXECUTE'::text, false),
        (v_anon, v_postgres, 'EXECUTE'::text, false),
        (v_authenticated, v_postgres, 'EXECUTE'::text, false),
        (v_postgres, v_postgres, 'EXECUTE'::text, false),
        (v_service_role, v_postgres, 'EXECUTE'::text, false)
    ),
    drift as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from drift
  ) then
    raise exception
      'unexpected legacy deposit approval function privileges';
  end if;

  if pg_catalog.has_schema_privilege(
      'anon',
      v_public_schema,
      'CREATE'
    )
    or pg_catalog.has_schema_privilege(
      'authenticated',
      v_public_schema,
      'CREATE'
    )
    or pg_catalog.has_schema_privilege(
      'service_role',
      v_public_schema,
      'CREATE'
    )
  then
    raise exception
      'unexpected public schema create privilege';
  end if;

  if exists (
    with recursive inherited_roles(member, roleid) as (
      select membership_row.member, membership_row.roleid
        from pg_catalog.pg_auth_members membership_row
      union
      select inherited_roles.member, parent_membership.roleid
        from inherited_roles
        join pg_catalog.pg_auth_members parent_membership
          on parent_membership.member = inherited_roles.roleid
    )
    select 1
      from inherited_roles
     where inherited_roles.member in (v_anon, v_authenticated)
       and inherited_roles.roleid in (v_service_role, v_postgres)
  ) then
    raise exception
      'unexpected client role inheritance';
  end if;
end;
$preflight$;

alter function public.approve_deposit_tx(uuid, uuid, text, text, numeric)
  set search_path to pg_catalog, public, pg_temp;

revoke all on function
  public.approve_deposit_tx(uuid, uuid, text, text, numeric)
  from public, anon, authenticated, service_role, postgres;

grant execute on function
  public.approve_deposit_tx(uuid, uuid, text, text, numeric)
  to postgres, service_role;

do $postflight$
declare
  v_function_oid oid :=
    pg_catalog.to_regprocedure(
      'public.approve_deposit_tx(uuid,uuid,text,text,numeric)'
    );
  v_public_schema oid := pg_catalog.to_regnamespace('public');
  v_postgres oid := pg_catalog.to_regrole('postgres');
  v_anon oid := pg_catalog.to_regrole('anon');
  v_authenticated oid := pg_catalog.to_regrole('authenticated');
  v_service_role oid := pg_catalog.to_regrole('service_role');
  v_named_function_count bigint;
  v_function record;
begin
  if v_public_schema is null
    or v_postgres is null
    or v_anon is null
    or v_authenticated is null
    or v_service_role is null
  then
    raise exception
      'legacy deposit approval hardening lost an expected role or schema';
  end if;

  select pg_catalog.count(*)
    into v_named_function_count
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
   where namespace_row.nspname = 'public'
     and procedure_row.proname = 'approve_deposit_tx';

  if v_named_function_count <> 1 or v_function_oid is null then
    raise exception
      'legacy deposit approval function identity changed unexpectedly';
  end if;

  select
    procedure_row.oid,
    pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
    language_row.lanname as language_name,
    procedure_row.prokind,
    procedure_row.pronargs,
    procedure_row.pronargdefaults,
    procedure_row.proretset,
    procedure_row.proleakproof,
    procedure_row.procost,
    procedure_row.prorows,
    procedure_row.prosupport,
    procedure_row.prosecdef,
    procedure_row.provolatile,
    procedure_row.proisstrict,
    procedure_row.proparallel,
    procedure_row.proconfig,
    procedure_row.proacl,
    pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
      as identity_arguments,
    pg_catalog.pg_get_function_arguments(procedure_row.oid)
      as arguments_with_defaults,
    pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
    pg_catalog.md5(
      pg_catalog.replace(procedure_row.prosrc, E'\r\n', E'\n')
    ) as normalized_source_md5
    into strict v_function
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure_row.prolang
   where procedure_row.oid = v_function_oid;

  if v_function.owner_name <> 'postgres'
    or v_function.language_name <> 'plpgsql'
    or v_function.prokind <> 'f'
    or v_function.pronargs <> 5
    or v_function.pronargdefaults <> 2
    or v_function.proretset
    or v_function.proleakproof
    or v_function.procost <> 100
    or v_function.prorows <> 0
    or v_function.prosupport::oid <> 0::oid
    or not v_function.prosecdef
    or v_function.provolatile <> 'v'
    or v_function.proisstrict
    or v_function.proparallel <> 'u'
    or v_function.proconfig is distinct from
      array['search_path=pg_catalog, public, pg_temp']::text[]
    or v_function.identity_arguments <>
      'p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text, p_amount numeric'
    or v_function.arguments_with_defaults <>
      'p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric'
    or v_function.result_type <> 'jsonb'
    or v_function.normalized_source_md5 <>
      '34836ec867a8cd81a8e14d3cd55646ce'
  then
    raise exception
      'legacy deposit approval hardening changed the function contract';
  end if;

  if exists (
    with actual as (
      select
        acl_row.grantee,
        acl_row.grantor,
        acl_row.privilege_type,
        acl_row.is_grantable
        from pg_catalog.aclexplode(v_function.proacl) acl_row
    ),
    expected(grantee, grantor, privilege_type, is_grantable) as (
      values
        (v_postgres, v_postgres, 'EXECUTE'::text, false),
        (v_service_role, v_postgres, 'EXECUTE'::text, false)
    ),
    drift as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from drift
  ) then
    raise exception
      'unexpected hardened legacy deposit approval function privileges';
  end if;

  if pg_catalog.has_function_privilege(
      'anon',
      v_function_oid,
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      v_function_oid,
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'service_role',
      v_function_oid,
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'postgres',
      v_function_oid,
      'EXECUTE'
    )
  then
    raise exception
      'unexpected hardened legacy deposit approval effective privileges';
  end if;

  if pg_catalog.has_schema_privilege(
      'anon',
      v_public_schema,
      'CREATE'
    )
    or pg_catalog.has_schema_privilege(
      'authenticated',
      v_public_schema,
      'CREATE'
    )
    or pg_catalog.has_schema_privilege(
      'service_role',
      v_public_schema,
      'CREATE'
    )
  then
    raise exception
      'unexpected public schema create privilege after hardening';
  end if;

  if exists (
    with recursive inherited_roles(member, roleid) as (
      select membership_row.member, membership_row.roleid
        from pg_catalog.pg_auth_members membership_row
      union
      select inherited_roles.member, parent_membership.roleid
        from inherited_roles
        join pg_catalog.pg_auth_members parent_membership
          on parent_membership.member = inherited_roles.roleid
    )
    select 1
      from inherited_roles
     where inherited_roles.member in (v_anon, v_authenticated)
       and inherited_roles.roleid in (v_service_role, v_postgres)
  ) then
    raise exception
      'unexpected client role inheritance after hardening';
  end if;
end;
$postflight$;
