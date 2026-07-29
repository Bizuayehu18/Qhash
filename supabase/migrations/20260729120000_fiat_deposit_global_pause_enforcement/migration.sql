-- Restore the shared deposits_paused boundary for legacy CBE and TeleBirr
-- submissions. Crypto admission already consumes the same setting through its
-- protected lifecycle functions.
--
-- The production migration runner owns the transaction. Do not add file-level
-- transaction control here.

-- Lock configuration before admission. ACCESS EXCLUSIVE closes the
-- preflight-to-DDL window for relation, policy, ACL, constraint, index, and
-- trigger changes while the runner-owned transaction remains open.
lock table
  public.deposit_verification_logs,
  public.payment_methods,
  public.profiles
in access share mode;
lock table public.app_settings in access exclusive mode;
lock table public.deposits in access exclusive mode;

do $preflight$
declare
  v_inherited_catalog_md5 text;
  v_policy_dependency_md5 text;
  v_deposit_status_catalog jsonb;
  v_pause_value text;
  v_public_schema oid := pg_catalog.to_regnamespace('public');
  v_postgres oid := pg_catalog.to_regrole('postgres');
  v_anon oid := pg_catalog.to_regrole('anon');
  v_authenticated oid := pg_catalog.to_regrole('authenticated');
  v_service_role oid := pg_catalog.to_regrole('service_role');
