-- Establish the authoritative Fund PIN catalog and remove browser-role access.
-- This migration intentionally preserves all Fund PIN data and RPC contracts.

do $preflight$
declare
  v_row_count bigint;
  v_row_fingerprint text;
begin
  if (
    select count(*)
    from pg_class relation_row
    join pg_namespace relation_schema
      on relation_schema.oid = relation_row.relnamespace
    where relation_schema.nspname = 'public'
      and relation_row.relname = 'user_security_settings'
  ) <> 1
  or not exists (
    select 1
    from pg_class relation_row
    join pg_namespace relation_schema
      on relation_schema.oid = relation_row.relnamespace
    where relation_schema.nspname = 'public'
      and relation_row.relname = 'user_security_settings'
      and relation_row.relkind = 'r'
      and relation_row.relpersistence = 'p'
      and pg_get_userbyid(relation_row.relowner) = 'postgres'
      and relation_row.relrowsecurity is true
      and relation_row.relforcerowsecurity is false
  ) then
    raise exception 'unexpected Fund PIN settings table identity, owner, or RLS state';
  end if;

  if exists (
    with actual(
      column_position,
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression,
      column_acl
    ) as (
      select
        column_row.attnum::integer,
        column_row.attname::text,
        format_type(column_row.atttypid, column_row.atttypmod)::text,
        column_row.attnotnull,
        column_row.attidentity::text,
        column_row.attgenerated::text,
        pg_get_expr(default_row.adbin, default_row.adrelid),
        column_row.attacl::text
      from pg_attribute column_row
      join pg_class relation_row
        on relation_row.oid = column_row.attrelid
      join pg_namespace relation_schema
        on relation_schema.oid = relation_row.relnamespace
      left join pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
       and default_row.adnum = column_row.attnum
      where relation_schema.nspname = 'public'
        and relation_row.relname = 'user_security_settings'
        and column_row.attnum > 0
        and not column_row.attisdropped
    ),
    expected(
      column_position,
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression,
      column_acl
    ) as (
      values
        (1, 'user_id', 'uuid', true, '', '', null::text, null::text),
        (2, 'fund_password_hash', 'text', true, '', '', null::text, null::text),
        (3, 'fund_password_set_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (4, 'fund_password_updated_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (5, 'fund_password_failed_attempts', 'integer', true, '', '', '0', null::text),
        (6, 'fund_password_locked_until', 'timestamp with time zone', false, '', '', null::text, null::text),
        (7, 'created_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (8, 'updated_at', 'timestamp with time zone', true, '', '', 'now()', null::text)
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'unexpected Fund PIN settings column catalog';
  end if;

  if exists (
    with actual(
      constraint_name,
      constraint_type,
      definition,
      validated,
      is_deferrable,
      initially_deferred
    ) as (
      select
        constraint_row.conname::text,
        constraint_row.contype::text,
        pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.user_security_settings'::regclass
    ),
    expected(
      constraint_name,
      constraint_type,
      definition,
      validated,
      is_deferrable,
      initially_deferred
    ) as (
      values
        (
          'user_security_settings_fund_password_failed_attempts_check',
          'c',
          'CHECK (fund_password_failed_attempts >= 0)',
          true,
          false,
          false
        ),
        (
          'user_security_settings_pkey',
          'p',
          'PRIMARY KEY (user_id)',
          true,
          false,
          false
        ),
        (
          'user_security_settings_user_id_fkey',
          'f',
          'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
          true,
          false,
          false
        )
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'unexpected Fund PIN settings constraint catalog';
  end if;

  if exists (
    with actual(
      index_name,
      owner_name,
      is_unique,
      is_primary,
      is_valid,
      is_ready,
      is_live,
      definition
    ) as (
      select
        index_relation.relname::text,
        pg_get_userbyid(index_relation.relowner),
        index_row.indisunique,
        index_row.indisprimary,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indislive,
        pg_get_indexdef(index_row.indexrelid)
      from pg_index index_row
      join pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      where index_row.indrelid = 'public.user_security_settings'::regclass
    ),
    expected(
      index_name,
      owner_name,
      is_unique,
      is_primary,
      is_valid,
      is_ready,
      is_live,
      definition
    ) as (
      values (
        'user_security_settings_pkey',
        'postgres',
        true,
        true,
        true,
        true,
        true,
        'CREATE UNIQUE INDEX user_security_settings_pkey ON public.user_security_settings USING btree (user_id)'
      )
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'unexpected Fund PIN settings index catalog';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.user_security_settings'::regclass
      and not trigger_row.tgisinternal
  )
  or exists (
    with relevant_fk as (
      select
        constraint_row.oid,
        constraint_row.connamespace,
        constraint_row.conname,
        constraint_row.contype,
        constraint_row.convalidated,
        constraint_row.confmatchtype,
        constraint_row.confupdtype,
        constraint_row.confdeltype,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.conrelid,
        constraint_row.confrelid,
        constraint_row.conindid
      from pg_constraint constraint_row
      where constraint_row.contype = 'f'
        and (
          constraint_row.conrelid =
            'public.user_security_settings'::regclass
          or constraint_row.confrelid =
            'public.user_security_settings'::regclass
        )
    ),
    actual(
      constraint_schema,
      constraint_name,
      constraint_type,
      constraint_validated,
      match_type,
      update_action,
      delete_action,
      constraint_deferrable,
      constraint_initially_deferred,
      child_schema,
      child_relation,
      parent_schema,
      parent_relation,
      trigger_side,
      event_schema,
      event_relation,
      opposite_schema,
      opposite_relation,
      trigger_type,
      trigger_timing,
      trigger_action,
      trigger_level,
      function_schema,
      function_name,
      function_identity_arguments,
      function_result,
      function_language,
      is_internal,
      enabled_state,
      trigger_deferrable,
      trigger_initially_deferred,
      referenced_index_matches
    ) as (
      select
        constraint_schema.nspname::text,
        constraint_row.conname::text,
        constraint_row.contype::text,
        constraint_row.convalidated,
        constraint_row.confmatchtype::text,
        constraint_row.confupdtype::text,
        constraint_row.confdeltype::text,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        child_schema.nspname::text,
        child_relation.relname::text,
        parent_schema.nspname::text,
        parent_relation.relname::text,
        case
          when trigger_row.tgrelid = constraint_row.conrelid
            then 'child'
          when trigger_row.tgrelid = constraint_row.confrelid
            then 'parent'
          else 'other'
        end,
        event_schema.nspname::text,
        event_relation.relname::text,
        opposite_schema.nspname::text,
        opposite_relation.relname::text,
        trigger_row.tgtype::integer,
        case
          when (trigger_row.tgtype::integer & 64) <> 0
            then 'INSTEAD OF'
          when (trigger_row.tgtype::integer & 2) <> 0
            then 'BEFORE'
          else 'AFTER'
        end,
        case
          when (trigger_row.tgtype::integer & 4) <> 0 then 'INSERT'
          when (trigger_row.tgtype::integer & 8) <> 0 then 'DELETE'
          when (trigger_row.tgtype::integer & 16) <> 0 then 'UPDATE'
          when (trigger_row.tgtype::integer & 32) <> 0 then 'TRUNCATE'
          else 'UNKNOWN'
        end,
        case
          when (trigger_row.tgtype::integer & 1) <> 0
            then 'ROW'
          else 'STATEMENT'
        end,
        function_schema.nspname::text,
        function_row.proname::text,
        pg_get_function_identity_arguments(function_row.oid),
        pg_get_function_result(function_row.oid),
        function_language.lanname::text,
        trigger_row.tgisinternal,
        trigger_row.tgenabled::text,
        trigger_row.tgdeferrable,
        trigger_row.tginitdeferred,
        trigger_row.tgconstrindid = constraint_row.conindid
      from relevant_fk constraint_row
      join pg_namespace constraint_schema
        on constraint_schema.oid = constraint_row.connamespace
      join pg_class child_relation
        on child_relation.oid = constraint_row.conrelid
      join pg_namespace child_schema
        on child_schema.oid = child_relation.relnamespace
      join pg_class parent_relation
        on parent_relation.oid = constraint_row.confrelid
      join pg_namespace parent_schema
        on parent_schema.oid = parent_relation.relnamespace
      join pg_trigger trigger_row
        on trigger_row.tgconstraint = constraint_row.oid
      join pg_class event_relation
        on event_relation.oid = trigger_row.tgrelid
      join pg_namespace event_schema
        on event_schema.oid = event_relation.relnamespace
      left join pg_class opposite_relation
        on opposite_relation.oid = trigger_row.tgconstrrelid
      left join pg_namespace opposite_schema
        on opposite_schema.oid = opposite_relation.relnamespace
      join pg_proc function_row
        on function_row.oid = trigger_row.tgfoid
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
      join pg_language function_language
        on function_language.oid = function_row.prolang
    ),
    expected(
      constraint_schema,
      constraint_name,
      constraint_type,
      constraint_validated,
      match_type,
      update_action,
      delete_action,
      constraint_deferrable,
      constraint_initially_deferred,
      child_schema,
      child_relation,
      parent_schema,
      parent_relation,
      trigger_side,
      event_schema,
      event_relation,
      opposite_schema,
      opposite_relation,
      trigger_type,
      trigger_timing,
      trigger_action,
      trigger_level,
      function_schema,
      function_name,
      function_identity_arguments,
      function_result,
      function_language,
      is_internal,
      enabled_state,
      trigger_deferrable,
      trigger_initially_deferred,
      referenced_index_matches
    ) as (
      values
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'child', 'public', 'user_security_settings', 'auth', 'users',
          5, 'AFTER', 'INSERT', 'ROW',
          'pg_catalog', 'RI_FKey_check_ins', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'child', 'public', 'user_security_settings', 'auth', 'users',
          17, 'AFTER', 'UPDATE', 'ROW',
          'pg_catalog', 'RI_FKey_check_upd', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'parent', 'auth', 'users', 'public', 'user_security_settings',
          9, 'AFTER', 'DELETE', 'ROW',
          'pg_catalog', 'RI_FKey_cascade_del', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'parent', 'auth', 'users', 'public', 'user_security_settings',
          17, 'AFTER', 'UPDATE', 'ROW',
          'pg_catalog', 'RI_FKey_noaction_upd', '', 'trigger', 'internal',
          true, 'O', false, false, true
        )
    )
    select 1
    from (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    ) drift
  ) then
    raise exception 'unexpected Fund PIN settings trigger catalog';
  end if;

  if exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = 'public.user_security_settings'::regclass
  ) then
    raise exception 'unexpected Fund PIN settings RLS policy catalog';
  end if;

  if exists (
    with actual(grantee, grantor, privilege_type, is_grantable) as (
      select
        case
          when table_acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end,
        grantor_role.rolname,
        table_acl.privilege_type,
        table_acl.is_grantable
      from pg_class relation_row
      cross join lateral aclexplode(relation_row.relacl) table_acl
      left join pg_roles grantee_role
        on grantee_role.oid = table_acl.grantee
      join pg_roles grantor_role
        on grantor_role.oid = table_acl.grantor
      where relation_row.oid = 'public.user_security_settings'::regclass
    ),
    expected(grantee, grantor, privilege_type, is_grantable) as (
      values
        ('postgres', 'postgres', 'DELETE', false),
        ('postgres', 'postgres', 'INSERT', false),
        ('postgres', 'postgres', 'MAINTAIN', false),
        ('postgres', 'postgres', 'REFERENCES', false),
        ('postgres', 'postgres', 'SELECT', false),
        ('postgres', 'postgres', 'TRIGGER', false),
        ('postgres', 'postgres', 'TRUNCATE', false),
        ('postgres', 'postgres', 'UPDATE', false),
        ('service_role', 'postgres', 'DELETE', false),
        ('service_role', 'postgres', 'INSERT', false),
        ('service_role', 'postgres', 'MAINTAIN', false),
        ('service_role', 'postgres', 'REFERENCES', false),
        ('service_role', 'postgres', 'SELECT', false),
        ('service_role', 'postgres', 'TRIGGER', false),
        ('service_role', 'postgres', 'TRUNCATE', false),
        ('service_role', 'postgres', 'UPDATE', false)
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'unexpected Fund PIN settings table ACL catalog';
  end if;

  if to_regprocedure('extensions.crypt(text,text)') is null
    or to_regprocedure('extensions.gen_salt(text,integer)') is null
  then
    raise exception 'required qualified Fund PIN cryptography functions are unavailable';
  end if;

  if (
    select count(*)
    from pg_proc function_row
    join pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname in (
        'get_fund_password_status_tx',
        'set_fund_password_tx',
        'verify_fund_password_tx',
        'change_fund_password_tx',
        'reset_user_fund_password_tx'
      )
  ) <> 5 then
    raise exception 'unexpected Fund PIN function identity catalog';
  end if;

  if exists (
    with expected(
      function_name,
      identity_arguments,
      normalized_source_md5,
      expected_config,
      expected_acl
    ) as (
      values
        (
          'change_fund_password_tx',
          'p_user_id uuid, p_current_fund_password text, p_new_fund_password text',
          'bdae46497561c884ad743e5ec6ce3df9',
          array['search_path=public, extensions']::text[],
          'anon|postgres|EXECUTE|false,authenticated|postgres|EXECUTE|false,postgres|postgres|EXECUTE|false,service_role|postgres|EXECUTE|false'
        ),
        (
          'get_fund_password_status_tx',
          'p_user_id uuid',
          '64d0e24283129c0acc807fc1a666dda5',
          array['search_path=public, extensions']::text[],
          'anon|postgres|EXECUTE|false,authenticated|postgres|EXECUTE|false,postgres|postgres|EXECUTE|false,service_role|postgres|EXECUTE|false'
        ),
        (
          'reset_user_fund_password_tx',
          'p_admin_user_id uuid, p_target_user_id uuid, p_reason text',
          'eb3a0c386fb338315a3afccd813512be',
          array['search_path=public']::text[],
          'postgres|postgres|EXECUTE|false,service_role|postgres|EXECUTE|false'
        ),
        (
          'set_fund_password_tx',
          'p_user_id uuid, p_fund_password text',
          '4730ac5a15672f4cf0a486bafd6d227c',
          array['search_path=public, extensions']::text[],
          'anon|postgres|EXECUTE|false,authenticated|postgres|EXECUTE|false,postgres|postgres|EXECUTE|false,service_role|postgres|EXECUTE|false'
        ),
        (
          'verify_fund_password_tx',
          'p_user_id uuid, p_fund_password text',
          'f1284c079216050c37df5bf357ec4abb',
          array['search_path=public, extensions']::text[],
          'anon|postgres|EXECUTE|false,authenticated|postgres|EXECUTE|false,postgres|postgres|EXECUTE|false,service_role|postgres|EXECUTE|false'
        )
    ),
    actual as (
      select
        function_row.proname::text as function_name,
        pg_get_function_identity_arguments(function_row.oid) as identity_arguments,
        md5(replace(function_row.prosrc, E'\r\n', E'\n')) as normalized_source_md5,
        function_row.proconfig as actual_config,
        pg_get_userbyid(function_row.proowner) as owner_name,
        function_row.prokind,
        function_language.lanname as language_name,
        pg_get_function_result(function_row.oid) as result_type,
        function_row.prosecdef,
        function_row.proleakproof,
        function_row.provolatile,
        function_row.proisstrict,
        function_row.proparallel,
        (
          select string_agg(
            concat_ws(
              '|',
              case
                when function_acl.grantee = 0 then 'PUBLIC'
                else grantee_role.rolname
              end,
              grantor_role.rolname,
              function_acl.privilege_type,
              function_acl.is_grantable::text
            ),
            ','
            order by
              convert_to(
                case
                  when function_acl.grantee = 0 then 'PUBLIC'
                  else grantee_role.rolname
                end,
                'UTF8'
              ),
              convert_to(grantor_role.rolname, 'UTF8'),
              convert_to(function_acl.privilege_type, 'UTF8'),
              function_acl.is_grantable
          )
          from aclexplode(function_row.proacl) function_acl
          left join pg_roles grantee_role
            on grantee_role.oid = function_acl.grantee
          join pg_roles grantor_role
            on grantor_role.oid = function_acl.grantor
        ) as actual_acl
      from pg_proc function_row
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
      join pg_language function_language
        on function_language.oid = function_row.prolang
      where function_schema.nspname = 'public'
        and function_row.proname in (
          'get_fund_password_status_tx',
          'set_fund_password_tx',
          'verify_fund_password_tx',
          'change_fund_password_tx',
          'reset_user_fund_password_tx'
        )
    )
    select 1
    from expected
    left join actual
      on actual.function_name = expected.function_name
     and actual.identity_arguments = expected.identity_arguments
    where actual.function_name is null
      or actual.normalized_source_md5 <> expected.normalized_source_md5
      or actual.actual_config is distinct from expected.expected_config
      or actual.owner_name <> 'postgres'
      or actual.prokind <> 'f'
      or actual.language_name <> 'plpgsql'
      or actual.result_type <> 'jsonb'
      or actual.prosecdef is not true
      or actual.proleakproof is not false
      or actual.provolatile <> 'v'
      or actual.proisstrict is not false
      or actual.proparallel <> 'u'
      or actual.actual_acl is distinct from expected.expected_acl
  ) then
    raise exception 'unexpected Fund PIN function catalog';
  end if;

  select
    count(*),
    md5(coalesce(
      jsonb_agg(to_jsonb(settings_row) order by settings_row.user_id),
      '[]'::jsonb
    )::text)
  into v_row_count, v_row_fingerprint
  from public.user_security_settings settings_row;

  perform set_config(
    'qhash.fund_pin_preflight_row_count',
    v_row_count::text,
    false
  );
  perform set_config(
    'qhash.fund_pin_preflight_row_fingerprint',
    v_row_fingerprint,
    false
  );
end;
$preflight$;

create or replace function public.get_fund_password_status_tx(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.user_security_settings%rowtype;
begin
  select *
    into v_row
  from public.user_security_settings
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object(
      'success', true,
      'has_fund_password', false,
      'locked_until', null,
      'failed_attempts', 0
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'has_fund_password', true,
    'locked_until', v_row.fund_password_locked_until,
    'failed_attempts', v_row.fund_password_failed_attempts
  );
end;
$function$;

create or replace function public.set_fund_password_tx(
  p_user_id uuid,
  p_fund_password text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_exists boolean;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_user_id',
      'message', 'User is required.'
    );
  end if;

  if p_fund_password is null or p_fund_password !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'success', false,
      'code', 'invalid_fund_password',
      'message', 'Fund password must be exactly 4 digits.'
    );
  end if;

  select exists (
    select 1
    from public.user_security_settings
    where user_id = p_user_id
  )
    into v_exists;

  if v_exists then
    return jsonb_build_object(
      'success', false,
      'code', 'already_set',
      'message', 'Fund password is already set.'
    );
  end if;

  insert into public.user_security_settings (
    user_id,
    fund_password_hash,
    fund_password_set_at,
    fund_password_updated_at,
    fund_password_failed_attempts,
    fund_password_locked_until,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    extensions.crypt(
      p_fund_password,
      extensions.gen_salt('bf', 10)
    ),
    now(),
    now(),
    0,
    null,
    now(),
    now()
  );

  return jsonb_build_object(
    'success', true,
    'has_fund_password', true
  );
end;
$function$;

create or replace function public.verify_fund_password_tx(
  p_user_id uuid,
  p_fund_password text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_row public.user_security_settings%rowtype;
  v_new_attempts integer;
  v_locked_until timestamptz;
begin
  if p_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_user_id',
      'message', 'User is required.'
    );
  end if;

  select *
    into v_row
  from public.user_security_settings
  where user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'fund_password_not_set',
      'message', 'Please create your fund password first.'
    );
  end if;

  if v_row.fund_password_locked_until is not null
     and v_row.fund_password_locked_until > now() then
    return jsonb_build_object(
      'success', false,
      'code', 'fund_password_locked',
      'message', 'Fund password is temporarily locked. Please try again later.',
      'locked_until', v_row.fund_password_locked_until
    );
  end if;

  if p_fund_password is null
     or p_fund_password !~ '^[0-9]{4}$'
     or extensions.crypt(
       p_fund_password,
       v_row.fund_password_hash
     ) <> v_row.fund_password_hash then

    v_new_attempts := v_row.fund_password_failed_attempts + 1;

    if v_new_attempts >= 5 then
      v_locked_until := now() + interval '15 minutes';
    else
      v_locked_until := null;
    end if;

    update public.user_security_settings
    set
      fund_password_failed_attempts = v_new_attempts,
      fund_password_locked_until = v_locked_until,
      updated_at = now()
    where user_id = p_user_id;

    return jsonb_build_object(
      'success', false,
      'code', case
        when v_locked_until is not null then 'fund_password_locked'
        else 'incorrect_fund_password'
      end,
      'message', case
        when v_locked_until is not null
          then 'Too many incorrect attempts. Fund password is temporarily locked.'
        else 'Incorrect fund password.'
      end,
      'failed_attempts', v_new_attempts,
      'remaining_attempts', greatest(5 - v_new_attempts, 0),
      'locked_until', v_locked_until
    );
  end if;

  update public.user_security_settings
  set
    fund_password_failed_attempts = 0,
    fund_password_locked_until = null,
    updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'has_fund_password', true
  );
end;
$function$;

create or replace function public.change_fund_password_tx(
  p_user_id uuid,
  p_current_fund_password text,
  p_new_fund_password text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_verify_result jsonb;
begin
  if p_new_fund_password is null or p_new_fund_password !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'success', false,
      'code', 'invalid_new_fund_password',
      'message', 'New fund password must be exactly 4 digits.'
    );
  end if;

  v_verify_result := public.verify_fund_password_tx(
    p_user_id,
    p_current_fund_password
  );

  if coalesce((v_verify_result ->> 'success')::boolean, false) is not true then
    return v_verify_result;
  end if;

  update public.user_security_settings
  set
    fund_password_hash = extensions.crypt(
      p_new_fund_password,
      extensions.gen_salt('bf', 10)
    ),
    fund_password_updated_at = now(),
    fund_password_failed_attempts = 0,
    fund_password_locked_until = null,
    updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'success', true,
    'has_fund_password', true
  );
end;
$function$;

create or replace function public.reset_user_fund_password_tx(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_admin record;
  v_target record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_had_fund_password boolean := false;
begin
  if p_admin_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_admin_user_id',
      'message', 'Missing admin user.'
    );
  end if;

  if p_target_user_id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'missing_target_user_id',
      'message', 'Missing target user.'
    );
  end if;

  if p_admin_user_id = p_target_user_id then
    return jsonb_build_object(
      'success', false,
      'code', 'self_reset_not_allowed',
      'message', 'Admins cannot reset their own fund password from the admin panel.'
    );
  end if;

  if v_reason is null or length(v_reason) < 5 then
    return jsonb_build_object(
      'success', false,
      'code', 'reason_required',
      'message', 'Please enter a reset reason.'
    );
  end if;

  select id, is_admin, is_frozen
  into v_admin
  from public.profiles
  where id = p_admin_user_id;

  if not found
     or coalesce(v_admin.is_admin, false) is not true
     or coalesce(v_admin.is_frozen, false) is true then
    return jsonb_build_object(
      'success', false,
      'code', 'unauthorized_admin',
      'message', 'Unauthorized admin action.'
    );
  end if;

  select id, username, phone, is_admin, is_frozen
  into v_target
  from public.profiles
  where id = p_target_user_id;

  if not found then
    return jsonb_build_object(
      'success', false,
      'code', 'target_user_not_found',
      'message', 'Target user not found.'
    );
  end if;

  if coalesce(v_target.is_admin, false) is true then
    return jsonb_build_object(
      'success', false,
      'code', 'admin_target_not_allowed',
      'message', 'Admin account security resets are not allowed from this panel.'
    );
  end if;

  select exists (
    select 1
    from public.user_security_settings
    where user_id = p_target_user_id
  )
  into v_had_fund_password;

  delete from public.user_security_settings
  where user_id = p_target_user_id;

  insert into public.admin_security_reset_audit (
    admin_user_id,
    target_user_id,
    action,
    reason,
    old_had_fund_password,
    metadata
  )
  values (
    p_admin_user_id,
    p_target_user_id,
    'fund_password_reset',
    v_reason,
    v_had_fund_password,
    jsonb_build_object(
      'target_username', v_target.username,
      'target_phone_present', v_target.phone is not null
    )
  );

  return jsonb_build_object(
    'success', true,
    'code', 'fund_password_reset',
    'message', 'Fund password reset. The user must create a new fund password.',
    'old_had_fund_password', v_had_fund_password
  );
end;
$function$;

alter function public.get_fund_password_status_tx(uuid) owner to postgres;
alter function public.set_fund_password_tx(uuid, text) owner to postgres;
alter function public.verify_fund_password_tx(uuid, text) owner to postgres;
alter function public.change_fund_password_tx(uuid, text, text) owner to postgres;
alter function public.reset_user_fund_password_tx(uuid, uuid, text) owner to postgres;

revoke all on function public.get_fund_password_status_tx(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_fund_password_tx(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_fund_password_tx(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.change_fund_password_tx(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_user_fund_password_tx(uuid, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.get_fund_password_status_tx(uuid)
  to service_role;
grant execute on function public.set_fund_password_tx(uuid, text)
  to service_role;
grant execute on function public.verify_fund_password_tx(uuid, text)
  to service_role;
grant execute on function public.change_fund_password_tx(uuid, text, text)
  to service_role;
grant execute on function public.reset_user_fund_password_tx(uuid, uuid, text)
  to service_role;

do $postflight$
declare
  v_row_count bigint;
  v_row_fingerprint text;
begin
  if not exists (
    select 1
    from pg_class relation_row
    join pg_namespace relation_schema
      on relation_schema.oid = relation_row.relnamespace
    where relation_schema.nspname = 'public'
      and relation_row.relname = 'user_security_settings'
      and relation_row.relkind = 'r'
      and relation_row.relpersistence = 'p'
      and pg_get_userbyid(relation_row.relowner) = 'postgres'
      and relation_row.relrowsecurity is true
      and relation_row.relforcerowsecurity is false
  )
  or exists (
    select 1
    from pg_policy policy_row
    where policy_row.polrelid = 'public.user_security_settings'::regclass
  ) then
    raise exception 'Fund PIN settings table postflight failed';
  end if;

  if exists (
    with actual(
      column_position,
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression,
      column_acl
    ) as (
      select
        column_row.attnum::integer,
        column_row.attname::text,
        format_type(column_row.atttypid, column_row.atttypmod)::text,
        column_row.attnotnull,
        column_row.attidentity::text,
        column_row.attgenerated::text,
        pg_get_expr(default_row.adbin, default_row.adrelid),
        column_row.attacl::text
      from pg_attribute column_row
      left join pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
       and default_row.adnum = column_row.attnum
      where column_row.attrelid = 'public.user_security_settings'::regclass
        and column_row.attnum > 0
        and not column_row.attisdropped
    ),
    expected(
      column_position,
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression,
      column_acl
    ) as (
      values
        (1, 'user_id', 'uuid', true, '', '', null::text, null::text),
        (2, 'fund_password_hash', 'text', true, '', '', null::text, null::text),
        (3, 'fund_password_set_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (4, 'fund_password_updated_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (5, 'fund_password_failed_attempts', 'integer', true, '', '', '0', null::text),
        (6, 'fund_password_locked_until', 'timestamp with time zone', false, '', '', null::text, null::text),
        (7, 'created_at', 'timestamp with time zone', true, '', '', 'now()', null::text),
        (8, 'updated_at', 'timestamp with time zone', true, '', '', 'now()', null::text)
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN settings column postflight failed';
  end if;

  if exists (
    with actual(
      constraint_name,
      constraint_type,
      definition,
      validated,
      is_deferrable,
      initially_deferred
    ) as (
      select
        constraint_row.conname::text,
        constraint_row.contype::text,
        pg_get_constraintdef(constraint_row.oid, true),
        constraint_row.convalidated,
        constraint_row.condeferrable,
        constraint_row.condeferred
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.user_security_settings'::regclass
    ),
    expected(
      constraint_name,
      constraint_type,
      definition,
      validated,
      is_deferrable,
      initially_deferred
    ) as (
      values
        (
          'user_security_settings_fund_password_failed_attempts_check',
          'c',
          'CHECK (fund_password_failed_attempts >= 0)',
          true,
          false,
          false
        ),
        (
          'user_security_settings_pkey',
          'p',
          'PRIMARY KEY (user_id)',
          true,
          false,
          false
        ),
        (
          'user_security_settings_user_id_fkey',
          'f',
          'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
          true,
          false,
          false
        )
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN settings constraint postflight failed';
  end if;

  if exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.user_security_settings'::regclass
      and not trigger_row.tgisinternal
  )
  or exists (
    with relevant_fk as (
      select
        constraint_row.oid,
        constraint_row.connamespace,
        constraint_row.conname,
        constraint_row.contype,
        constraint_row.convalidated,
        constraint_row.confmatchtype,
        constraint_row.confupdtype,
        constraint_row.confdeltype,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.conrelid,
        constraint_row.confrelid,
        constraint_row.conindid
      from pg_constraint constraint_row
      where constraint_row.contype = 'f'
        and (
          constraint_row.conrelid =
            'public.user_security_settings'::regclass
          or constraint_row.confrelid =
            'public.user_security_settings'::regclass
        )
    ),
    actual(
      constraint_schema,
      constraint_name,
      constraint_type,
      constraint_validated,
      match_type,
      update_action,
      delete_action,
      constraint_deferrable,
      constraint_initially_deferred,
      child_schema,
      child_relation,
      parent_schema,
      parent_relation,
      trigger_side,
      event_schema,
      event_relation,
      opposite_schema,
      opposite_relation,
      trigger_type,
      trigger_timing,
      trigger_action,
      trigger_level,
      function_schema,
      function_name,
      function_identity_arguments,
      function_result,
      function_language,
      is_internal,
      enabled_state,
      trigger_deferrable,
      trigger_initially_deferred,
      referenced_index_matches
    ) as (
      select
        constraint_schema.nspname::text,
        constraint_row.conname::text,
        constraint_row.contype::text,
        constraint_row.convalidated,
        constraint_row.confmatchtype::text,
        constraint_row.confupdtype::text,
        constraint_row.confdeltype::text,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        child_schema.nspname::text,
        child_relation.relname::text,
        parent_schema.nspname::text,
        parent_relation.relname::text,
        case
          when trigger_row.tgrelid = constraint_row.conrelid
            then 'child'
          when trigger_row.tgrelid = constraint_row.confrelid
            then 'parent'
          else 'other'
        end,
        event_schema.nspname::text,
        event_relation.relname::text,
        opposite_schema.nspname::text,
        opposite_relation.relname::text,
        trigger_row.tgtype::integer,
        case
          when (trigger_row.tgtype::integer & 64) <> 0
            then 'INSTEAD OF'
          when (trigger_row.tgtype::integer & 2) <> 0
            then 'BEFORE'
          else 'AFTER'
        end,
        case
          when (trigger_row.tgtype::integer & 4) <> 0 then 'INSERT'
          when (trigger_row.tgtype::integer & 8) <> 0 then 'DELETE'
          when (trigger_row.tgtype::integer & 16) <> 0 then 'UPDATE'
          when (trigger_row.tgtype::integer & 32) <> 0 then 'TRUNCATE'
          else 'UNKNOWN'
        end,
        case
          when (trigger_row.tgtype::integer & 1) <> 0
            then 'ROW'
          else 'STATEMENT'
        end,
        function_schema.nspname::text,
        function_row.proname::text,
        pg_get_function_identity_arguments(function_row.oid),
        pg_get_function_result(function_row.oid),
        function_language.lanname::text,
        trigger_row.tgisinternal,
        trigger_row.tgenabled::text,
        trigger_row.tgdeferrable,
        trigger_row.tginitdeferred,
        trigger_row.tgconstrindid = constraint_row.conindid
      from relevant_fk constraint_row
      join pg_namespace constraint_schema
        on constraint_schema.oid = constraint_row.connamespace
      join pg_class child_relation
        on child_relation.oid = constraint_row.conrelid
      join pg_namespace child_schema
        on child_schema.oid = child_relation.relnamespace
      join pg_class parent_relation
        on parent_relation.oid = constraint_row.confrelid
      join pg_namespace parent_schema
        on parent_schema.oid = parent_relation.relnamespace
      join pg_trigger trigger_row
        on trigger_row.tgconstraint = constraint_row.oid
      join pg_class event_relation
        on event_relation.oid = trigger_row.tgrelid
      join pg_namespace event_schema
        on event_schema.oid = event_relation.relnamespace
      left join pg_class opposite_relation
        on opposite_relation.oid = trigger_row.tgconstrrelid
      left join pg_namespace opposite_schema
        on opposite_schema.oid = opposite_relation.relnamespace
      join pg_proc function_row
        on function_row.oid = trigger_row.tgfoid
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
      join pg_language function_language
        on function_language.oid = function_row.prolang
    ),
    expected(
      constraint_schema,
      constraint_name,
      constraint_type,
      constraint_validated,
      match_type,
      update_action,
      delete_action,
      constraint_deferrable,
      constraint_initially_deferred,
      child_schema,
      child_relation,
      parent_schema,
      parent_relation,
      trigger_side,
      event_schema,
      event_relation,
      opposite_schema,
      opposite_relation,
      trigger_type,
      trigger_timing,
      trigger_action,
      trigger_level,
      function_schema,
      function_name,
      function_identity_arguments,
      function_result,
      function_language,
      is_internal,
      enabled_state,
      trigger_deferrable,
      trigger_initially_deferred,
      referenced_index_matches
    ) as (
      values
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'child', 'public', 'user_security_settings', 'auth', 'users',
          5, 'AFTER', 'INSERT', 'ROW',
          'pg_catalog', 'RI_FKey_check_ins', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'child', 'public', 'user_security_settings', 'auth', 'users',
          17, 'AFTER', 'UPDATE', 'ROW',
          'pg_catalog', 'RI_FKey_check_upd', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'parent', 'auth', 'users', 'public', 'user_security_settings',
          9, 'AFTER', 'DELETE', 'ROW',
          'pg_catalog', 'RI_FKey_cascade_del', '', 'trigger', 'internal',
          true, 'O', false, false, true
        ),
        (
          'public', 'user_security_settings_user_id_fkey', 'f', true,
          's', 'a', 'c', false, false,
          'public', 'user_security_settings', 'auth', 'users',
          'parent', 'auth', 'users', 'public', 'user_security_settings',
          17, 'AFTER', 'UPDATE', 'ROW',
          'pg_catalog', 'RI_FKey_noaction_upd', '', 'trigger', 'internal',
          true, 'O', false, false, true
        )
    )
    select 1
    from (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    ) drift
  ) then
    raise exception 'Fund PIN settings trigger postflight failed';
  end if;

  if exists (
    with actual(
      index_name,
      owner_name,
      is_unique,
      is_primary,
      is_valid,
      is_ready,
      is_live,
      definition
    ) as (
      select
        index_relation.relname::text,
        pg_get_userbyid(index_relation.relowner),
        index_row.indisunique,
        index_row.indisprimary,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indislive,
        pg_get_indexdef(index_row.indexrelid)
      from pg_index index_row
      join pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      where index_row.indrelid = 'public.user_security_settings'::regclass
    ),
    expected(
      index_name,
      owner_name,
      is_unique,
      is_primary,
      is_valid,
      is_ready,
      is_live,
      definition
    ) as (
      values (
        'user_security_settings_pkey',
        'postgres',
        true,
        true,
        true,
        true,
        true,
        'CREATE UNIQUE INDEX user_security_settings_pkey ON public.user_security_settings USING btree (user_id)'
      )
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN settings index postflight failed';
  end if;

  if exists (
    with actual(grantee, grantor, privilege_type, is_grantable) as (
      select
        case
          when table_acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end,
        grantor_role.rolname,
        table_acl.privilege_type,
        table_acl.is_grantable
      from pg_class relation_row
      cross join lateral aclexplode(relation_row.relacl) table_acl
      left join pg_roles grantee_role
        on grantee_role.oid = table_acl.grantee
      join pg_roles grantor_role
        on grantor_role.oid = table_acl.grantor
      where relation_row.oid = 'public.user_security_settings'::regclass
    ),
    expected(grantee, grantor, privilege_type, is_grantable) as (
      values
        ('postgres', 'postgres', 'DELETE', false),
        ('postgres', 'postgres', 'INSERT', false),
        ('postgres', 'postgres', 'MAINTAIN', false),
        ('postgres', 'postgres', 'REFERENCES', false),
        ('postgres', 'postgres', 'SELECT', false),
        ('postgres', 'postgres', 'TRIGGER', false),
        ('postgres', 'postgres', 'TRUNCATE', false),
        ('postgres', 'postgres', 'UPDATE', false),
        ('service_role', 'postgres', 'DELETE', false),
        ('service_role', 'postgres', 'INSERT', false),
        ('service_role', 'postgres', 'MAINTAIN', false),
        ('service_role', 'postgres', 'REFERENCES', false),
        ('service_role', 'postgres', 'SELECT', false),
        ('service_role', 'postgres', 'TRIGGER', false),
        ('service_role', 'postgres', 'TRUNCATE', false),
        ('service_role', 'postgres', 'UPDATE', false)
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN settings table ACL postflight failed';
  end if;

  if (
    select count(*)
    from pg_proc function_row
    join pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname in (
        'get_fund_password_status_tx',
        'set_fund_password_tx',
        'verify_fund_password_tx',
        'change_fund_password_tx',
        'reset_user_fund_password_tx'
      )
  ) <> 5 then
    raise exception 'Fund PIN function identity postflight failed';
  end if;

  if exists (
    with expected(
      function_name,
      identity_arguments,
      normalized_source_md5
    ) as (
      values
        (
          'change_fund_password_tx',
          'p_user_id uuid, p_current_fund_password text, p_new_fund_password text',
          'c2d59ac5dab978561ac8622ffd793359'
        ),
        (
          'get_fund_password_status_tx',
          'p_user_id uuid',
          '64d0e24283129c0acc807fc1a666dda5'
        ),
        (
          'reset_user_fund_password_tx',
          'p_admin_user_id uuid, p_target_user_id uuid, p_reason text',
          'eb3a0c386fb338315a3afccd813512be'
        ),
        (
          'set_fund_password_tx',
          'p_user_id uuid, p_fund_password text',
          '0b9369d732f80fbc5514e3977dd3558c'
        ),
        (
          'verify_fund_password_tx',
          'p_user_id uuid, p_fund_password text',
          '6025e7a8d99655576ab1c625fb4568bb'
        )
    ),
    actual as (
      select
        function_row.proname::text as function_name,
        pg_get_function_identity_arguments(function_row.oid) as identity_arguments,
        md5(replace(function_row.prosrc, E'\r\n', E'\n')) as normalized_source_md5
      from pg_proc function_row
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
      where function_schema.nspname = 'public'
        and function_row.proname in (
          'get_fund_password_status_tx',
          'set_fund_password_tx',
          'verify_fund_password_tx',
          'change_fund_password_tx',
          'reset_user_fund_password_tx'
        )
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN function definition postflight failed';
  end if;

  if exists (
    select 1
    from pg_proc function_row
    join pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    join pg_language function_language
      on function_language.oid = function_row.prolang
    where function_schema.nspname = 'public'
      and function_row.proname in (
        'get_fund_password_status_tx',
        'set_fund_password_tx',
        'verify_fund_password_tx',
        'change_fund_password_tx',
        'reset_user_fund_password_tx'
      )
      and (
        pg_get_userbyid(function_row.proowner) <> 'postgres'
        or function_row.prokind <> 'f'
        or function_language.lanname <> 'plpgsql'
        or pg_get_function_result(function_row.oid) <> 'jsonb'
        or function_row.prosecdef is not true
        or function_row.proleakproof is not false
        or function_row.provolatile <> 'v'
        or function_row.proisstrict is not false
        or function_row.proparallel <> 'u'
        or function_row.proconfig is distinct from
          array['search_path=pg_catalog, public']::text[]
      )
  ) then
    raise exception 'Fund PIN function security postflight failed';
  end if;

  if exists (
    with target_functions(function_oid) as (
      values
        ('public.get_fund_password_status_tx(uuid)'::regprocedure::oid),
        ('public.set_fund_password_tx(uuid,text)'::regprocedure::oid),
        ('public.verify_fund_password_tx(uuid,text)'::regprocedure::oid),
        ('public.change_fund_password_tx(uuid,text,text)'::regprocedure::oid),
        ('public.reset_user_fund_password_tx(uuid,uuid,text)'::regprocedure::oid)
    ),
    actual(function_oid, grantee, grantor, privilege_type, is_grantable) as (
      select
        target_functions.function_oid,
        case
          when function_acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end,
        grantor_role.rolname,
        function_acl.privilege_type,
        function_acl.is_grantable
      from target_functions
      join pg_proc function_row
        on function_row.oid = target_functions.function_oid
      cross join lateral aclexplode(function_row.proacl) function_acl
      left join pg_roles grantee_role
        on grantee_role.oid = function_acl.grantee
      join pg_roles grantor_role
        on grantor_role.oid = function_acl.grantor
    ),
    expected(function_oid, grantee, grantor, privilege_type, is_grantable) as (
      select
        target_functions.function_oid,
        expected_acl.grantee,
        'postgres',
        'EXECUTE',
        false
      from target_functions
      cross join (
        values ('postgres'), ('service_role')
      ) expected_acl(grantee)
    )
    (select * from actual except select * from expected)
    union all
    (select * from expected except select * from actual)
  ) then
    raise exception 'Fund PIN function ACL postflight failed';
  end if;

  select
    count(*),
    md5(coalesce(
      jsonb_agg(to_jsonb(settings_row) order by settings_row.user_id),
      '[]'::jsonb
    )::text)
  into v_row_count, v_row_fingerprint
  from public.user_security_settings settings_row;

  if v_row_count::text is distinct from
      current_setting('qhash.fund_pin_preflight_row_count', true)
    or v_row_fingerprint is distinct from
      current_setting('qhash.fund_pin_preflight_row_fingerprint', true)
  then
    raise exception 'Fund PIN data changed during catalog migration';
  end if;

  perform set_config('qhash.fund_pin_preflight_row_count', '', false);
  perform set_config('qhash.fund_pin_preflight_row_fingerprint', '', false);
end;
$postflight$;
