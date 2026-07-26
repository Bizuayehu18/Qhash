-- Make app_settings.deposits_paused the shared authoritative admission gate
-- for NOWPayments address lookup and provisioning. The migration runner owns
-- the transaction around this file.

do $preflight$
declare
  v_pause_value text;
  v_expected record;
  v_function record;
  v_acl jsonb;
begin
  if to_regclass('public.app_settings') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
  then
    raise exception 'unexpected NOWPayments global deposit-pause relation catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'app_settings'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
  ) <> 1
  then
    raise exception 'unexpected app_settings relation catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.app_settings'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        (
          attribute.attname in ('key', 'value')
          and attribute.atttypid = 'pg_catalog.text'::regtype
        )
        or (
          attribute.attname = 'updated_at'
          and attribute.atttypid = 'pg_catalog.timestamptz'::regtype
        )
      )
      and attribute.attnotnull
  ) <> 3
  then
    raise exception 'unexpected app_settings key/value catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.app_settings'::regclass
      and constraint_row.contype = 'p'
      and constraint_row.convalidated
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.conindid <> 0
      and exists (
        select 1
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        where index_row.indexrelid = constraint_row.conindid
          and index_row.indrelid = constraint_row.conrelid
          and index_row.indisprimary
          and index_row.indisunique
          and index_row.indimmediate
          and index_row.indisvalid
          and index_row.indisready
          and index_row.indislive
          and index_row.indnkeyatts = 1
          and index_row.indnatts = 1
          and index_row.indpred is null
          and index_row.indexprs is null
          and index_relation.relkind = 'i'
      )
      and (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['key']::text[]
  ) <> 1
  then
    raise exception 'unexpected app_settings primary-key catalog';
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

  if v_pause_value is distinct from 'true'
    and v_pause_value is distinct from 'false'
  then
    raise exception 'unexpected deposits_paused configuration';
  end if;

  for v_expected in
    select *
    from (
      values
        (
          'public.get_current_nowpayments_usdt_deposit_session(uuid)'::text,
          3041::integer,
          '08ad09e23e6926c201ad6317d2ea6a20'::text
        ),
        (
          'public.claim_nowpayments_usdt_deposit_session(uuid)'::text,
          5442::integer,
          '9d37c6aa3c15e38f0c12d514a69f5048'::text
        )
    ) expected(identity, source_length, source_md5)
  loop
    select
      procedure_row.oid,
      procedure_row.prokind,
      pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
      language_row.lanname as language_name,
      pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
      pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
      procedure_row.prosecdef,
      procedure_row.proleakproof,
      procedure_row.proisstrict,
      procedure_row.provolatile,
      procedure_row.proparallel,
      procedure_row.proconfig,
      procedure_row.proacl,
      length(procedure_row.prosrc) as source_length,
      pg_catalog.md5(procedure_row.prosrc) as source_md5
      into v_function
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure_row.prolang
    where procedure_row.oid = pg_catalog.to_regprocedure(v_expected.identity);

    if not found
      or v_function.prokind <> 'f'
      or v_function.owner_name <> 'postgres'
      or v_function.language_name <> 'plpgsql'
      or v_function.identity_arguments <> 'p_user_id uuid'
      or v_function.result_type <> 'jsonb'
      or not v_function.prosecdef
      or v_function.proleakproof
      or v_function.proisstrict
      or v_function.provolatile <> 'v'
      or v_function.proparallel <> 'u'
      or v_function.proconfig is distinct from array['search_path=pg_catalog, public']::text[]
      or v_function.proacl is null
      or v_function.source_length <> v_expected.source_length
      or v_function.source_md5 <> v_expected.source_md5
    then
      raise exception 'unexpected NOWPayments global deposit-pause function catalog: %',
        v_expected.identity;
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'grantee',
          case
            when exploded_acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(exploded_acl.grantee)
          end,
          'grantor', pg_catalog.pg_get_userbyid(exploded_acl.grantor),
          'privilege', exploded_acl.privilege_type,
          'grantable', exploded_acl.is_grantable
        )
        order by
          case
            when exploded_acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(exploded_acl.grantee)
          end,
          pg_catalog.pg_get_userbyid(exploded_acl.grantor),
          exploded_acl.privilege_type,
          exploded_acl.is_grantable
      ),
      '[]'::jsonb
    )
      into v_acl
    from pg_catalog.aclexplode(v_function.proacl) exploded_acl;

    if v_acl <> '[
      {"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},
      {"grantee":"service_role","grantor":"postgres","privilege":"EXECUTE","grantable":false}
    ]'::jsonb
    then
      raise exception 'unexpected NOWPayments global deposit-pause function ACL: %',
        v_expected.identity;
    end if;
  end loop;