begin
  if v_public_schema is null
    or v_postgres is null
    or v_anon is null
    or v_authenticated is null
    or v_service_role is null
    or pg_catalog.to_regclass('public.app_settings') is null
    or pg_catalog.to_regclass('public.deposits') is null
  then
    raise exception
      'fiat deposit pause enforcement requires the expected Supabase catalog';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_roles role_row
    where (
      role_row.rolname in ('anon', 'authenticated')
      and role_row.rolinherit
      and not role_row.rolbypassrls
      and not role_row.rolcanlogin
    ) or (
      role_row.rolname = 'service_role'
      and role_row.rolinherit
      and role_row.rolbypassrls
      and not role_row.rolcanlogin
    )
  ) <> 3
  then
    raise exception 'unexpected Supabase role catalog';
  end if;

  if pg_catalog.has_schema_privilege('anon', v_public_schema, 'CREATE')
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
    raise exception 'unexpected public schema create privilege';
  end if;

  if exists (
    with recursive inherited_roles(member, roleid) as (
      select membership.member, membership.roleid
      from pg_catalog.pg_auth_members membership
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
  )
  then
    raise exception 'unexpected client role inheritance';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'enforce_fiat_deposits_open'
  ) <> 0
  then
    raise exception 'unexpected fiat deposit pause function identity';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.deposits'::regclass
      and trigger_row.tgname = 'trg_deposits_require_open'
  )
  then
    raise exception 'unexpected fiat deposit pause trigger identity';
  end if;

  with schema_row as (
    select pg_catalog.jsonb_build_array(
      namespace_row.nspname,
      pg_catalog.pg_get_userbyid(namespace_row.nspowner),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(namespace_row.nspacl) acl_row
      )
    ) as row_value
    from pg_catalog.pg_namespace namespace_row
    where namespace_row.nspname = 'public'
  ),
  target_relations as (
    select
      relation.oid,
      namespace_row.nspname,
      relation.relname,
      relation.relowner,
      relation.relkind,
      relation.relpersistence,
      relation.relrowsecurity,
      relation.relforcerowsecurity,
      relation.relacl
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'public'
      and relation.relname in ('app_settings', 'deposits')
  ),
  relevant_fk_constraints as (
    select constraint_row.*
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and (
        constraint_row.conrelid in (
          select target.oid
          from target_relations target
        )
        or constraint_row.confrelid in (
          select target.oid
          from target_relations target
        )
      )
  ),
  relation_rows as (
    select
      target.relname,
      pg_catalog.jsonb_build_array(
        target.relname,
        pg_catalog.pg_get_userbyid(target.relowner),
        target.relkind,
        target.relpersistence,
        target.relrowsecurity,
        target.relforcerowsecurity,
        (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                acl_row.privilege_type,
                acl_row.is_grantable
              )
              order by
                pg_catalog.convert_to(
                  case
                    when acl_row.grantee = 0 then 'PUBLIC'
                    else pg_catalog.pg_get_userbyid(acl_row.grantee)
                  end,
                  'UTF8'
                ),
                pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
            ),
            '[]'::jsonb
          )
          from pg_catalog.aclexplode(target.relacl) acl_row
        )
      ) as row_value
    from target_relations target
  ),
  column_rows as (
    select
      target.relname,
      attribute.attnum,
      pg_catalog.jsonb_build_array(
        target.relname,
        attribute.attnum,
        attribute.attname,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        attribute.attnotnull,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
        attribute.attidentity,
        attribute.attgenerated,
        attribute.attacl is null
      ) as row_value
    from target_relations target
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = target.oid
    left join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute.attrelid
     and default_row.adnum = attribute.attnum
    where attribute.attnum > 0
      and not attribute.attisdropped
  ),
  constraint_rows as (
    select
      target.relname,
      constraint_row.conname,
      pg_catalog.jsonb_build_array(
        target.relname,
        constraint_row.conname,
        constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        case
          when constraint_row.conindid = 0 then null
          else constraint_row.conindid::regclass::text
        end
      ) as row_value
    from target_relations target
    join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid = target.oid
  ),
  index_rows as (
    select
      target.relname,
      index_relation.relname as index_name,
      pg_catalog.jsonb_build_array(
        target.relname,
        index_relation.relname,
        index_relation.relkind,
        index_row.indisunique,
        index_row.indisprimary,
        index_row.indimmediate,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indislive,
        index_row.indnkeyatts,
        index_row.indnatts,
        index_row.indkey::text,
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        pg_catalog.pg_get_expr(index_row.indexprs, index_row.indrelid),
        pg_catalog.pg_get_indexdef(index_row.indexrelid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_index index_row
      on index_row.indrelid = target.oid
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
  ),
  policy_rows as (
    select
      target.relname,
      policy_row.polname,
      pg_catalog.jsonb_build_array(
        target.relname,
        policy_row.polname,
        policy_row.polpermissive,
        policy_row.polcmd,
        (
          select pg_catalog.jsonb_agg(
            case
              when role_oid = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(role_oid)
            end
            order by pg_catalog.convert_to(
              case
                when role_oid = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(role_oid)
              end,
              'UTF8'
            )
          )
          from pg_catalog.unnest(policy_row.polroles) role_oid
        ),
        pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
        pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_policy policy_row
      on policy_row.polrelid = target.oid
  ),
  trigger_rows as (
    select
      target.relname,
      trigger_row.tgname,
      pg_catalog.jsonb_build_array(
        target.relname,
        trigger_row.tgname,
        trigger_row.tgenabled,
        trigger_row.tgtype,
        trigger_row.tgisinternal,
        trigger_row.tgnargs,
        trigger_row.tgattr::text,
        trigger_row.tgqual is null,
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_trigger trigger_row
      on trigger_row.tgrelid = target.oid
    join pg_catalog.pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where not trigger_row.tgisinternal
      and not (
        target.relname = 'deposits'
        and trigger_row.tgname = 'trg_deposits_require_open'
      )
  ),
  internal_trigger_rows as (
    select
      trigger_relation_namespace.nspname as trigger_relation_namespace,
      trigger_relation.relname as trigger_relname,
      constraint_namespace.nspname as constraint_namespace,
      constraint_row.conname,
      trigger_row.tgtype,
      function_namespace.nspname as function_namespace,
      function_row.proname,
      pg_catalog.jsonb_build_array(
        trigger_relation_namespace.nspname,
        trigger_relation.relname,
        constraint_namespace.nspname,
        constraint_row.conname,
        constraint_row.conrelid::pg_catalog.regclass::text,
        constraint_row.confrelid::pg_catalog.regclass::text,
        constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        trigger_row.tgenabled,
        trigger_row.tgtype,
        function_namespace.nspname,
        function_row.proname,
        trigger_row.tgconstrrelid::pg_catalog.regclass::text,
        referenced_relation_namespace.nspname,
        referenced_relation.relname,
        referenced_index_relation.relname,
        referenced_index_row.indisunique,
        referenced_index_row.indisprimary,
        referenced_index_row.indimmediate,
        referenced_index_row.indisvalid,
        referenced_index_row.indisready,
        referenced_index_row.indislive,
        referenced_index_row.indnkeyatts,
        referenced_index_row.indnatts,
        referenced_index_row.indkey::text,
        pg_catalog.pg_get_expr(
          referenced_index_row.indpred,
          referenced_index_row.indrelid
        ),
        pg_catalog.pg_get_expr(
          referenced_index_row.indexprs,
          referenced_index_row.indrelid
        ),
        pg_catalog.pg_get_indexdef(referenced_index_row.indexrelid),
        referenced_constraint_namespace.nspname,
        referenced_constraint.conname,
        referenced_constraint.contype,
        referenced_constraint.conrelid::pg_catalog.regclass::text,
        referenced_constraint.convalidated,
        referenced_constraint.condeferrable,
        referenced_constraint.condeferred
      ) as row_value
    from relevant_fk_constraints constraint_row
    join pg_catalog.pg_trigger trigger_row
      on trigger_row.tgconstraint = constraint_row.oid
     and trigger_row.tgisinternal
    join pg_catalog.pg_class trigger_relation
      on trigger_relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace trigger_relation_namespace
      on trigger_relation_namespace.oid = trigger_relation.relnamespace
    join pg_catalog.pg_namespace constraint_namespace
      on constraint_namespace.oid = constraint_row.connamespace
    join pg_catalog.pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    left join pg_catalog.pg_index referenced_index_row
      on referenced_index_row.indexrelid = trigger_row.tgconstrindid
    left join pg_catalog.pg_class referenced_index_relation
      on referenced_index_relation.oid = referenced_index_row.indexrelid
    left join pg_catalog.pg_class referenced_relation
      on referenced_relation.oid = referenced_index_row.indrelid
    left join pg_catalog.pg_namespace referenced_relation_namespace
      on referenced_relation_namespace.oid = referenced_relation.relnamespace
    left join pg_catalog.pg_constraint referenced_constraint
      on referenced_constraint.conindid = referenced_index_row.indexrelid
     and referenced_constraint.conrelid = referenced_index_row.indrelid
     and referenced_constraint.contype in ('p', 'u')
    left join pg_catalog.pg_namespace referenced_constraint_namespace
      on referenced_constraint_namespace.oid =
        referenced_constraint.connamespace
  ),
  updater_function as (
    select pg_catalog.jsonb_build_array(
      pg_catalog.pg_get_userbyid(function_row.proowner),
      language_row.lanname,
      function_row.prokind,
      function_row.pronargs,
      function_row.pronargdefaults,
      function_row.proretset,
      function_row.prosecdef,
      function_row.provolatile,
      function_row.proisstrict,
      function_row.proparallel,
      function_row.proconfig,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid),
      pg_catalog.pg_get_function_result(function_row.oid),
      pg_catalog.md5(
        pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
      ),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(function_row.proacl) acl_row
      )
    ) as row_value
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_namespace.nspname = 'public'
      and function_row.proname = 'update_updated_at_column'
      and pg_catalog.pg_get_function_identity_arguments(function_row.oid) = ''
  ),
  fingerprint as (
    select pg_catalog.jsonb_build_object(
      'schema',
        (select row_value from schema_row),
      'relations',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by pg_catalog.convert_to(relname, 'UTF8')
          )
          from relation_rows
        ),
      'columns',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by pg_catalog.convert_to(relname, 'UTF8'), attnum
          )
          from column_rows
        ),
      'constraints',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(conname, 'UTF8')
          )
          from constraint_rows
        ),
      'indexes',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(index_name, 'UTF8')
          )
          from index_rows
        ),
      'policies',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(polname, 'UTF8')
          )
          from policy_rows
        ),
      'triggers',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(tgname, 'UTF8')
          )
          from trigger_rows
        ),
      'internal_triggers',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(trigger_relation_namespace, 'UTF8'),
              pg_catalog.convert_to(trigger_relname, 'UTF8'),
              pg_catalog.convert_to(constraint_namespace, 'UTF8'),
              pg_catalog.convert_to(conname, 'UTF8'),
              tgtype,
              pg_catalog.convert_to(function_namespace, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8')
          )
          from internal_trigger_rows
        ),
      'updater',
        (select row_value from updater_function)
    ) as value
  )
  select pg_catalog.md5(value::text)
    into v_inherited_catalog_md5
  from fingerprint;

  if v_inherited_catalog_md5 is distinct from
    'fcf41d198f7013cd09abd89aadc290be'
  then
    raise exception 'unexpected inherited fiat deposit catalog';
  end if;

  with policy_dependency_function_rows as (
    select
      function_namespace.nspname as schema_name,
      function_row.proname,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)
        as identity_arguments,
      pg_catalog.jsonb_build_array(
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_userbyid(function_row.proowner),
        language_row.lanname,
        function_row.prokind,
        function_row.pronargs,
        function_row.pronargdefaults,
        function_row.proretset,
        function_row.proleakproof,
        function_row.procost,
        function_row.prorows,
        function_row.prosupport::oid,
        function_row.provariadic::oid,
        function_row.prosecdef,
        function_row.provolatile,
        function_row.proisstrict,
        function_row.proparallel,
        function_row.proconfig,
        function_row.probin,
        function_row.prosqlbody is null,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid),
        pg_catalog.pg_get_function_result(function_row.oid),
        pg_catalog.md5(
          pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
        ),
        function_row.proacl is null,
        (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                acl_row.privilege_type,
                acl_row.is_grantable
              )
              order by
                pg_catalog.convert_to(
                  case
                    when acl_row.grantee = 0 then 'PUBLIC'
                    else pg_catalog.pg_get_userbyid(acl_row.grantee)
                  end,
                  'UTF8'
                ),
                pg_catalog.convert_to(
                  pg_catalog.pg_get_userbyid(acl_row.grantor),
                  'UTF8'
                ),
                pg_catalog.convert_to(acl_row.privilege_type, 'UTF8'),
                acl_row.is_grantable
            ),
            '[]'::jsonb
          )
          from pg_catalog.aclexplode(function_row.proacl) acl_row
        )
      ) as row_value
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where (
      function_namespace.nspname = 'auth'
      and function_row.proname = 'uid'
    ) or (
      function_namespace.nspname = 'public'
      and function_row.proname = 'is_admin'
    )
  ),
  policy_dependency_binding_rows as (
    select
      policy_row.polname,
      function_namespace.nspname as schema_name,
      function_row.proname,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)
        as identity_arguments,
      pg_catalog.jsonb_build_array(
        policy_row.polname,
        dependency_row.deptype,
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ) as row_value
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_depend dependency_row
      on dependency_row.classid = 'pg_catalog.pg_policy'::regclass
     and dependency_row.objid = policy_row.oid
     and dependency_row.refclassid = 'pg_catalog.pg_proc'::regclass
    join pg_catalog.pg_proc function_row
      on function_row.oid = dependency_row.refobjid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where policy_row.polrelid = 'public.deposits'::regclass
  ),
  policy_dependency_fingerprint as (
    select pg_catalog.jsonb_build_object(
      'functions',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(schema_name, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8'),
              pg_catalog.convert_to(identity_arguments, 'UTF8')
          )
          from policy_dependency_function_rows
        ),
      'bindings',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(polname, 'UTF8'),
              pg_catalog.convert_to(schema_name, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8'),
              pg_catalog.convert_to(identity_arguments, 'UTF8')
          )
          from policy_dependency_binding_rows
        )
    ) as value
  )
  select pg_catalog.md5(value::text)
    into v_policy_dependency_md5
  from policy_dependency_fingerprint;

  if v_policy_dependency_md5 is distinct from
    '58e8091e1a82038071e1067c709ca409'
  then
    raise exception 'unexpected inherited fiat deposit catalog';
  end if;

  with deposit_status_enum as (
    select pg_catalog.jsonb_build_array(
      type_namespace.nspname,
      type_row.typname,
      pg_catalog.pg_get_userbyid(type_row.typowner),
      type_row.typtype,
      type_row.typcategory,
      type_row.typispreferred,
      type_row.typisdefined,
      type_row.typlen,
      type_row.typbyval,
      type_row.typalign,
      type_row.typstorage,
      type_row.typdelim,
      type_row.typnotnull,
      type_row.typbasetype = 0::oid,
      type_row.typtypmod,
      type_row.typndims,
      type_row.typcollation = 0::oid,
      type_row.typdefault is null,
      type_row.typdefaultbin is null,
      type_row.typacl is null,
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8'),
              acl_row.is_grantable
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(type_row.typacl) acl_row
      ),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              enum_value.enumlabel,
              enum_value.enum_ordinal
            )
            order by enum_value.enum_ordinal
          ),
          '[]'::jsonb
        )
        from (
          select
            enum_row.enumlabel::text,
            pg_catalog.row_number() over (
              order by enum_row.enumsortorder
            ) as enum_ordinal
          from pg_catalog.pg_enum enum_row
          where enum_row.enumtypid = type_row.oid
        ) enum_value
      )
    ) as row_value
    from pg_catalog.pg_attribute attribute_row
    join pg_catalog.pg_type type_row
      on type_row.oid = attribute_row.atttypid
    join pg_catalog.pg_namespace type_namespace
      on type_namespace.oid = type_row.typnamespace
    where attribute_row.attrelid = 'public.deposits'::regclass
      and attribute_row.attname = 'status'
      and attribute_row.attnum > 0
      and not attribute_row.attisdropped
  )
  select row_value
    into v_deposit_status_catalog
  from deposit_status_enum;

  if v_deposit_status_catalog is distinct from
    '[
      "public",
      "deposit_status",
      "postgres",
      "e",
      "E",
      false,
      true,
      4,
      true,
      "i",
      "p",
      ",",
      false,
      true,
      -1,
      0,
      true,
      true,
      true,
      true,
      [],
      [["pending", 1], ["approved", 2], ["rejected", 3]]
    ]'::jsonb
  then
    raise exception 'unexpected inherited fiat deposit catalog';
  end if;

  begin
    select setting.value
      into strict v_pause_value
    from public.app_settings setting
    where setting.key = 'deposits_paused'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'unexpected deposits_paused configuration';
  end;

  if v_pause_value not in ('false', 'true') then
    raise exception 'unexpected deposits_paused configuration';
  end if;
