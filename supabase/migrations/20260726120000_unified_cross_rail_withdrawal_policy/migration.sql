-- Enforce one withdrawal across ETB and USDT rails per user and rolling 24 hours.
-- Harden legacy withdrawal mutations behind the service-role-only request function.

do $preflight$
declare
  v_legacy_function regprocedure :=
    to_regprocedure(
      'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)'
    );
  v_usdt_function regprocedure :=
    to_regprocedure(
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)'
    );
  v_approve_function regprocedure :=
    to_regprocedure(
      'public.approve_withdrawal_tx(uuid,uuid,text)'
    );
  v_reject_function regprocedure :=
    to_regprocedure(
      'public.reject_withdrawal_tx(uuid,uuid,text)'
    );
  v_postgres oid := to_regrole('postgres');
  v_service_role oid := to_regrole('service_role');
  v_anon oid := to_regrole('anon');
  v_authenticated oid := to_regrole('authenticated');
begin
  if v_legacy_function is null
    or v_usdt_function is null
    or v_approve_function is null
    or v_reject_function is null
    or v_postgres is null
    or v_service_role is null
    or v_anon is null
    or v_authenticated is null
  then
    raise exception 'Unexpected unified withdrawal role or function catalog';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_row.pronamespace
  join pg_catalog.pg_language function_language
    on function_language.oid = function_row.prolang
  where function_row.oid = v_legacy_function
    and function_schema.nspname = 'public'
    and function_row.proname = 'request_withdrawal_tx'
    and function_row.prokind = 'f'
    and function_row.proowner = v_postgres
    and function_language.lanname = 'plpgsql'
    and function_row.prorettype = 'jsonb'::regtype
    and function_row.prosecdef
    and not function_row.proisstrict
    and not function_row.proleakproof
    and function_row.provolatile = 'v'
    and function_row.proparallel = 'u'
    and function_row.pronargs = 5
    and function_row.proargtypes[0] = 'uuid'::regtype
    and function_row.proargtypes[1] = 'numeric'::regtype
    and function_row.proargtypes[2] = 'public.payment_method_type'::regtype
    and function_row.proargtypes[3] = 'text'::regtype
    and function_row.proargtypes[4] = 'text'::regtype
    and function_row.proargnames = array[
      'p_user_id',
      'p_amount',
      'p_method',
      'p_account_name',
      'p_account_number'
    ]::text[]
    and function_row.proargmodes is null
    and function_row.proconfig = array['search_path=public']::text[]
    and pg_catalog.length(
      pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
    ) = 4095
    and pg_catalog.md5(
      pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
    ) = '464b7ef3fff3ff57eaeaec2c77f2b720';

  if not found then
    raise exception 'Unexpected legacy withdrawal request function catalog';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_legacy_function
    and function_row.proacl is not null
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_postgres
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1;

  if not found then
    raise exception 'Unexpected legacy withdrawal request function ACL';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_namespace function_schema
    on function_schema.oid = function_row.pronamespace
  join pg_catalog.pg_language function_language
    on function_language.oid = function_row.prolang
  where function_row.oid = v_usdt_function
    and function_schema.nspname = 'public'
    and function_row.proname = 'request_nowpayments_usdt_withdrawal'
    and function_row.prokind = 'f'
    and function_row.proowner = v_postgres
    and function_language.lanname = 'plpgsql'
    and function_row.prorettype = 'jsonb'::regtype
    and function_row.prosecdef
    and not function_row.proisstrict
    and not function_row.proleakproof
    and function_row.provolatile = 'v'
    and function_row.proparallel = 'u'
    and function_row.pronargs = 4
    and function_row.proargtypes[0] = 'uuid'::regtype
    and function_row.proargtypes[1] = 'text'::regtype
    and function_row.proargtypes[2] = 'text'::regtype
    and function_row.proargtypes[3] = 'text'::regtype
    and function_row.proargnames = array[
      'p_user_id',
      'p_request_id',
      'p_gross_amount_usdt',
      'p_destination_address'
    ]::text[]
    and function_row.proargmodes is null
    and function_row.proconfig = array['search_path=pg_catalog, public']::text[]
    and pg_catalog.length(function_row.prosrc) = 5721
    and pg_catalog.md5(function_row.prosrc) =
      '98e013f184aedfdabb061e31b43a9d65';

  if not found then
    raise exception 'Unexpected USDT withdrawal request function catalog';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_usdt_function
    and function_row.proacl is not null
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_postgres
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1;

  if not found then
    raise exception 'Unexpected USDT withdrawal request function ACL';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    join pg_catalog.pg_language function_language
      on function_language.oid = function_row.prolang
    where function_row.oid in (
      v_approve_function::oid,
      v_reject_function::oid
    )
      and function_schema.nspname = 'public'
      and function_row.proname in (
        'approve_withdrawal_tx',
        'reject_withdrawal_tx'
      )
      and function_row.prokind = 'f'
      and function_row.proowner = v_postgres
      and function_language.lanname = 'plpgsql'
      and function_row.prorettype = 'jsonb'::regtype
      and function_row.prosecdef
      and not function_row.proisstrict
      and not function_row.proleakproof
      and function_row.provolatile = 'v'
      and function_row.proparallel = 'u'
      and function_row.pronargs = 3
      and function_row.proargtypes[0] = 'uuid'::regtype
      and function_row.proargtypes[1] = 'uuid'::regtype
      and function_row.proargtypes[2] = 'text'::regtype
      and function_row.proargnames = array[
        'p_admin_id',
        'p_withdrawal_id',
        'p_admin_note'
      ]::text[]
      and function_row.proargmodes is null
      and function_row.proconfig = array['search_path=public']::text[]
      and (
        (
          function_row.oid = v_approve_function
          and pg_catalog.length(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = 1922
          and pg_catalog.md5(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = '04a0b13f13e3a1278ba37623a11cc0b5'
        )
        or (
          function_row.oid = v_reject_function
          and pg_catalog.length(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = 2476
          and pg_catalog.md5(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = '8e067be61c7376511ae1e661eec663a2'
        )
      )
  ) <> 2 then
    raise exception 'Unexpected legacy withdrawal review function catalog';
  end if;

  if exists (
    with actual as (
      select
        case
          when function_row.oid = v_approve_function then 'approve'
          else 'reject'
        end as function_tag,
        case
          when acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end as grantee,
        grantor_role.rolname as grantor,
        acl.privilege_type,
        acl.is_grantable
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(function_row.proacl) acl
      left join pg_catalog.pg_roles grantee_role
        on grantee_role.oid = acl.grantee
      join pg_catalog.pg_roles grantor_role
        on grantor_role.oid = acl.grantor
      where function_row.oid in (
        v_approve_function::oid,
        v_reject_function::oid
      )
    ),
    expected(function_tag, grantee, grantor, privilege_type, is_grantable) as (
      values
        ('approve'::text, 'postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('approve'::text, 'service_role'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('reject'::text, 'postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('reject'::text, 'service_role'::text, 'postgres'::text, 'EXECUTE'::text, false)
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unexpected legacy withdrawal review function ACL';
  end if;

  perform 1
  from pg_catalog.pg_class table_row
  join pg_catalog.pg_namespace table_schema
    on table_schema.oid = table_row.relnamespace
  where table_row.oid = 'public.withdrawals'::regclass
    and table_schema.nspname = 'public'
    and table_row.relname = 'withdrawals'
    and table_row.relkind = 'r'
    and table_row.relpersistence = 'p'
    and table_row.relowner = v_postgres
    and table_row.relrowsecurity
    and not table_row.relforcerowsecurity
    and table_row.relacl is not null;

  if not found then
    raise exception 'Unexpected legacy withdrawal table catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_attribute column_row
    where column_row.attrelid = 'public.withdrawals'::regclass
      and column_row.attnum > 0
      and not column_row.attisdropped
  ) <> 15
  or exists (
    with actual as (
      select
        column_row.attname::text as column_name,
        pg_catalog.format_type(
          column_row.atttypid,
          column_row.atttypmod
        ) as data_type,
        column_row.attnotnull as not_null,
        column_row.attidentity as identity_kind,
        column_row.attgenerated as generated_kind,
        column_row.attacl is null as no_column_acl
      from pg_catalog.pg_attribute column_row
      where column_row.attrelid = 'public.withdrawals'::regclass
        and column_row.attnum > 0
        and not column_row.attisdropped
    ),
    expected(
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      no_column_acl
    ) as (
      values
        ('id', 'uuid', true, ''::"char", ''::"char", true),
        ('user_id', 'uuid', true, ''::"char", ''::"char", true),
        ('amount', 'numeric(18,2)', true, ''::"char", ''::"char", true),
        ('method', 'payment_method_type', true, ''::"char", ''::"char", true),
        ('account_name', 'text', true, ''::"char", ''::"char", true),
        ('account_number', 'text', true, ''::"char", ''::"char", true),
        ('status', 'withdrawal_status', true, ''::"char", ''::"char", true),
        ('admin_note', 'text', false, ''::"char", ''::"char", true),
        ('reviewed_by', 'uuid', false, ''::"char", ''::"char", true),
        ('reviewed_at', 'timestamp with time zone', false, ''::"char", ''::"char", true),
        ('created_at', 'timestamp with time zone', true, ''::"char", ''::"char", true),
        ('updated_at', 'timestamp with time zone', true, ''::"char", ''::"char", true),
        ('fee_percent', 'numeric', true, ''::"char", ''::"char", true),
        ('fee_amount', 'numeric', true, ''::"char", ''::"char", true),
        ('net_amount', 'numeric', true, ''::"char", ''::"char", true)
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  )
  or exists (
    with actual as (
      select
        constraint_row.conname::text as constraint_name,
        constraint_row.contype as constraint_type,
        constraint_row.convalidated as validated,
        constraint_row.condeferrable as is_deferrable,
        constraint_row.condeferred as is_initially_deferred,
        pg_catalog.pg_get_constraintdef(
          constraint_row.oid,
          true
        ) as definition
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.withdrawals'::regclass
    ),
    expected(
      constraint_name,
      constraint_type,
      validated,
      is_deferrable,
      is_initially_deferred,
      definition
    ) as (
      values
        (
          'withdrawals_pkey',
          'p'::"char",
          true,
          false,
          false,
          'PRIMARY KEY (id)'
        ),
        (
          'withdrawals_reviewed_by_fkey',
          'f'::"char",
          true,
          false,
          false,
          'FOREIGN KEY (reviewed_by) REFERENCES profiles(id)'
        ),
        (
          'withdrawals_user_id_fkey',
          'f'::"char",
          true,
          false,
          false,
          'FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE'
        )
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  )
  or exists (
    with actual as (
      select
        column_row.attname::text as column_name,
        pg_catalog.pg_get_expr(
          default_row.adbin,
          default_row.adrelid
        ) as default_expression
      from pg_catalog.pg_attribute column_row
      join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
        and default_row.adnum = column_row.attnum
      where column_row.attrelid = 'public.withdrawals'::regclass
    ),
    expected(column_name, default_expression) as (
      values
        ('id', 'gen_random_uuid()'),
        ('status', '''pending''::withdrawal_status'),
        ('created_at', 'now()'),
        ('updated_at', 'now()'),
        ('fee_percent', '5'),
        ('fee_amount', '0'),
        ('net_amount', '0')
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  )
  or (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.withdrawals'::regclass
  ) <> 3
  or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.withdrawals'::regclass
      and constraint_row.conname = 'withdrawals_pkey'
      and constraint_row.contype = 'p'
      and constraint_row.convalidated
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.conkey = array[
        (
          select attnum
          from pg_catalog.pg_attribute
          where attrelid = 'public.withdrawals'::regclass
            and attname = 'id'
        )
      ]::smallint[]
  )
  or (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.withdrawals'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.profiles'::regclass
      and constraint_row.convalidated
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.confupdtype = 'a'
      and (
        (
          constraint_row.conname = 'withdrawals_user_id_fkey'
          and constraint_row.confdeltype = 'c'
          and constraint_row.conkey = array[
            (
              select attnum from pg_catalog.pg_attribute
              where attrelid = 'public.withdrawals'::regclass
                and attname = 'user_id'
            )
          ]::smallint[]
        )
        or (
          constraint_row.conname = 'withdrawals_reviewed_by_fkey'
          and constraint_row.confdeltype = 'a'
          and constraint_row.conkey = array[
            (
              select attnum from pg_catalog.pg_attribute
              where attrelid = 'public.withdrawals'::regclass
                and attname = 'reviewed_by'
            )
          ]::smallint[]
        )
      )
  ) <> 2
  or (
    select count(*)
    from pg_catalog.pg_index index_row
    where index_row.indrelid = 'public.withdrawals'::regclass
  ) <> 2
  or not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.withdrawals'::regclass
      and index_relation.relname = 'withdrawals_pkey'
      and index_row.indisprimary
      and index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indimmediate
      and index_row.indpred is null
      and index_row.indexprs is null
  )
  or exists (
    with actual as (
      select
        index_relation.relname::text as index_name,
        index_row.indisprimary as is_primary,
        index_row.indisunique as is_unique,
        index_row.indisvalid as is_valid,
        index_row.indisready as is_ready,
        index_row.indislive as is_live,
        index_row.indimmediate as is_immediate,
        pg_catalog.pg_get_indexdef(index_row.indexrelid) as definition,
        pg_catalog.pg_get_expr(
          index_row.indpred,
          index_row.indrelid
        ) as predicate
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      where index_row.indrelid = 'public.withdrawals'::regclass
    ),
    expected(
      index_name,
      is_primary,
      is_unique,
      is_valid,
      is_ready,
      is_live,
      is_immediate,
      definition,
      predicate
    ) as (
      values
        (
          'idx_withdrawals_user',
          false,
          false,
          true,
          true,
          true,
          true,
          'CREATE INDEX idx_withdrawals_user ON public.withdrawals USING btree (user_id)',
          null::text
        ),
        (
          'withdrawals_pkey',
          true,
          true,
          true,
          true,
          true,
          true,
          'CREATE UNIQUE INDEX withdrawals_pkey ON public.withdrawals USING btree (id)',
          null::text
        )
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  )
  or not exists (
    select 1
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.withdrawals'::regclass
      and index_relation.relname = 'idx_withdrawals_user'
      and not index_row.indisprimary
      and not index_row.indisunique
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indislive
      and index_row.indimmediate
      and index_row.indpred is null
      and index_row.indexprs is null
  )
  or (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.withdrawals'::regclass
  ) <> 5
  or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = 'public.withdrawals'::regclass
      and not trigger_row.tgisinternal
      and trigger_row.tgname = 'trg_withdrawals_updated_at'
      and trigger_row.tgenabled = 'O'
      and trigger_row.tgfoid =
        'public.update_updated_at_column()'::regprocedure
      and pg_catalog.pg_get_triggerdef(trigger_row.oid, true) =
        'CREATE TRIGGER trg_withdrawals_updated_at BEFORE UPDATE ON withdrawals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'
  )
  or (
    select count(*)
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_proc trigger_function
      on trigger_function.oid = trigger_row.tgfoid
    join pg_catalog.pg_constraint constraint_row
      on constraint_row.oid = trigger_row.tgconstraint
    where trigger_row.tgrelid = 'public.withdrawals'::regclass
      and trigger_row.tgisinternal
      and trigger_row.tgenabled = 'O'
      and constraint_row.conname in (
        'withdrawals_user_id_fkey',
        'withdrawals_reviewed_by_fkey'
      )
      and trigger_function.proname in (
        'RI_FKey_check_ins',
        'RI_FKey_check_upd'
      )
  ) <> 4
  or exists (
    with actual as (
      select
        constraint_row.conname::text as constraint_name,
        trigger_row.tgenabled as enabled_state,
        trigger_row.tgtype::integer as trigger_type,
        trigger_function.proname::text as function_name,
        case
          when trigger_row.tgconstrrelid = 0 then null
          else trigger_row.tgconstrrelid::regclass::text
        end as parent_relation
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc trigger_function
        on trigger_function.oid = trigger_row.tgfoid
      join pg_catalog.pg_constraint constraint_row
        on constraint_row.oid = trigger_row.tgconstraint
      where trigger_row.tgrelid = 'public.withdrawals'::regclass
        and trigger_row.tgisinternal
    ),
    expected(
      constraint_name,
      enabled_state,
      trigger_type,
      function_name,
      parent_relation
    ) as (
      values
        ('withdrawals_reviewed_by_fkey', 'O'::"char", 5, 'RI_FKey_check_ins', 'profiles'),
        ('withdrawals_reviewed_by_fkey', 'O'::"char", 17, 'RI_FKey_check_upd', 'profiles'),
        ('withdrawals_user_id_fkey', 'O'::"char", 5, 'RI_FKey_check_ins', 'profiles'),
        ('withdrawals_user_id_fkey', 'O'::"char", 17, 'RI_FKey_check_upd', 'profiles')
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  )
  then
    raise exception 'Unexpected legacy withdrawal structural catalog';
  end if;

  if exists (
    with actual as (
      select
        case
          when acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end as grantee,
        grantor_role.rolname as grantor,
        acl.privilege_type,
        acl.is_grantable
      from pg_catalog.pg_class table_row
      cross join lateral pg_catalog.aclexplode(table_row.relacl) acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
      join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
      where table_row.oid = 'public.withdrawals'::regclass
    ),
    expected as (
      select
        grantee,
        'postgres'::text as grantor,
        privilege_type,
        false as is_grantable
      from (
        values
          ('postgres'::text),
          ('service_role'::text),
          ('anon'::text),
          ('authenticated'::text)
      ) grantees(grantee)
      cross join (
        values
          ('DELETE'::text),
          ('INSERT'::text),
          ('MAINTAIN'::text),
          ('REFERENCES'::text),
          ('SELECT'::text),
          ('TRIGGER'::text),
          ('TRUNCATE'::text),
          ('UPDATE'::text)
      ) privileges(privilege_type)
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unexpected legacy withdrawal table ACL';
  end if;

  if exists (
    with actual as (
      select
        policy_row.polname,
        policy_row.polcmd,
        policy_row.polpermissive,
        policy_row.polroles::text as policy_roles,
        pg_catalog.pg_get_expr(
          policy_row.polqual,
          policy_row.polrelid
        ) as using_expression,
        pg_catalog.pg_get_expr(
          policy_row.polwithcheck,
          policy_row.polrelid
        ) as check_expression
      from pg_catalog.pg_policy policy_row
      where policy_row.polrelid = 'public.withdrawals'::regclass
    ),
    expected(
      polname,
      polcmd,
      polpermissive,
      policy_roles,
      using_expression,
      check_expression
    ) as (
      values
        (
          'withdrawals_insert_own'::name,
          'a'::"char",
          true,
          '{0}'::text,
          null::text,
          '(auth.uid() = user_id)'::text
        ),
        (
          'withdrawals_select_admin'::name,
          'r'::"char",
          true,
          '{0}'::text,
          'is_admin()'::text,
          null::text
        ),
        (
          'withdrawals_select_own'::name,
          'r'::"char",
          true,
          '{0}'::text,
          '(auth.uid() = user_id)'::text,
          null::text
        ),
        (
          'withdrawals_update_admin'::name,
          'w'::"char",
          true,
          '{0}'::text,
          'is_admin()'::text,
          null::text
        )
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unexpected legacy withdrawal policy catalog';
  end if;

  perform pg_catalog.set_config(
    'qhash.withdrawal_structural_catalog',
    pg_catalog.md5(
      (
        select pg_catalog.string_agg(
          column_row.attnum::text
            || ':' || column_row.attname
            || ':' || pg_catalog.format_type(
              column_row.atttypid,
              column_row.atttypmod
            )
            || ':' || column_row.attnotnull::text
            || ':' || column_row.attidentity::text
            || ':' || column_row.attgenerated::text
            || ':' || coalesce(column_row.attacl::text, '')
            || ':' || coalesce(
              pg_catalog.pg_get_expr(
                default_row.adbin,
                default_row.adrelid
              ),
              ''
            ),
          '|' order by column_row.attnum
        )
        from pg_catalog.pg_attribute column_row
        left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid = column_row.attrelid
          and default_row.adnum = column_row.attnum
        where column_row.attrelid = 'public.withdrawals'::regclass
          and column_row.attnum > 0
          and not column_row.attisdropped
      )
      || (
        select pg_catalog.string_agg(
          coalesce(constraint_row.conname, trigger_row.tgname)
            || ':' || trigger_row.tgisinternal::text
            || ':' || trigger_row.tgenabled::text
            || ':' || trigger_row.tgtype::text
            || ':' || trigger_function.proname
            || ':' || case
              when trigger_row.tgconstrrelid = 0 then ''
              else trigger_row.tgconstrrelid::regclass::text
            end,
          '|' order by
            coalesce(constraint_row.conname, trigger_row.tgname),
            trigger_function.proname,
            trigger_row.tgtype
        )
        from pg_catalog.pg_trigger trigger_row
        join pg_catalog.pg_proc trigger_function
          on trigger_function.oid = trigger_row.tgfoid
        left join pg_catalog.pg_constraint constraint_row
          on constraint_row.oid = trigger_row.tgconstraint
        where trigger_row.tgrelid = 'public.withdrawals'::regclass
      )
      || (
        select pg_catalog.string_agg(
          constraint_row.conname
            || ':' || constraint_row.contype::text
            || ':' || constraint_row.convalidated::text
            || ':' || constraint_row.condeferrable::text
            || ':' || constraint_row.condeferred::text
            || ':' || pg_catalog.pg_get_constraintdef(
              constraint_row.oid,
              true
            ),
          '|' order by constraint_row.conname
        )
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = 'public.withdrawals'::regclass
      )
      || (
        select pg_catalog.string_agg(
          index_relation.relname
            || ':' || index_row.indisprimary::text
            || ':' || index_row.indisunique::text
            || ':' || index_row.indisvalid::text
            || ':' || index_row.indisready::text
            || ':' || index_row.indislive::text
            || ':' || index_row.indimmediate::text
            || ':' || pg_catalog.pg_get_indexdef(index_row.indexrelid),
          '|' order by index_relation.relname
        )
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        where index_row.indrelid = 'public.withdrawals'::regclass
      )
    ),
    false
  );
end
$preflight$;

create or replace function public.request_withdrawal_tx(
  p_user_id uuid,
  p_amount numeric,
  p_method public.payment_method_type,
  p_account_name text,
  p_account_number text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $legacy_function$
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
  v_last_withdrawal_at timestamptz;
  v_next_allowed_at timestamptz;
  v_now timestamptz;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_account_name is null or pg_catalog.length(pg_catalog.btrim(p_account_name)) < 2 then
    raise exception 'invalid_account_name';
  end if;

  if p_account_number is null or pg_catalog.length(pg_catalog.btrim(p_account_number)) < 5 then
    raise exception 'invalid_account_number';
  end if;

  select profile_row.id, profile_row.is_frozen
    into v_profile
  from public.profiles profile_row
  where profile_row.id = p_user_id
  for update;

  if not found or v_profile.is_frozen = true then
    raise exception 'account_frozen_or_unavailable';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select setting_row.value::text
    into v_raw_setting
  from public.app_settings setting_row
  where setting_row.key = 'withdrawals_paused'
  limit 1;

  v_withdrawals_paused :=
    pg_catalog.lower(
      pg_catalog.btrim(coalesce(v_raw_setting, 'false'), '"')
    ) in ('true', '1', 'yes', 'on');

  if v_withdrawals_paused then
    raise exception 'withdrawals_paused';
  end if;

  select nullif(
      pg_catalog.btrim(setting_row.value::text, '"'),
      ''
    )::numeric
    into v_min_amount
  from public.app_settings setting_row
  where setting_row.key = 'min_withdrawal_amount'
  limit 1;

  v_min_amount := coalesce(v_min_amount, 200);

  select nullif(
      pg_catalog.btrim(setting_row.value::text, '"'),
      ''
    )::numeric
    into v_fee_percent
  from public.app_settings setting_row
  where setting_row.key = 'withdrawal_fee_percent'
  limit 1;

  v_fee_percent := coalesce(v_fee_percent, 5);

  if p_amount < v_min_amount then
    raise exception 'amount_below_minimum';
  end if;

  if v_fee_percent < 0 or v_fee_percent >= 100 then
    raise exception 'invalid_fee_percent';
  end if;

  if exists (
    select 1
    from public.withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
      and withdrawal_row.status::text = 'pending'
  ) or exists (
    select 1
    from public.nowpayments_usdt_withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
      and withdrawal_row.status in (
        'reserved',
        'reviewing',
        'send_locked',
        'broadcasted'
      )
  ) then
    raise exception 'withdrawal_already_open';
  end if;

  select max(accepted_request.requested_at)
    into v_last_withdrawal_at
  from (
    select withdrawal_row.created_at as requested_at
    from public.withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
    union all
    select withdrawal_row.created_at
    from public.nowpayments_usdt_withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
  ) accepted_request;

  if v_last_withdrawal_at is not null then
    v_next_allowed_at := v_last_withdrawal_at + interval '24 hours';
    if v_now < v_next_allowed_at then
      raise exception using
        errcode = 'P0001',
        message = 'withdrawal_cooldown_active',
        detail = 'next_allowed_at=' || pg_catalog.to_char(
          v_next_allowed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        );
    end if;
  end if;

  select wallet_row.user_id, wallet_row.balance
    into v_wallet
  from public.wallets wallet_row
  where wallet_row.user_id = p_user_id
  for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;

  if v_wallet.balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  v_fee_amount := pg_catalog.round((p_amount * v_fee_percent / 100)::numeric, 2);
  v_net_amount := pg_catalog.round((p_amount - v_fee_amount)::numeric, 2);

  if v_net_amount <= 0 then
    raise exception 'invalid_net_amount';
  end if;

  update public.wallets
  set balance = balance - p_amount,
      updated_at = v_now
  where user_id = p_user_id;

  insert into public.withdrawals (
    user_id,
    amount,
    method,
    account_name,
    account_number,
    status,
    fee_percent,
    fee_amount,
    net_amount,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    p_amount,
    p_method,
    pg_catalog.btrim(p_account_name),
    pg_catalog.btrim(p_account_number),
    'pending',
    v_fee_percent,
    v_fee_amount,
    v_net_amount,
    v_now,
    v_now
  )
  returning id into v_withdrawal_id;

  insert into public.transactions (
    user_id,
    type,
    amount,
    status,
    reference_id,
    balance_before,
    balance_after,
    created_at
  )
  values (
    p_user_id,
    'withdrawal',
    p_amount,
    'pending',
    v_withdrawal_id,
    v_wallet.balance,
    v_wallet.balance - p_amount,
    v_now
  );

  return pg_catalog.jsonb_build_object(
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
$legacy_function$;

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
as $usdt_function$
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
  v_last_withdrawal_at timestamptz;
  v_next_allowed_at timestamptz;
  v_now timestamptz;
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

  v_destination := pg_catalog.lower(pg_catalog.btrim(p_destination_address));
  if v_destination !~ '^0x[0-9a-f]{40}$' or v_gross < 2 then
    raise exception 'invalid_nowpayments_usdt_withdrawal_request';
  end if;
  v_payload := p_user_id::text || '|' || v_gross::text || '|' || v_destination;

  select profile_row.is_frozen, profile_row.is_admin
    into v_is_frozen, v_is_admin
  from public.profiles profile_row
  where profile_row.id = p_user_id
  for update;
  if not found or v_is_frozen or v_is_admin then
    raise exception 'nowpayments_usdt_withdrawal_user_ineligible';
  end if;

  v_now := pg_catalog.clock_timestamp();

  select *
    into v_withdrawal
  from public.nowpayments_usdt_withdrawals withdrawal_row
  where withdrawal_row.id = v_request_id
  for update;
  if found then
    select *
      into v_existing_event
    from public.nowpayments_usdt_withdrawal_events event_row
    where event_row.action_id = v_request_id
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

  select *
    into v_existing_event
  from public.nowpayments_usdt_withdrawal_events event_row
  where event_row.action_id = v_request_id
  for update;
  if found then
    raise exception 'nowpayments_usdt_action_id_conflict';
  end if;

  if exists (
    select 1
    from public.withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
      and withdrawal_row.status::text = 'pending'
  ) or exists (
    select 1
    from public.nowpayments_usdt_withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
      and withdrawal_row.status in (
        'reserved',
        'reviewing',
        'send_locked',
        'broadcasted'
      )
  ) then
    raise exception 'withdrawal_already_open';
  end if;

  select config_row.withdrawals_enabled
    into v_enabled
  from public.nowpayments_usdt_config config_row
  where config_row.id = 'USDT-BEP20'
  for share;
  if not found then
    raise exception 'nowpayments_usdt_configuration_missing';
  end if;

  if not v_enabled then
    raise exception 'nowpayments_usdt_withdrawals_disabled';
  end if;

  select max(accepted_request.requested_at)
    into v_last_withdrawal_at
  from (
    select withdrawal_row.created_at as requested_at
    from public.withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
    union all
    select withdrawal_row.created_at
    from public.nowpayments_usdt_withdrawals withdrawal_row
    where withdrawal_row.user_id = p_user_id
  ) accepted_request;

  if v_last_withdrawal_at is not null then
    v_next_allowed_at := v_last_withdrawal_at + interval '24 hours';
    if v_now < v_next_allowed_at then
      raise exception using
        errcode = 'P0001',
        message = 'withdrawal_cooldown_active',
        detail = 'next_allowed_at=' || pg_catalog.to_char(
          v_next_allowed_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        );
    end if;
  end if;

  v_destination :=
    public.assert_safe_nowpayments_usdt_withdrawal_destination(v_destination);

  select *
    into v_wallet
  from public.nowpayments_usdt_wallets wallet_row
  where wallet_row.user_id = p_user_id
  for update;
  if not found then
    raise exception 'nowpayments_usdt_wallet_not_found';
  end if;

  v_max := pg_catalog.trunc(v_wallet.available_balance_usdt, 6);
  if v_gross > v_max then
    raise exception 'insufficient_nowpayments_usdt_available_balance';
  end if;

  insert into public.nowpayments_usdt_withdrawals (
    id,
    user_id,
    destination_address,
    asset,
    network,
    provider_currency,
    gross_amount_usdt,
    fee_percent,
    status,
    requested_at,
    created_at,
    updated_at
  ) values (
    v_request_id,
    p_user_id,
    v_destination,
    'USDT',
    'BEP20',
    'usdtbsc',
    v_gross,
    5,
    'reserved',
    v_now,
    v_now,
    v_now
  )
  returning * into v_withdrawal;

  update public.nowpayments_usdt_wallets
  set available_balance_usdt = v_wallet.available_balance_usdt - v_gross,
      reserved_balance_usdt = v_wallet.reserved_balance_usdt + v_gross,
      updated_at = v_now
  where user_id = p_user_id;

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
    metadata,
    created_at
  ) values (
    p_user_id,
    'withdrawal_reserve',
    'USDT',
    -v_gross,
    v_gross,
    v_wallet.available_balance_usdt,
    v_wallet.available_balance_usdt - v_gross,
    v_wallet.reserved_balance_usdt,
    v_wallet.reserved_balance_usdt + v_gross,
    v_withdrawal.id,
    'Manual USDT-BEP20 withdrawal gross amount reserved',
    pg_catalog.jsonb_build_object(
      'gross_amount_usdt',
      v_withdrawal.gross_amount_usdt::text,
      'fee_amount_usdt',
      v_withdrawal.fee_amount_usdt::text,
      'net_amount_usdt',
      v_withdrawal.net_amount_usdt::text,
      'asset',
      'USDT',
      'network',
      'BEP20'
    ),
    v_now
  );

  v_result := pg_catalog.jsonb_build_object(
    'withdrawal_id',
    v_withdrawal.id,
    'status',
    'reserved',
    'destination_address',
    v_withdrawal.destination_address,
    'gross_amount_usdt',
    v_withdrawal.gross_amount_usdt::text,
    'fee_amount_usdt',
    v_withdrawal.fee_amount_usdt::text,
    'net_amount_usdt',
    v_withdrawal.net_amount_usdt::text,
    'available_balance_usdt',
    (v_wallet.available_balance_usdt - v_gross)::text,
    'reserved_balance_usdt',
    (v_wallet.reserved_balance_usdt + v_gross)::text
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
    result_snapshot,
    created_at
  ) values (
    v_withdrawal.id,
    p_user_id,
    p_user_id,
    v_request_id,
    'request',
    null,
    'reserved',
    v_payload,
    v_result,
    v_now
  );

  return v_result;
end;
$usdt_function$;

alter function public.request_withdrawal_tx(
  uuid,
  numeric,
  public.payment_method_type,
  text,
  text
) owner to postgres;

alter function public.request_nowpayments_usdt_withdrawal(
  uuid,
  text,
  text,
  text
) owner to postgres;

revoke all on function public.request_withdrawal_tx(
  uuid,
  numeric,
  public.payment_method_type,
  text,
  text
) from public, anon, authenticated, service_role, postgres;

revoke all on function public.request_nowpayments_usdt_withdrawal(
  uuid,
  text,
  text,
  text
) from public, anon, authenticated, service_role, postgres;

set role postgres;

grant execute on function public.request_withdrawal_tx(
  uuid,
  numeric,
  public.payment_method_type,
  text,
  text
) to postgres;

grant execute on function public.request_withdrawal_tx(
  uuid,
  numeric,
  public.payment_method_type,
  text,
  text
) to service_role;

grant execute on function public.request_nowpayments_usdt_withdrawal(
  uuid,
  text,
  text,
  text
) to postgres;

grant execute on function public.request_nowpayments_usdt_withdrawal(
  uuid,
  text,
  text,
  text
) to service_role;

revoke insert, update, delete, truncate, references, trigger, maintain
  on table public.withdrawals
  from public, anon, authenticated, service_role;

reset role;

drop policy withdrawals_insert_own on public.withdrawals;
drop policy withdrawals_update_admin on public.withdrawals;

do $postflight$
declare
  v_legacy_function regprocedure :=
    to_regprocedure(
      'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)'
    );
  v_usdt_function regprocedure :=
    to_regprocedure(
      'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)'
    );
  v_approve_function regprocedure :=
    to_regprocedure(
      'public.approve_withdrawal_tx(uuid,uuid,text)'
    );
  v_reject_function regprocedure :=
    to_regprocedure(
      'public.reject_withdrawal_tx(uuid,uuid,text)'
    );
  v_postgres oid := to_regrole('postgres');
  v_service_role oid := to_regrole('service_role');
begin
  perform 1
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_language function_language
    on function_language.oid = function_row.prolang
  where function_row.oid = v_legacy_function
    and function_row.proowner = v_postgres
    and function_language.lanname = 'plpgsql'
    and function_row.prorettype = 'jsonb'::regtype
    and function_row.prosecdef
    and not function_row.proisstrict
    and not function_row.proleakproof
    and function_row.provolatile = 'v'
    and function_row.proparallel = 'u'
    and function_row.proconfig =
      array['search_path=pg_catalog, public']::text[]
    and pg_catalog.length(function_row.prosrc) = 5418
    and pg_catalog.md5(function_row.prosrc) =
      '9d4dc0f67f197feae4dfd41e131bfa55'
    and pg_catalog.strpos(
      function_row.prosrc,
      'raise exception ''withdrawal_already_open'''
    ) > 0
    and pg_catalog.strpos(
      function_row.prosrc,
      'detail = ''next_allowed_at='' || pg_catalog.to_char('
    ) > 0;

  if not found then
    raise exception 'Unified legacy withdrawal function postflight failed';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_legacy_function
    and function_row.proacl is not null
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_postgres
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1;

  if not found then
    raise exception 'Unified legacy withdrawal function ACL postflight failed';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  join pg_catalog.pg_language function_language
    on function_language.oid = function_row.prolang
  where function_row.oid = v_usdt_function
    and function_row.proowner = v_postgres
    and function_language.lanname = 'plpgsql'
    and function_row.prorettype = 'jsonb'::regtype
    and function_row.prosecdef
    and not function_row.proisstrict
    and not function_row.proleakproof
    and function_row.provolatile = 'v'
    and function_row.proparallel = 'u'
    and function_row.proconfig =
      array['search_path=pg_catalog, public']::text[]
    and pg_catalog.length(function_row.prosrc) = 7483
    and pg_catalog.md5(function_row.prosrc) =
      '87ae544bfc8e771b1c772cb47f87ef18'
    and pg_catalog.strpos(
      function_row.prosrc,
      'return v_existing_event.result_snapshot;'
    ) > 0
    and pg_catalog.strpos(
      function_row.prosrc,
      'raise exception ''withdrawal_already_open'''
    ) > 0
    and pg_catalog.strpos(
      function_row.prosrc,
      'v_max := pg_catalog.trunc(v_wallet.available_balance_usdt, 6);'
    ) > 0;

  if not found then
    raise exception 'Unified USDT withdrawal function postflight failed';
  end if;

  perform 1
  from pg_catalog.pg_proc function_row
  where function_row.oid = v_usdt_function
    and function_row.proacl is not null
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
    ) = 2
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_postgres
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1
    and (
      select count(*)
      from pg_catalog.aclexplode(function_row.proacl) acl
      where acl.grantee = v_service_role
        and acl.grantor = v_postgres
        and acl.privilege_type = 'EXECUTE'
        and not acl.is_grantable
    ) = 1;

  if not found then
    raise exception 'Unified USDT withdrawal function ACL postflight failed';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    join pg_catalog.pg_language function_language
      on function_language.oid = function_row.prolang
    where function_row.oid in (
      v_approve_function::oid,
      v_reject_function::oid
    )
      and function_schema.nspname = 'public'
      and function_row.proname in (
        'approve_withdrawal_tx',
        'reject_withdrawal_tx'
      )
      and function_row.prokind = 'f'
      and function_row.proowner = v_postgres
      and function_language.lanname = 'plpgsql'
      and function_row.prorettype = 'jsonb'::regtype
      and function_row.prosecdef
      and not function_row.proisstrict
      and not function_row.proleakproof
      and function_row.provolatile = 'v'
      and function_row.proparallel = 'u'
      and function_row.pronargs = 3
      and function_row.proargtypes[0] = 'uuid'::regtype
      and function_row.proargtypes[1] = 'uuid'::regtype
      and function_row.proargtypes[2] = 'text'::regtype
      and function_row.proargnames = array[
        'p_admin_id',
        'p_withdrawal_id',
        'p_admin_note'
      ]::text[]
      and function_row.proargmodes is null
      and function_row.proconfig = array['search_path=public']::text[]
      and (
        (
          function_row.oid = v_approve_function
          and pg_catalog.length(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = 1922
          and pg_catalog.md5(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = '04a0b13f13e3a1278ba37623a11cc0b5'
        )
        or (
          function_row.oid = v_reject_function
          and pg_catalog.length(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = 2476
          and pg_catalog.md5(
            pg_catalog.replace(function_row.prosrc, E'\r\n', E'\n')
          ) = '8e067be61c7376511ae1e661eec663a2'
        )
      )
  ) <> 2 then
    raise exception 'Unified legacy withdrawal review function postflight failed';
  end if;

  if exists (
    with actual as (
      select
        case
          when function_row.oid = v_approve_function then 'approve'
          else 'reject'
        end as function_tag,
        case
          when acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end as grantee,
        grantor_role.rolname as grantor,
        acl.privilege_type,
        acl.is_grantable
      from pg_catalog.pg_proc function_row
      cross join lateral pg_catalog.aclexplode(function_row.proacl) acl
      left join pg_catalog.pg_roles grantee_role
        on grantee_role.oid = acl.grantee
      join pg_catalog.pg_roles grantor_role
        on grantor_role.oid = acl.grantor
      where function_row.oid in (
        v_approve_function::oid,
        v_reject_function::oid
      )
    ),
    expected(function_tag, grantee, grantor, privilege_type, is_grantable) as (
      values
        ('approve'::text, 'postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('approve'::text, 'service_role'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('reject'::text, 'postgres'::text, 'postgres'::text, 'EXECUTE'::text, false),
        ('reject'::text, 'service_role'::text, 'postgres'::text, 'EXECUTE'::text, false)
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unified legacy withdrawal review function ACL postflight failed';
  end if;

  perform 1
  from pg_catalog.pg_class table_row
  join pg_catalog.pg_namespace table_schema
    on table_schema.oid = table_row.relnamespace
  where table_row.oid = 'public.withdrawals'::regclass
    and table_schema.nspname = 'public'
    and table_row.relname = 'withdrawals'
    and table_row.relkind = 'r'
    and table_row.relpersistence = 'p'
    and table_row.relowner = v_postgres
    and table_row.relrowsecurity
    and not table_row.relforcerowsecurity
    and table_row.relacl is not null;

  if not found then
    raise exception 'Unified legacy withdrawal table catalog postflight failed';
  end if;

  if exists (
    with actual as (
      select
        case
          when acl.grantee = 0 then 'PUBLIC'
          else grantee_role.rolname
        end as grantee,
        grantor_role.rolname as grantor,
        acl.privilege_type,
        acl.is_grantable
      from pg_catalog.pg_class table_row
      cross join lateral pg_catalog.aclexplode(table_row.relacl) acl
      left join pg_catalog.pg_roles grantee_role
        on grantee_role.oid = acl.grantee
      join pg_catalog.pg_roles grantor_role
        on grantor_role.oid = acl.grantor
      where table_row.oid = 'public.withdrawals'::regclass
    ),
    expected as (
      select
        'postgres'::text as grantee,
        'postgres'::text as grantor,
        privilege_type,
        false as is_grantable
      from (
        values
          ('DELETE'::text),
          ('INSERT'::text),
          ('MAINTAIN'::text),
          ('REFERENCES'::text),
          ('SELECT'::text),
          ('TRIGGER'::text),
          ('TRUNCATE'::text),
          ('UPDATE'::text)
      ) privileges(privilege_type)
      union all
      select
        grantee,
        'postgres'::text,
        'SELECT'::text,
        false
      from (
        values
          ('service_role'::text),
          ('anon'::text),
          ('authenticated'::text)
      ) readers(grantee)
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unified legacy withdrawal table ACL postflight failed';
  end if;

  if exists (
    with actual as (
      select
        policy_row.polname,
        policy_row.polcmd,
        policy_row.polpermissive,
        policy_row.polroles::text as policy_roles,
        pg_catalog.pg_get_expr(
          policy_row.polqual,
          policy_row.polrelid
        ) as using_expression,
        pg_catalog.pg_get_expr(
          policy_row.polwithcheck,
          policy_row.polrelid
        ) as check_expression
      from pg_catalog.pg_policy policy_row
      where policy_row.polrelid = 'public.withdrawals'::regclass
    ),
    expected(
      polname,
      polcmd,
      polpermissive,
      policy_roles,
      using_expression,
      check_expression
    ) as (
      values
        (
          'withdrawals_select_admin'::name,
          'r'::"char",
          true,
          '{0}'::text,
          'is_admin()'::text,
          null::text
        ),
        (
          'withdrawals_select_own'::name,
          'r'::"char",
          true,
          '{0}'::text,
          '(auth.uid() = user_id)'::text,
          null::text
        )
    ),
    differences as (
      (select * from actual except all select * from expected)
      union all
      (select * from expected except all select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'Unified legacy withdrawal policy postflight failed';
  end if;

  if pg_catalog.md5(
    (
      select pg_catalog.string_agg(
        column_row.attnum::text
          || ':' || column_row.attname
          || ':' || pg_catalog.format_type(
            column_row.atttypid,
            column_row.atttypmod
          )
          || ':' || column_row.attnotnull::text
          || ':' || column_row.attidentity::text
          || ':' || column_row.attgenerated::text
          || ':' || coalesce(column_row.attacl::text, '')
          || ':' || coalesce(
            pg_catalog.pg_get_expr(
              default_row.adbin,
              default_row.adrelid
            ),
            ''
          ),
        '|' order by column_row.attnum
      )
      from pg_catalog.pg_attribute column_row
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = column_row.attrelid
        and default_row.adnum = column_row.attnum
      where column_row.attrelid = 'public.withdrawals'::regclass
        and column_row.attnum > 0
        and not column_row.attisdropped
    )
    || (
      select pg_catalog.string_agg(
        coalesce(constraint_row.conname, trigger_row.tgname)
          || ':' || trigger_row.tgisinternal::text
          || ':' || trigger_row.tgenabled::text
          || ':' || trigger_row.tgtype::text
          || ':' || trigger_function.proname
          || ':' || case
            when trigger_row.tgconstrrelid = 0 then ''
            else trigger_row.tgconstrrelid::regclass::text
          end,
        '|' order by
          coalesce(constraint_row.conname, trigger_row.tgname),
          trigger_function.proname,
          trigger_row.tgtype
      )
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc trigger_function
        on trigger_function.oid = trigger_row.tgfoid
      left join pg_catalog.pg_constraint constraint_row
        on constraint_row.oid = trigger_row.tgconstraint
      where trigger_row.tgrelid = 'public.withdrawals'::regclass
    )
    || (
      select pg_catalog.string_agg(
        constraint_row.conname
          || ':' || constraint_row.contype::text
          || ':' || constraint_row.convalidated::text
          || ':' || constraint_row.condeferrable::text
          || ':' || constraint_row.condeferred::text
          || ':' || pg_catalog.pg_get_constraintdef(
            constraint_row.oid,
            true
          ),
        '|' order by constraint_row.conname
      )
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = 'public.withdrawals'::regclass
    )
    || (
      select pg_catalog.string_agg(
        index_relation.relname
          || ':' || index_row.indisprimary::text
          || ':' || index_row.indisunique::text
          || ':' || index_row.indisvalid::text
          || ':' || index_row.indisready::text
          || ':' || index_row.indislive::text
          || ':' || index_row.indimmediate::text
        || ':' || pg_catalog.pg_get_indexdef(index_row.indexrelid),
        '|' order by index_relation.relname
      )
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      where index_row.indrelid = 'public.withdrawals'::regclass
    )
  ) is distinct from current_setting(
    'qhash.withdrawal_structural_catalog',
    true
  ) then
    raise exception 'Legacy withdrawal structural catalog changed during migration';
  end if;

  perform pg_catalog.set_config(
    'qhash.withdrawal_structural_catalog',
    '',
    false
  );
end
$postflight$;