end;
$preflight$;

create or replace function public.get_current_nowpayments_usdt_deposit_session(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deposits_paused text;
  v_enabled boolean;
  v_is_frozen boolean;
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_user_id is null then
    raise exception 'invalid_nowpayments_session_user';
  end if;

  select is_frozen into v_is_frozen
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  begin
    select setting.value
      into strict v_deposits_paused
    from public.app_settings setting
    where setting.key = 'deposits_paused'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_deposit_availability_unavailable';
  end;

  if v_deposits_paused = 'true' then
    raise exception 'nowpayments_deposits_paused';
  elsif v_deposits_paused is distinct from 'false' then
    raise exception 'nowpayments_deposit_availability_unavailable';
  end if;

  select enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';
  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is not null
  order by address_activated_at, created_at
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'activated',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  loop
    -- An original may become terminal before its qualifying settlement obtains
    -- the shared profile lock. Until the strict provider deadline, that
    -- terminal row remains non-replaceable just like any other pending state.
    select * into v_session
    from public.nowpayments_usdt_payments
    where user_id = p_user_id
      and address_activated_at is null
      and (
        session_status in ('provisioning', 'ready', 'manual_recovery')
        or (
          provider_valid_until is not null
          and provider_valid_until > clock_timestamp()
        )
      )
    order by created_at desc
    limit 1
    for update;

    if not found then
      return jsonb_build_object('disposition', 'none');
    end if;

    if v_session.session_status = 'provisioning'
      and v_session.provisioning_started_at <= now() - interval '5 minutes'
    then
      update public.nowpayments_usdt_payments
      set session_status = 'manual_recovery',
          manual_recovery_at = now(),
          manual_recovery_reason = 'stale_provisioning_claim',
          updated_at = now()
      where id = v_session.id
      returning * into v_session;
    end if;

    if v_session.session_status = 'ready'
      and v_session.provider_valid_until <= clock_timestamp()
    then
      update public.nowpayments_usdt_payments
      set provider_payment_status = 'expired',
          session_status = 'terminal',
          terminal_at = coalesce(terminal_at, now()),
          terminal_reason = 'provider_valid_until_elapsed',
          updated_at = now()
      where id = v_session.id;
      continue;
    end if;

    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', case when v_session.session_status = 'ready' then 'pending' else 'existing' end,
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end loop;
end;
$function$;

create or replace function public.claim_nowpayments_usdt_deposit_session(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deposits_paused text;
  v_enabled boolean;
  v_is_frozen boolean;
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_user_id is null then
    raise exception 'invalid_nowpayments_session_claim';
  end if;

  select is_frozen into v_is_frozen
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  begin
    select setting.value
      into strict v_deposits_paused
    from public.app_settings setting
    where setting.key = 'deposits_paused'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_deposit_availability_unavailable';
  end;

  if v_deposits_paused = 'true' then
    raise exception 'nowpayments_deposits_paused';
  elsif v_deposits_paused is distinct from 'false' then
    raise exception 'nowpayments_deposit_availability_unavailable';
  end if;

  select enabled into v_enabled
  from public.nowpayments_usdt_config
  where id = 'USDT-BEP20';
  if not found or not v_enabled then
    raise exception 'nowpayments_usdt_bep20_disabled';
  end if;

  -- The profile row lock serializes all claims for one user. Checking the
  -- permanent mapping after that lock prevents concurrent replacement calls.
  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is not null
  order by address_activated_at, created_at
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'activated',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  loop
    -- Terminal does not mean replaceable. A terminal original may still be
    -- waiting for qualifying settlement/activation, so every unactivated row
    -- with a strictly future provider deadline blocks a replacement.
    select * into v_session
    from public.nowpayments_usdt_payments
    where user_id = p_user_id
      and address_activated_at is null
      and (
        session_status in ('provisioning', 'ready', 'manual_recovery')
        or (
          provider_valid_until is not null
          and provider_valid_until > clock_timestamp()
        )
      )
    order by created_at desc
    limit 1
    for update;

    if not found then
      exit;
    end if;

    if v_session.session_status = 'provisioning'
      and v_session.provisioning_started_at <= now() - interval '5 minutes'
    then
      update public.nowpayments_usdt_payments
      set session_status = 'manual_recovery',
          manual_recovery_at = now(),
          manual_recovery_reason = 'stale_provisioning_claim',
          updated_at = now()
      where id = v_session.id
      returning * into v_session;
    end if;

    if v_session.session_status = 'ready'
      and v_session.provider_valid_until <= clock_timestamp()
    then
      update public.nowpayments_usdt_payments
      set provider_payment_status = 'expired',
          session_status = 'terminal',
          terminal_at = coalesce(terminal_at, now()),
          terminal_reason = 'provider_valid_until_elapsed',
          updated_at = now()
      where id = v_session.id;
      continue;
    else
      return to_jsonb(v_session) || jsonb_build_object(
        'disposition', case when v_session.session_status = 'ready' then 'pending' else 'existing' end,
        'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
        'provider_minimum_usdt', v_session.provider_minimum_usdt::text
      );
    end if;
  end loop;

  -- Settlement uses the same profile-row lock. Recheck permanent activation
  -- at the last possible point before inserting a replacement claim.
  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is not null
  order by address_activated_at, created_at
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', 'activated',
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  -- Defense in depth at the last possible point before insertion. This
  -- catches any non-replaceable unactivated row even if it appeared through a
  -- path that did not honor the shared profile lock.
  select * into v_session
  from public.nowpayments_usdt_payments
  where user_id = p_user_id
    and address_activated_at is null
    and (
      session_status in ('provisioning', 'manual_recovery')
      or (
        provider_valid_until is not null
        and provider_valid_until > clock_timestamp()
      )
    )
  order by created_at desc
  limit 1
  for update;

  if found then
    return to_jsonb(v_session) || jsonb_build_object(
      'disposition', case when v_session.session_status = 'ready' then 'pending' else 'existing' end,
      'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
      'provider_minimum_usdt', v_session.provider_minimum_usdt::text
    );
  end if;

  insert into public.nowpayments_usdt_payments (
    user_id, provider_payment_id, provider_payment_status,
    verification_status, asset, network, provider_currency,
    technical_reference_amount_usdt, provider_minimum_usdt,
    outcome_amount, outcome_currency, verified_at, session_status
  ) values (
    p_user_id, null, null,
    'pending', 'USDT', 'BEP20', 'usdtbsc',
    null, null,
    null, 'USDT', null, 'provisioning'
  )
  returning * into v_session;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'claimed',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

do $postflight$
declare
  v_pause_value text;
  v_expected record;
  v_function record;
  v_acl jsonb;
begin
  if (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'app_settings'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
  ) <> 1
  then
    raise exception 'unexpected app_settings relation catalog after migration';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.app_settings'::regclass
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        (
          attribute.attname in ('key', 'value')
          and attribute.atttypid = 'pg_catalog.text'::regtype
        )
        or (
          attribute.attname = 'updated_at'
          and attribute.atttypid = 'pg_catalog.timestamptz'::regtype
        )
      )
      and attribute.attnotnull
  ) <> 3
  then
    raise exception 'unexpected app_settings key/value catalog after migration';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = 'public.app_settings'::regclass
      and constraint_row.contype = 'p'
      and constraint_row.convalidated
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.conindid <> 0
      and exists (
        select 1
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid = index_row.indexrelid
        where index_row.indexrelid = constraint_row.conindid
          and index_row.indrelid = constraint_row.conrelid
          and index_row.indisprimary
          and index_row.indisunique
          and index_row.indimmediate
          and index_row.indisvalid
          and index_row.indisready
          and index_row.indislive
          and index_row.indnkeyatts = 1
          and index_row.indnatts = 1
          and index_row.indpred is null
          and index_row.indexprs is null
          and index_relation.relkind = 'i'
      )
      and (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.ordinality)
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality as key_column(attnum, ordinality)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ) = array['key']::text[]
  ) <> 1
  then
    raise exception 'unexpected app_settings primary-key catalog after migration';
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

  if v_pause_value is distinct from 'true'
    and v_pause_value is distinct from 'false'
  then
    raise exception 'unexpected deposits_paused configuration after migration';
  end if;

  for v_expected in
    select *
    from (
      values
        (
          'public.get_current_nowpayments_usdt_deposit_session(uuid)'::text,
          3601::integer,
          'b9568afb21d6ad474d47c3ccc21014b2'::text
        ),
        (
          'public.claim_nowpayments_usdt_deposit_session(uuid)'::text,
          5989::integer,
          'b091b06f04efc2c687571389f6f56b5b'::text
        )
    ) expected(identity, source_length, source_md5)
  loop
    select
      procedure_row.oid,
      procedure_row.prokind,
      pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner_name,
      language_row.lanname as language_name,
      pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) as identity_arguments,
      pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
      procedure_row.prosecdef,
      procedure_row.proleakproof,
      procedure_row.proisstrict,
      procedure_row.provolatile,
      procedure_row.proparallel,
      procedure_row.proconfig,
      procedure_row.proacl,
      length(procedure_row.prosrc) as source_length,
      pg_catalog.md5(procedure_row.prosrc) as source_md5
      into v_function
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure_row.prolang
    where procedure_row.oid = pg_catalog.to_regprocedure(v_expected.identity);

    if not found
      or v_function.prokind <> 'f'
      or v_function.owner_name <> 'postgres'
      or v_function.language_name <> 'plpgsql'
      or v_function.identity_arguments <> 'p_user_id uuid'
      or v_function.result_type <> 'jsonb'
      or not v_function.prosecdef
      or v_function.proleakproof
      or v_function.proisstrict
      or v_function.provolatile <> 'v'
      or v_function.proparallel <> 'u'
      or v_function.proconfig is distinct from array['search_path=pg_catalog, public']::text[]
      or v_function.proacl is null
      or v_function.source_length <> v_expected.source_length
      or v_function.source_md5 <> v_expected.source_md5
    then
      raise exception 'unexpected NOWPayments global deposit-pause function postflight: %',
        v_expected.identity;
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'grantee',
          case
            when exploded_acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(exploded_acl.grantee)
          end,
          'grantor', pg_catalog.pg_get_userbyid(exploded_acl.grantor),
          'privilege', exploded_acl.privilege_type,
          'grantable', exploded_acl.is_grantable
        )
        order by
          case
            when exploded_acl.grantee = 0 then 'PUBLIC'
            else pg_catalog.pg_get_userbyid(exploded_acl.grantee)
          end,
          pg_catalog.pg_get_userbyid(exploded_acl.grantor),
          exploded_acl.privilege_type,
          exploded_acl.is_grantable
      ),
      '[]'::jsonb
    )
      into v_acl
    from pg_catalog.aclexplode(v_function.proacl) exploded_acl;

    if v_acl <> '[
      {"grantee":"postgres","grantor":"postgres","privilege":"EXECUTE","grantable":false},
      {"grantee":"service_role","grantor":"postgres","privilege":"EXECUTE","grantable":false}
    ]'::jsonb
    then
      raise exception 'unexpected NOWPayments global deposit-pause function ACL after migration: %',
        v_expected.identity;
    end if;
  end loop;
end;
$postflight$;