end;
$preflight$;

create function public.enforce_fiat_deposits_open()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $guard$
declare
  v_pause_value text;
begin
  begin
    select setting.value
      into strict v_pause_value
    from public.app_settings setting
    where setting.key = 'deposits_paused'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception using
        errcode = 'P0001',
        message = 'Deposits are currently paused';
  end;

  if v_pause_value is distinct from 'false' then
    raise exception using
      errcode = 'P0001',
      message = 'Deposits are currently paused';
  end if;

  return new;
end;
$guard$;

alter function public.enforce_fiat_deposits_open() owner to postgres;

revoke all on function public.enforce_fiat_deposits_open()
  from public, anon, authenticated, service_role, postgres;

grant execute on function public.enforce_fiat_deposits_open()
  to postgres;

create trigger trg_deposits_require_open
before insert on public.deposits
for each row
execute function public.enforce_fiat_deposits_open();

do $postflight$
declare
  v_inherited_catalog_md5 text;
  v_policy_dependency_md5 text;
  v_deposit_status_catalog jsonb;
  v_pause_value text;
  v_function record;
  v_function_oid oid :=
    pg_catalog.to_regprocedure('public.enforce_fiat_deposits_open()');
  v_postgres oid := pg_catalog.to_regrole('postgres');
begin
  with schema_row as (
    select pg_catalog.jsonb_build_array(
      namespace_row.nspname,
      pg_catalog.pg_get_userbyid(namespace_row.nspowner),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(namespace_row.nspacl) acl_row
      )
    ) as row_value
    from pg_catalog.pg_namespace namespace_row
    where namespace_row.nspname = 'public'
  ),
  target_relations as (
    select
      relation.oid,
      namespace_row.nspname,
      relation.relname,
      relation.relowner,
      relation.relkind,
      relation.relpersistence,
      relation.relrowsecurity,
      relation.relforcerowsecurity,
      relation.relacl
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation.relnamespace
    where namespace_row.nspname = 'public'
      and relation.relname in ('app_settings', 'deposits')
  ),
  relevant_fk_constraints as (
    select constraint_row.*
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and (
        constraint_row.conrelid in (
          select target.oid
          from target_relations target
        )
        or constraint_row.confrelid in (
          select target.oid
          from target_relations target
        )
      )
  ),
  relation_rows as (
    select
      target.relname,
      pg_catalog.jsonb_build_array(
        target.relname,
        pg_catalog.pg_get_userbyid(target.relowner),
        target.relkind,
        target.relpersistence,
        target.relrowsecurity,
        target.relforcerowsecurity,
        (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                acl_row.privilege_type,
                acl_row.is_grantable
              )
              order by
                pg_catalog.convert_to(
                  case
                    when acl_row.grantee = 0 then 'PUBLIC'
                    else pg_catalog.pg_get_userbyid(acl_row.grantee)
                  end,
                  'UTF8'
                ),
                pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
            ),
            '[]'::jsonb
          )
          from pg_catalog.aclexplode(target.relacl) acl_row
        )
      ) as row_value
    from target_relations target
  ),
  column_rows as (
    select
      target.relname,
      attribute.attnum,
      pg_catalog.jsonb_build_array(
        target.relname,
        attribute.attnum,
        attribute.attname,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
        attribute.attnotnull,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
        attribute.attidentity,
        attribute.attgenerated,
        attribute.attacl is null
      ) as row_value
    from target_relations target
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = target.oid
    left join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute.attrelid
     and default_row.adnum = attribute.attnum
    where attribute.attnum > 0
      and not attribute.attisdropped
  ),
  constraint_rows as (
    select
      target.relname,
      constraint_row.conname,
      pg_catalog.jsonb_build_array(
        target.relname,
        constraint_row.conname,
        constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        case
          when constraint_row.conindid = 0 then null
          else constraint_row.conindid::regclass::text
        end
      ) as row_value
    from target_relations target
    join pg_catalog.pg_constraint constraint_row
      on constraint_row.conrelid = target.oid
  ),
  index_rows as (
    select
      target.relname,
      index_relation.relname as index_name,
      pg_catalog.jsonb_build_array(
        target.relname,
        index_relation.relname,
        index_relation.relkind,
        index_row.indisunique,
        index_row.indisprimary,
        index_row.indimmediate,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indislive,
        index_row.indnkeyatts,
        index_row.indnatts,
        index_row.indkey::text,
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid),
        pg_catalog.pg_get_expr(index_row.indexprs, index_row.indrelid),
        pg_catalog.pg_get_indexdef(index_row.indexrelid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_index index_row
      on index_row.indrelid = target.oid
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
  ),
  policy_rows as (
    select
      target.relname,
      policy_row.polname,
      pg_catalog.jsonb_build_array(
        target.relname,
        policy_row.polname,
        policy_row.polpermissive,
        policy_row.polcmd,
        (
          select pg_catalog.jsonb_agg(
            case
              when role_oid = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(role_oid)
            end
            order by pg_catalog.convert_to(
              case
                when role_oid = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(role_oid)
              end,
              'UTF8'
            )
          )
          from pg_catalog.unnest(policy_row.polroles) role_oid
        ),
        pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
        pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_policy policy_row
      on policy_row.polrelid = target.oid
  ),
  trigger_rows as (
    select
      target.relname,
      trigger_row.tgname,
      pg_catalog.jsonb_build_array(
        target.relname,
        trigger_row.tgname,
        trigger_row.tgenabled,
        trigger_row.tgtype,
        trigger_row.tgisinternal,
        trigger_row.tgnargs,
        trigger_row.tgattr::text,
        trigger_row.tgqual is null,
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ) as row_value
    from target_relations target
    join pg_catalog.pg_trigger trigger_row
      on trigger_row.tgrelid = target.oid
    join pg_catalog.pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where not trigger_row.tgisinternal
      and not (
        target.relname = 'deposits'
        and trigger_row.tgname = 'trg_deposits_require_open'
      )
  ),
  internal_trigger_rows as (
    select
      trigger_relation_namespace.nspname as trigger_relation_namespace,
      trigger_relation.relname as trigger_relname,
      constraint_namespace.nspname as constraint_namespace,
      constraint_row.conname,
      trigger_row.tgtype,
      function_namespace.nspname as function_namespace,
      function_row.proname,
      pg_catalog.jsonb_build_array(
        trigger_relation_namespace.nspname,
        trigger_relation.relname,
        constraint_namespace.nspname,
        constraint_row.conname,
        constraint_row.conrelid::pg_catalog.regclass::text,
        constraint_row.confrelid::pg_catalog.regclass::text,
        constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        trigger_row.tgenabled,
        trigger_row.tgtype,
        function_namespace.nspname,
        function_row.proname,
        trigger_row.tgconstrrelid::pg_catalog.regclass::text,
        referenced_relation_namespace.nspname,
        referenced_relation.relname,
        referenced_index_relation.relname,
        referenced_index_row.indisunique,
        referenced_index_row.indisprimary,
        referenced_index_row.indimmediate,
        referenced_index_row.indisvalid,
        referenced_index_row.indisready,
        referenced_index_row.indislive,
        referenced_index_row.indnkeyatts,
        referenced_index_row.indnatts,
        referenced_index_row.indkey::text,
        pg_catalog.pg_get_expr(
          referenced_index_row.indpred,
          referenced_index_row.indrelid
        ),
        pg_catalog.pg_get_expr(
          referenced_index_row.indexprs,
          referenced_index_row.indrelid
        ),
        pg_catalog.pg_get_indexdef(referenced_index_row.indexrelid),
        referenced_constraint_namespace.nspname,
        referenced_constraint.conname,
        referenced_constraint.contype,
        referenced_constraint.conrelid::pg_catalog.regclass::text,
        referenced_constraint.convalidated,
        referenced_constraint.condeferrable,
        referenced_constraint.condeferred
      ) as row_value
    from relevant_fk_constraints constraint_row
    join pg_catalog.pg_trigger trigger_row
      on trigger_row.tgconstraint = constraint_row.oid
     and trigger_row.tgisinternal
    join pg_catalog.pg_class trigger_relation
      on trigger_relation.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace trigger_relation_namespace
      on trigger_relation_namespace.oid = trigger_relation.relnamespace
    join pg_catalog.pg_namespace constraint_namespace
      on constraint_namespace.oid = constraint_row.connamespace
    join pg_catalog.pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    left join pg_catalog.pg_index referenced_index_row
      on referenced_index_row.indexrelid = trigger_row.tgconstrindid
    left join pg_catalog.pg_class referenced_index_relation
      on referenced_index_relation.oid = referenced_index_row.indexrelid
    left join pg_catalog.pg_class referenced_relation
      on referenced_relation.oid = referenced_index_row.indrelid
    left join pg_catalog.pg_namespace referenced_relation_namespace
      on referenced_relation_namespace.oid = referenced_relation.relnamespace
    left join pg_catalog.pg_constraint referenced_constraint
      on referenced_constraint.conindid = referenced_index_row.indexrelid
     and referenced_constraint.conrelid = referenced_index_row.indrelid
     and referenced_constraint.contype in ('p', 'u')
    left join pg_catalog.pg_namespace referenced_constraint_namespace
      on referenced_constraint_namespace.oid =
        referenced_constraint.connamespace
  ),
  updater_function as (
    select pg_catalog.jsonb_build_array(
      pg_catalog.pg_get_userbyid(function_row.proowner),
      language_row.lanname,
      function_row.prokind,
      function_row.pronargs,
      function_row.pronargdefaults,
      function_row.proretset,
      function_row.prosecdef,
      function_row.provolatile,
      function_row.proisstrict,
      function_row.proparallel,
      function_row.proconfig,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid),
      pg_catalog.pg_get_function_result(function_row.oid),
      pg_catalog.md5(
        pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
      ),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(function_row.proacl) acl_row
      )
    ) as row_value
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_namespace.nspname = 'public'
      and function_row.proname = 'update_updated_at_column'
      and pg_catalog.pg_get_function_identity_arguments(function_row.oid) = ''
  ),
  fingerprint as (
    select pg_catalog.jsonb_build_object(
      'schema',
        (select row_value from schema_row),
      'relations',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by pg_catalog.convert_to(relname, 'UTF8')
          )
          from relation_rows
        ),
      'columns',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by pg_catalog.convert_to(relname, 'UTF8'), attnum
          )
          from column_rows
        ),
      'constraints',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(conname, 'UTF8')
          )
          from constraint_rows
        ),
      'indexes',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(index_name, 'UTF8')
          )
          from index_rows
        ),
      'policies',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(polname, 'UTF8')
          )
          from policy_rows
        ),
      'triggers',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(relname, 'UTF8'),
              pg_catalog.convert_to(tgname, 'UTF8')
          )
          from trigger_rows
        ),
      'internal_triggers',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(trigger_relation_namespace, 'UTF8'),
              pg_catalog.convert_to(trigger_relname, 'UTF8'),
              pg_catalog.convert_to(constraint_namespace, 'UTF8'),
              pg_catalog.convert_to(conname, 'UTF8'),
              tgtype,
              pg_catalog.convert_to(function_namespace, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8')
          )
          from internal_trigger_rows
        ),
      'updater',
        (select row_value from updater_function)
    ) as value
  )
  select pg_catalog.md5(value::text)
    into v_inherited_catalog_md5
  from fingerprint;

  if v_inherited_catalog_md5 is distinct from
    'fcf41d198f7013cd09abd89aadc290be'
  then
    raise exception 'inherited fiat deposit catalog changed during migration';
  end if;

  with policy_dependency_function_rows as (
    select
      function_namespace.nspname as schema_name,
      function_row.proname,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)
        as identity_arguments,
      pg_catalog.jsonb_build_array(
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_userbyid(function_row.proowner),
        language_row.lanname,
        function_row.prokind,
        function_row.pronargs,
        function_row.pronargdefaults,
        function_row.proretset,
        function_row.proleakproof,
        function_row.procost,
        function_row.prorows,
        function_row.prosupport::oid,
        function_row.provariadic::oid,
        function_row.prosecdef,
        function_row.provolatile,
        function_row.proisstrict,
        function_row.proparallel,
        function_row.proconfig,
        function_row.probin,
        function_row.prosqlbody is null,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid),
        pg_catalog.pg_get_function_result(function_row.oid),
        pg_catalog.md5(
          pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
        ),
        function_row.proacl is null,
        (
          select coalesce(
            pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_array(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                acl_row.privilege_type,
                acl_row.is_grantable
              )
              order by
                pg_catalog.convert_to(
                  case
                    when acl_row.grantee = 0 then 'PUBLIC'
                    else pg_catalog.pg_get_userbyid(acl_row.grantee)
                  end,
                  'UTF8'
                ),
                pg_catalog.convert_to(
                  pg_catalog.pg_get_userbyid(acl_row.grantor),
                  'UTF8'
                ),
                pg_catalog.convert_to(acl_row.privilege_type, 'UTF8'),
                acl_row.is_grantable
            ),
            '[]'::jsonb
          )
          from pg_catalog.aclexplode(function_row.proacl) acl_row
        )
      ) as row_value
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where (
      function_namespace.nspname = 'auth'
      and function_row.proname = 'uid'
    ) or (
      function_namespace.nspname = 'public'
      and function_row.proname = 'is_admin'
    )
  ),
  policy_dependency_binding_rows as (
    select
      policy_row.polname,
      function_namespace.nspname as schema_name,
      function_row.proname,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)
        as identity_arguments,
      pg_catalog.jsonb_build_array(
        policy_row.polname,
        dependency_row.deptype,
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ) as row_value
    from pg_catalog.pg_policy policy_row
    join pg_catalog.pg_depend dependency_row
      on dependency_row.classid = 'pg_catalog.pg_policy'::regclass
     and dependency_row.objid = policy_row.oid
     and dependency_row.refclassid = 'pg_catalog.pg_proc'::regclass
    join pg_catalog.pg_proc function_row
      on function_row.oid = dependency_row.refobjid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where policy_row.polrelid = 'public.deposits'::regclass
  ),
  policy_dependency_fingerprint as (
    select pg_catalog.jsonb_build_object(
      'functions',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(schema_name, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8'),
              pg_catalog.convert_to(identity_arguments, 'UTF8')
          )
          from policy_dependency_function_rows
        ),
      'bindings',
        (
          select pg_catalog.jsonb_agg(
            row_value
            order by
              pg_catalog.convert_to(polname, 'UTF8'),
              pg_catalog.convert_to(schema_name, 'UTF8'),
              pg_catalog.convert_to(proname, 'UTF8'),
              pg_catalog.convert_to(identity_arguments, 'UTF8')
          )
          from policy_dependency_binding_rows
        )
    ) as value
  )
  select pg_catalog.md5(value::text)
    into v_policy_dependency_md5
  from policy_dependency_fingerprint;

  if v_policy_dependency_md5 is distinct from
    '58e8091e1a82038071e1067c709ca409'
  then
    raise exception 'inherited fiat deposit catalog changed during migration';
  end if;

  with deposit_status_enum as (
    select pg_catalog.jsonb_build_array(
      type_namespace.nspname,
      type_row.typname,
      pg_catalog.pg_get_userbyid(type_row.typowner),
      type_row.typtype,
      type_row.typcategory,
      type_row.typispreferred,
      type_row.typisdefined,
      type_row.typlen,
      type_row.typbyval,
      type_row.typalign,
      type_row.typstorage,
      type_row.typdelim,
      type_row.typnotnull,
      type_row.typbasetype = 0::oid,
      type_row.typtypmod,
      type_row.typndims,
      type_row.typcollation = 0::oid,
      type_row.typdefault is null,
      type_row.typdefaultbin is null,
      type_row.typacl is null,
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              acl_row.privilege_type,
              acl_row.is_grantable
            )
            order by
              pg_catalog.convert_to(
                case
                  when acl_row.grantee = 0 then 'PUBLIC'
                  else pg_catalog.pg_get_userbyid(acl_row.grantee)
                end,
                'UTF8'
              ),
              pg_catalog.convert_to(
                pg_catalog.pg_get_userbyid(acl_row.grantor),
                'UTF8'
              ),
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8'),
              acl_row.is_grantable
          ),
          '[]'::jsonb
        )
        from pg_catalog.aclexplode(type_row.typacl) acl_row
      ),
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_array(
              enum_value.enumlabel,
              enum_value.enum_ordinal
            )
            order by enum_value.enum_ordinal
          ),
          '[]'::jsonb
        )
        from (
          select
            enum_row.enumlabel::text,
            pg_catalog.row_number() over (
              order by enum_row.enumsortorder
            ) as enum_ordinal
          from pg_catalog.pg_enum enum_row
          where enum_row.enumtypid = type_row.oid
        ) enum_value
      )
    ) as row_value
    from pg_catalog.pg_attribute attribute_row
    join pg_catalog.pg_type type_row
      on type_row.oid = attribute_row.atttypid
    join pg_catalog.pg_namespace type_namespace
      on type_namespace.oid = type_row.typnamespace
    where attribute_row.attrelid = 'public.deposits'::regclass
      and attribute_row.attname = 'status'
      and attribute_row.attnum > 0
      and not attribute_row.attisdropped
  )
  select row_value
    into v_deposit_status_catalog
  from deposit_status_enum;

  if v_deposit_status_catalog is distinct from
    '[
      "public",
      "deposit_status",
      "postgres",
      "e",
      "E",
      false,
      true,
      4,
      true,
      "i",
      "p",
      ",",
      false,
      true,
      -1,
      0,
      true,
      true,
      true,
      true,
      [],
      [["pending", 1], ["approved", 2], ["rejected", 3]]
    ]'::jsonb
  then
    raise exception 'inherited fiat deposit catalog changed during migration';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'enforce_fiat_deposits_open'
  ) <> 1
    or v_function_oid is null
  then
    raise exception 'fiat deposit pause function was not created exactly once';
  end if;

  select
    pg_catalog.pg_get_userbyid(function_row.proowner) as owner_name,
    language_row.lanname as language_name,
    function_row.prokind,
    function_row.pronargs,
    function_row.pronargdefaults,
    function_row.proretset,
    function_row.proleakproof,
    function_row.procost,
    function_row.prorows,
    function_row.prosupport,
    function_row.prosecdef,
    function_row.provolatile,
    function_row.proisstrict,
    function_row.proparallel,
    function_row.proconfig,
    function_row.proacl,
    pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      as identity_arguments,
    pg_catalog.pg_get_function_result(function_row.oid) as result_type,
    pg_catalog.md5(
      pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
    ) as normalized_source_md5
    into strict v_function
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_language language_row
    on language_row.oid = function_row.prolang
  where function_row.oid = v_function_oid;

  if v_function.owner_name <> 'postgres'
    or v_function.language_name <> 'plpgsql'
    or v_function.prokind <> 'f'
    or v_function.pronargs <> 0
    or v_function.pronargdefaults <> 0
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
      array['search_path=pg_catalog, public']::text[]
    or v_function.identity_arguments <> ''
    or v_function.result_type <> 'trigger'
    or v_function.normalized_source_md5 <>
      '7b02423af9cfd598a0feaaf1e2b3188c'
  then
    raise exception 'unexpected fiat deposit pause function catalog';
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
      values (v_postgres, v_postgres, 'EXECUTE'::text, false)
    ),
    drift as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from drift
  )
  then
    raise exception 'unexpected fiat deposit pause function privileges';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_catalog.pg_namespace function_namespace
      on function_namespace.oid = function_row.pronamespace
    where trigger_row.tgrelid = 'public.deposits'::regclass
      and trigger_row.tgname = 'trg_deposits_require_open'
      and trigger_row.tgenabled = 'O'
      and not trigger_row.tgisinternal
      and trigger_row.tgtype = 7
      and trigger_row.tgnargs = 0
      and trigger_row.tgattr::text = ''
      and trigger_row.tgqual is null
      and function_namespace.nspname = 'public'
      and function_row.proname = 'enforce_fiat_deposits_open'
      and pg_catalog.pg_get_function_identity_arguments(function_row.oid) = ''
  ) <> 1
  then
    raise exception 'unexpected fiat deposit pause trigger catalog';
  end if;

  begin
    select setting.value
      into strict v_pause_value
    from public.app_settings setting
    where setting.key = 'deposits_paused'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'unexpected deposits_paused configuration after migration';
  end;

  if v_pause_value not in ('false', 'true') then
    raise exception 'unexpected deposits_paused configuration after migration';
  end if;
end;
$postflight$;
