-- Make app_settings.deposits_paused the shared authoritative admission gate
-- for NOWPayments address lookup and provisioning. The migration runner owns
-- the transaction around this file.

do $preflight$
declare
  v_pause_value text;
  v_enabled boolean;
  v_expected record;
  v_function record;
  v_acl jsonb;
  v_catalog jsonb;
begin
  if to_regclass('public.app_settings') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_provider_payments') is null
  then
    raise exception 'unexpected NOWPayments global deposit-pause relation catalog';
  end if;

  if to_regprocedure(
    'public.get_nowpayments_usdt_deposit_overview_snapshot(uuid)'
  ) is not null
  then
    raise exception 'unexpected existing NOWPayments deposit overview snapshot function';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.profiles'::regclass
    and attribute.attname = 'is_frozen'
    and not attribute.attisdropped;

  if v_catalog is distinct from
    '[[6,"is_frozen","boolean",true,"false","","",true]]'::jsonb
  then
    raise exception 'unexpected profiles is_frozen catalog';
  end if;

  select pg_catalog.jsonb_build_array(
    pg_catalog.pg_get_userbyid(relation.relowner),
    relation.relkind,
    relation.relpersistence,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  )
    into v_catalog
  from pg_catalog.pg_class relation
  where relation.oid = 'public.app_settings'::regclass;

  if v_catalog is distinct from '["postgres","r","p",true,false]'::jsonb then
    raise exception 'unexpected app_settings relation catalog';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.app_settings'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_catalog is distinct from '[
    [1,"key","text",true,null,"","",true],
    [2,"value","text",true,null,"","",true],
    [3,"updated_at","timestamp with time zone",true,"now()","","",true]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings column catalog';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    constraint_row.conname,
    constraint_row.contype,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    constraint_row.conindid::regclass::text
  ) order by constraint_row.conname)
    into v_catalog
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.app_settings'::regclass;

  if v_catalog is distinct from
    '[["app_settings_pkey","p","PRIMARY KEY (key)",true,false,false,"app_settings_pkey"]]'::jsonb
  then
    raise exception 'unexpected app_settings constraint catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.app_settings'::regclass
      and index_relation.relname = 'app_settings_pkey'
      and index_relation.relkind = 'i'
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
      and pg_catalog.pg_get_indexdef(index_row.indexrelid)
        = 'CREATE UNIQUE INDEX app_settings_pkey ON public.app_settings USING btree (key)'
  ) <> 1
    or (
      select count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = 'public.app_settings'::regclass
    ) <> 1
  then
    raise exception 'unexpected app_settings index catalog';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    policy_row.polname,
    policy_row.polpermissive,
    policy_row.polcmd,
    (
      select pg_catalog.jsonb_agg(
        case when role_oid = 0 then 'PUBLIC'
             else pg_catalog.pg_get_userbyid(role_oid) end
        order by
          case when role_oid = 0 then 'PUBLIC'
               else pg_catalog.pg_get_userbyid(role_oid) end
      )
      from pg_catalog.unnest(policy_row.polroles) role_oid
    ),
    pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
    pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
  ) order by policy_row.polname), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_policy policy_row
  where policy_row.polrelid = 'public.app_settings'::regclass;

  if v_catalog is distinct from '[
    ["app_settings_insert_admin",true,"a",["PUBLIC"],null,"is_admin()"],
    ["app_settings_select",true,"r",["PUBLIC"],"(auth.uid() IS NOT NULL)",null],
    ["app_settings_update_admin",true,"w",["PUBLIC"],"is_admin()",null]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings policy catalog: %', v_catalog;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ) order by
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) acl_row
  where relation.oid = 'public.app_settings'::regclass;

  if v_catalog is distinct from '[
    ["anon","postgres","DELETE",false],
    ["anon","postgres","INSERT",false],
    ["anon","postgres","MAINTAIN",false],
    ["anon","postgres","REFERENCES",false],
    ["anon","postgres","SELECT",false],
    ["anon","postgres","TRIGGER",false],
    ["anon","postgres","TRUNCATE",false],
    ["anon","postgres","UPDATE",false],
    ["authenticated","postgres","DELETE",false],
    ["authenticated","postgres","INSERT",false],
    ["authenticated","postgres","MAINTAIN",false],
    ["authenticated","postgres","REFERENCES",false],
    ["authenticated","postgres","SELECT",false],
    ["authenticated","postgres","TRIGGER",false],
    ["authenticated","postgres","TRUNCATE",false],
    ["authenticated","postgres","UPDATE",false],
    ["postgres","postgres","DELETE",false],
    ["postgres","postgres","INSERT",false],
    ["postgres","postgres","MAINTAIN",false],
    ["postgres","postgres","REFERENCES",false],
    ["postgres","postgres","SELECT",false],
    ["postgres","postgres","TRIGGER",false],
    ["postgres","postgres","TRUNCATE",false],
    ["postgres","postgres","UPDATE",false],
    ["service_role","postgres","DELETE",false],
    ["service_role","postgres","INSERT",false],
    ["service_role","postgres","MAINTAIN",false],
    ["service_role","postgres","REFERENCES",false],
    ["service_role","postgres","SELECT",false],
    ["service_role","postgres","TRIGGER",false],
    ["service_role","postgres","TRUNCATE",false],
    ["service_role","postgres","UPDATE",false]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings table ACL catalog';
  end if;

  select pg_catalog.jsonb_build_array(
    pg_catalog.pg_get_userbyid(relation.relowner),
    relation.relkind,
    relation.relpersistence,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  )
    into v_catalog
  from pg_catalog.pg_class relation
  where relation.oid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '["postgres","r","p",true,false]'::jsonb then
    raise exception 'unexpected NOWPayments configuration relation catalog';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.nowpayments_usdt_config'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_catalog is distinct from '[
    [1,"id","text",true,"''USDT-BEP20''::text","","",true],
    [2,"enabled","boolean",true,"false","","",true],
    [3,"asset","text",true,"''USDT''::text","","",true],
    [4,"network","text",true,"''BEP20''::text","","",true],
    [5,"provider_currency","text",true,"''usdtbsc''::text","","",true],
    [6,"deposit_minimum_usdt","numeric(36,6)",true,"1","","",true],
    [7,"withdrawal_minimum_usdt","numeric(36,6)",true,"2","","",true],
    [8,"withdrawal_fee_percent","numeric(7,4)",true,"5","","",true],
    [9,"created_at","timestamp with time zone",true,"now()","","",true],
    [10,"updated_at","timestamp with time zone",true,"now()","","",true],
    [11,"withdrawals_enabled","boolean",true,"false","","",true]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration column catalog';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    constraint_row.conname,
    constraint_row.contype,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    case when constraint_row.conindid = 0 then null
         else constraint_row.conindid::regclass::text end
  ) order by constraint_row.conname)
    into v_catalog
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '[
    ["nowpayments_usdt_config_asset_check","c","CHECK (asset = ''USDT''::text)",true,false,false,null],
    ["nowpayments_usdt_config_deposit_minimum_check","c","CHECK (deposit_minimum_usdt = 1::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_network_check","c","CHECK (network = ''BEP20''::text)",true,false,false,null],
    ["nowpayments_usdt_config_pkey","p","PRIMARY KEY (id)",true,false,false,"nowpayments_usdt_config_pkey"],
    ["nowpayments_usdt_config_provider_currency_check","c","CHECK (provider_currency = ''usdtbsc''::text)",true,false,false,null],
    ["nowpayments_usdt_config_singleton_check","c","CHECK (id = ''USDT-BEP20''::text)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawal_fee_check","c","CHECK (withdrawal_fee_percent = 5::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawal_minimum_check","c","CHECK (withdrawal_minimum_usdt = 2::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawals_enabled_default_check","c","CHECK (withdrawals_enabled = ANY (ARRAY[true, false]))",true,false,false,null]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration constraint catalog';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.nowpayments_usdt_config'::regclass
      and index_relation.relname = 'nowpayments_usdt_config_pkey'
      and index_relation.relkind = 'i'
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
      and pg_catalog.pg_get_indexdef(index_row.indexrelid)
        = 'CREATE UNIQUE INDEX nowpayments_usdt_config_pkey ON public.nowpayments_usdt_config USING btree (id)'
  ) <> 1
    or (
      select count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = 'public.nowpayments_usdt_config'::regclass
    ) <> 1
    or exists (
      select 1
      from pg_catalog.pg_policy policy_row
      where policy_row.polrelid = 'public.nowpayments_usdt_config'::regclass
    )
  then
    raise exception 'unexpected NOWPayments configuration index or policy catalog';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ) order by
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) acl_row
  where relation.oid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '[
    ["postgres","postgres","DELETE",false],
    ["postgres","postgres","INSERT",false],
    ["postgres","postgres","MAINTAIN",false],
    ["postgres","postgres","REFERENCES",false],
    ["postgres","postgres","SELECT",false],
    ["postgres","postgres","TRIGGER",false],
    ["postgres","postgres","TRUNCATE",false],
    ["postgres","postgres","UPDATE",false],
    ["service_role","postgres","SELECT",false]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration table ACL catalog';
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

  if v_pause_value is distinct from 'false' then
    raise exception 'unexpected deposits_paused configuration';
  end if;

  if (select count(*) from public.nowpayments_usdt_config) <> 1 then
    raise exception 'unexpected NOWPayments configuration singleton';
  end if;

  begin
    select config.enabled
      into strict v_enabled
    from public.nowpayments_usdt_config config
    where config.id = 'USDT-BEP20'
      and config.asset = 'USDT'
      and config.network = 'BEP20'
      and config.provider_currency = 'usdtbsc'
      and config.deposit_minimum_usdt = 1
      and config.withdrawal_minimum_usdt = 2
      and config.withdrawal_fee_percent = 5
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'unexpected NOWPayments configuration singleton';
  end;

  if v_enabled is distinct from true then
    raise exception 'unexpected NOWPayments configuration singleton';
  end if;

  for v_expected in
    select *
    from (
      values
        (
          'public.get_current_nowpayments_usdt_deposit_session(uuid)'::text,
          'p_user_id uuid'::text,
          3041::integer,
          '08ad09e23e6926c201ad6317d2ea6a20'::text
        ),
        (
          'public.claim_nowpayments_usdt_deposit_session(uuid)'::text,
          'p_user_id uuid'::text,
          5442::integer,
          '9d37c6aa3c15e38f0c12d514a69f5048'::text
        ),
        (
          'public.configure_nowpayments_usdt_deposit_session_amounts(uuid,uuid,uuid,text,text)'::text,
          'p_user_id uuid, p_session_id uuid, p_qhash_order_id uuid, p_provider_minimum_usdt text, p_technical_reference_amount_usdt text'::text,
          3443::integer,
          'c6217178fe2be957b0cdd328b9409bba'::text
        )
    ) expected(identity, identity_arguments, source_length, source_md5)
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
      or v_function.identity_arguments <> v_expected.identity_arguments
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

-- The live catalog historically exposed app_settings through broad client
-- table grants and permissive PUBLIC policies. All current runtime consumers
-- are server-owned. Preserve the service-role read and support-settings upsert
-- boundary while removing direct browser access and every client mutation path.
drop policy app_settings_insert_admin on public.app_settings;
drop policy app_settings_select on public.app_settings;
drop policy app_settings_update_admin on public.app_settings;
create policy app_settings_service_role_select
  on public.app_settings
  for select
  to service_role
  using (true);

revoke all on table public.app_settings
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.app_settings to service_role;

create function public.get_nowpayments_usdt_deposit_overview_snapshot(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_deposits_paused text;
  v_is_frozen boolean;
  v_config public.nowpayments_usdt_config%rowtype;
  v_feature_enabled boolean;
  v_wallet jsonb;
  v_sessions jsonb;
  v_provider_payments jsonb;
begin
  if p_user_id is null then
    raise exception 'invalid_nowpayments_session_user';
  end if;

  begin
    select profile.is_frozen
      into strict v_is_frozen
    from public.profiles profile
    where profile.id = p_user_id
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_session_user_unavailable';
  end;

  if v_is_frozen is distinct from false then
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

  if v_deposits_paused is distinct from 'true'
    and v_deposits_paused is distinct from 'false'
  then
    raise exception 'nowpayments_deposit_availability_unavailable';
  end if;

  begin
    select config.*
      into strict v_config
    from public.nowpayments_usdt_config config
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_deposit_availability_unavailable';
  end;

  if v_config.id is distinct from 'USDT-BEP20'
    or v_config.asset is distinct from 'USDT'
    or v_config.network is distinct from 'BEP20'
    or v_config.provider_currency is distinct from 'usdtbsc'
    or v_config.deposit_minimum_usdt is distinct from 1::numeric
    or v_config.withdrawal_minimum_usdt is distinct from 2::numeric
    or v_config.withdrawal_fee_percent is distinct from 5::numeric
    or v_config.enabled is null
  then
    raise exception 'nowpayments_deposit_availability_unavailable';
  end if;

  v_feature_enabled :=
    v_deposits_paused = 'false'
    and v_config.enabled = true;

  begin
    select pg_catalog.jsonb_build_object(
      'user_id', wallet.user_id,
      'asset', wallet.asset,
      'available_balance_usdt', wallet.available_balance_usdt::text,
      'reserved_balance_usdt', wallet.reserved_balance_usdt::text
    )
      into strict v_wallet
    from public.nowpayments_usdt_wallets wallet
    where wallet.user_id = p_user_id;
  exception
    when no_data_found then
      v_wallet := null;
    when too_many_rows then
      raise exception 'nowpayments_deposit_overview_unavailable';
  end;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', session.id,
        'user_id', session.user_id,
        'provider_payment_id', session.provider_payment_id,
        'provider_payment_status', session.provider_payment_status,
        'session_status', session.session_status,
        'pay_address', case
          when v_feature_enabled then session.pay_address
          else null
        end,
        'technical_reference_amount_usdt',
          session.technical_reference_amount_usdt::text,
        'provider_minimum_usdt', session.provider_minimum_usdt::text,
        'provider_created_at', session.provider_created_at,
        'provider_valid_until', session.provider_valid_until,
        'address_activated_at', session.address_activated_at,
        'terminal_at', session.terminal_at,
        'credited_amount_usdt', session.credited_amount_usdt::text,
        'credited_at', session.credited_at,
        'created_at', session.created_at
      )
      order by session.created_at desc
    ),
    '[]'::jsonb
  )
    into v_sessions
  from (
    select payment.*
    from public.nowpayments_usdt_payments payment
    where payment.user_id = p_user_id
    order by payment.created_at desc
    limit 250
  ) session;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'session_id', provider_payment.session_id,
        'user_id', provider_payment.user_id,
        'provider_payment_id', provider_payment.provider_payment_id,
        'payment_kind', provider_payment.payment_kind,
        'provider_payment_status',
          provider_payment.provider_payment_status,
        'credited_amount_usdt',
          provider_payment.credited_amount_usdt::text,
        'credited_at', provider_payment.credited_at,
        'created_at', provider_payment.created_at
      )
      order by provider_payment.created_at desc
    ),
    '[]'::jsonb
  )
    into v_provider_payments
  from (
    select payment.*
    from public.nowpayments_usdt_provider_payments payment
    where payment.user_id = p_user_id
    order by payment.created_at desc
    limit 250
  ) provider_payment;

  return pg_catalog.jsonb_build_object(
    'feature_enabled', v_feature_enabled,
    'minimum_deposit_usdt', v_config.deposit_minimum_usdt::text,
    'wallet', v_wallet,
    'sessions', v_sessions,
    'provider_payments', v_provider_payments
  );
end;
$function$;

alter function public.get_nowpayments_usdt_deposit_overview_snapshot(uuid)
  owner to postgres;
revoke all on function
  public.get_nowpayments_usdt_deposit_overview_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.get_nowpayments_usdt_deposit_overview_snapshot(uuid)
  to service_role;

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
  if not found or v_is_frozen is distinct from false then
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

  begin
    select config.enabled
      into strict v_enabled
    from public.nowpayments_usdt_config config
    where config.id = 'USDT-BEP20'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_deposit_availability_unavailable';
  end;
  if v_enabled is distinct from true then
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
  if not found or v_is_frozen is distinct from false then
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

  begin
    select config.enabled
      into strict v_enabled
    from public.nowpayments_usdt_config config
    where config.id = 'USDT-BEP20'
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'nowpayments_deposit_availability_unavailable';
  end;
  if v_enabled is distinct from true then
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

create or replace function public.configure_nowpayments_usdt_deposit_session_amounts(
  p_user_id uuid,
  p_session_id uuid,
  p_qhash_order_id uuid,
  p_provider_minimum_usdt text,
  p_technical_reference_amount_usdt text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_is_frozen boolean;
  v_provider_minimum numeric(36, 18);
  v_technical_reference numeric(36, 18);
  v_session public.nowpayments_usdt_payments%rowtype;
begin
  if p_user_id is null
    or p_session_id is null
    or p_qhash_order_id is null
    or p_provider_minimum_usdt is null
    or p_provider_minimum_usdt !~ '^[0-9]+(\.[0-9]{1,18})?$'
    or p_technical_reference_amount_usdt is null
    or p_technical_reference_amount_usdt !~ '^[0-9]+(\.[0-9]{1,18})?$'
  then
    raise exception 'invalid_nowpayments_session_amount_configuration';
  end if;

  begin
    v_provider_minimum := p_provider_minimum_usdt::numeric(36, 18);
    v_technical_reference := p_technical_reference_amount_usdt::numeric(36, 18);
  exception
    when numeric_value_out_of_range then
      raise exception 'invalid_nowpayments_session_amount_configuration';
  end;

  if v_provider_minimum <= 0
    or v_technical_reference < 1
    or v_technical_reference <> greatest(1::numeric, v_provider_minimum)
  then
    raise exception 'invalid_nowpayments_session_amount_configuration';
  end if;

  -- Claim admission holds the profile, global-pause, and rail-configuration
  -- locks before inserting this exact durable provisioning reservation.
  -- Once admitted, disabling a rail must not strand a provider request that
  -- is already in progress. This boundary therefore revalidates the exact
  -- owner and reservation, but intentionally does not reopen admission.
  select is_frozen into v_is_frozen
  from public.profiles
  where id = p_user_id
  for update;
  if not found or v_is_frozen is distinct from false then
    raise exception 'nowpayments_session_user_unavailable';
  end if;

  if exists (
    select 1
    from public.nowpayments_usdt_payments
    where user_id = p_user_id
      and address_activated_at is not null
  ) then
    raise exception 'nowpayments_session_amount_configuration_mismatch';
  end if;

  select * into v_session
  from public.nowpayments_usdt_payments
  where id = p_session_id
    and user_id = p_user_id
    and qhash_order_id = p_qhash_order_id
  for update;

  if not found
    or v_session.session_status <> 'provisioning'
    or v_session.provider_payment_id is not null
    or v_session.provider_payment_status is not null
    or v_session.pay_address is not null
    or v_session.provider_created_at is not null
    or v_session.provider_valid_until is not null
    or v_session.provisioned_at is not null
    or v_session.technical_reference_amount_usdt is not null
    or v_session.provider_minimum_usdt is not null
  then
    raise exception 'nowpayments_session_amount_configuration_mismatch';
  end if;

  update public.nowpayments_usdt_payments
  set technical_reference_amount_usdt = v_technical_reference,
      provider_minimum_usdt = v_provider_minimum,
      updated_at = now()
  where id = v_session.id
    and user_id = p_user_id
    and qhash_order_id = p_qhash_order_id
    and session_status = 'provisioning'
    and technical_reference_amount_usdt is null
    and provider_minimum_usdt is null
  returning * into v_session;

  if not found then
    raise exception 'nowpayments_session_amount_configuration_mismatch';
  end if;

  return to_jsonb(v_session) || jsonb_build_object(
    'disposition', 'configured',
    'technical_reference_amount_usdt', v_session.technical_reference_amount_usdt::text,
    'provider_minimum_usdt', v_session.provider_minimum_usdt::text
  );
end;
$function$;

do $postflight$
declare
  v_pause_value text;
  v_enabled boolean;
  v_expected record;
  v_function record;
  v_acl jsonb;
  v_catalog jsonb;
begin
  if to_regclass('public.app_settings') is null
    or to_regclass('public.profiles') is null
    or to_regclass('public.nowpayments_usdt_config') is null
    or to_regclass('public.nowpayments_usdt_payments') is null
    or to_regclass('public.nowpayments_usdt_wallets') is null
    or to_regclass('public.nowpayments_usdt_provider_payments') is null
  then
    raise exception 'unexpected NOWPayments global deposit-pause relation catalog after migration';
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

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.profiles'::regclass
    and attribute.attname = 'is_frozen'
    and not attribute.attisdropped;

  if v_catalog is distinct from
    '[[6,"is_frozen","boolean",true,"false","","",true]]'::jsonb
  then
    raise exception 'unexpected profiles is_frozen catalog after migration';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.app_settings'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_catalog is distinct from '[
    [1,"key","text",true,null,"","",true],
    [2,"value","text",true,null,"","",true],
    [3,"updated_at","timestamp with time zone",true,"now()","","",true]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings column catalog after migration';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    constraint_row.conname,
    constraint_row.contype,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    constraint_row.conindid::regclass::text
  ) order by constraint_row.conname)
    into v_catalog
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.app_settings'::regclass;

  if v_catalog is distinct from
    '[["app_settings_pkey","p","PRIMARY KEY (key)",true,false,false,"app_settings_pkey"]]'::jsonb
  then
    raise exception 'unexpected app_settings constraint catalog after migration';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.app_settings'::regclass
      and index_relation.relname = 'app_settings_pkey'
      and index_relation.relkind = 'i'
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
      and pg_catalog.pg_get_indexdef(index_row.indexrelid)
        = 'CREATE UNIQUE INDEX app_settings_pkey ON public.app_settings USING btree (key)'
  ) <> 1
    or (
      select count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = 'public.app_settings'::regclass
    ) <> 1
  then
    raise exception 'unexpected app_settings index catalog after migration';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    policy_row.polname,
    policy_row.polpermissive,
    policy_row.polcmd,
    (
      select pg_catalog.jsonb_agg(
        case when role_oid = 0 then 'PUBLIC'
             else pg_catalog.pg_get_userbyid(role_oid) end
        order by
          case when role_oid = 0 then 'PUBLIC'
               else pg_catalog.pg_get_userbyid(role_oid) end
      )
      from pg_catalog.unnest(policy_row.polroles) role_oid
    ),
    pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
    pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
  ) order by policy_row.polname), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_policy policy_row
  where policy_row.polrelid = 'public.app_settings'::regclass;

  if v_catalog is distinct from '[
    ["app_settings_service_role_select",true,"r",["service_role"],"true",null]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings policy catalog after migration: %', v_catalog;
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ) order by
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) acl_row
  where relation.oid = 'public.app_settings'::regclass;

  if v_catalog is distinct from '[
    ["postgres","postgres","DELETE",false],
    ["postgres","postgres","INSERT",false],
    ["postgres","postgres","MAINTAIN",false],
    ["postgres","postgres","REFERENCES",false],
    ["postgres","postgres","SELECT",false],
    ["postgres","postgres","TRIGGER",false],
    ["postgres","postgres","TRUNCATE",false],
    ["postgres","postgres","UPDATE",false],
    ["service_role","postgres","INSERT",false],
    ["service_role","postgres","SELECT",false],
    ["service_role","postgres","UPDATE",false]
  ]'::jsonb
  then
    raise exception 'unexpected app_settings table ACL catalog after migration';
  end if;

  select pg_catalog.jsonb_build_array(
    pg_catalog.pg_get_userbyid(relation.relowner),
    relation.relkind,
    relation.relpersistence,
    relation.relrowsecurity,
    relation.relforcerowsecurity
  )
    into v_catalog
  from pg_catalog.pg_class relation
  where relation.oid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '["postgres","r","p",true,false]'::jsonb then
    raise exception 'unexpected NOWPayments configuration relation catalog after migration';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    attribute.attnum,
    attribute.attname,
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
    attribute.attnotnull,
    pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
    attribute.attidentity,
    attribute.attgenerated,
    attribute.attacl is null
  ) order by attribute.attnum)
    into v_catalog
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = 'public.nowpayments_usdt_config'::regclass
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_catalog is distinct from '[
    [1,"id","text",true,"''USDT-BEP20''::text","","",true],
    [2,"enabled","boolean",true,"false","","",true],
    [3,"asset","text",true,"''USDT''::text","","",true],
    [4,"network","text",true,"''BEP20''::text","","",true],
    [5,"provider_currency","text",true,"''usdtbsc''::text","","",true],
    [6,"deposit_minimum_usdt","numeric(36,6)",true,"1","","",true],
    [7,"withdrawal_minimum_usdt","numeric(36,6)",true,"2","","",true],
    [8,"withdrawal_fee_percent","numeric(7,4)",true,"5","","",true],
    [9,"created_at","timestamp with time zone",true,"now()","","",true],
    [10,"updated_at","timestamp with time zone",true,"now()","","",true],
    [11,"withdrawals_enabled","boolean",true,"false","","",true]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration column catalog after migration';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    constraint_row.conname,
    constraint_row.contype,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    case when constraint_row.conindid = 0 then null
         else constraint_row.conindid::regclass::text end
  ) order by constraint_row.conname)
    into v_catalog
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '[
    ["nowpayments_usdt_config_asset_check","c","CHECK (asset = ''USDT''::text)",true,false,false,null],
    ["nowpayments_usdt_config_deposit_minimum_check","c","CHECK (deposit_minimum_usdt = 1::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_network_check","c","CHECK (network = ''BEP20''::text)",true,false,false,null],
    ["nowpayments_usdt_config_pkey","p","PRIMARY KEY (id)",true,false,false,"nowpayments_usdt_config_pkey"],
    ["nowpayments_usdt_config_provider_currency_check","c","CHECK (provider_currency = ''usdtbsc''::text)",true,false,false,null],
    ["nowpayments_usdt_config_singleton_check","c","CHECK (id = ''USDT-BEP20''::text)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawal_fee_check","c","CHECK (withdrawal_fee_percent = 5::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawal_minimum_check","c","CHECK (withdrawal_minimum_usdt = 2::numeric)",true,false,false,null],
    ["nowpayments_usdt_config_withdrawals_enabled_default_check","c","CHECK (withdrawals_enabled = ANY (ARRAY[true, false]))",true,false,false,null]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration constraint catalog after migration';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = 'public.nowpayments_usdt_config'::regclass
      and index_relation.relname = 'nowpayments_usdt_config_pkey'
      and index_relation.relkind = 'i'
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
      and pg_catalog.pg_get_indexdef(index_row.indexrelid)
        = 'CREATE UNIQUE INDEX nowpayments_usdt_config_pkey ON public.nowpayments_usdt_config USING btree (id)'
  ) <> 1
    or (
      select count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = 'public.nowpayments_usdt_config'::regclass
    ) <> 1
    or exists (
      select 1
      from pg_catalog.pg_policy policy_row
      where policy_row.polrelid = 'public.nowpayments_usdt_config'::regclass
    )
  then
    raise exception 'unexpected NOWPayments configuration index or policy catalog after migration';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ) order by
    case when acl_row.grantee = 0 then 'PUBLIC'
         else pg_catalog.pg_get_userbyid(acl_row.grantee) end,
    pg_catalog.pg_get_userbyid(acl_row.grantor),
    acl_row.privilege_type,
    acl_row.is_grantable
  ), '[]'::jsonb)
    into v_catalog
  from pg_catalog.pg_class relation
  cross join lateral pg_catalog.aclexplode(relation.relacl) acl_row
  where relation.oid = 'public.nowpayments_usdt_config'::regclass;

  if v_catalog is distinct from '[
    ["postgres","postgres","DELETE",false],
    ["postgres","postgres","INSERT",false],
    ["postgres","postgres","MAINTAIN",false],
    ["postgres","postgres","REFERENCES",false],
    ["postgres","postgres","SELECT",false],
    ["postgres","postgres","TRIGGER",false],
    ["postgres","postgres","TRUNCATE",false],
    ["postgres","postgres","UPDATE",false],
    ["service_role","postgres","SELECT",false]
  ]'::jsonb
  then
    raise exception 'unexpected NOWPayments configuration table ACL catalog after migration';
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

  if v_pause_value is distinct from 'false' then
    raise exception 'unexpected deposits_paused configuration after migration';
  end if;

  if (select count(*) from public.nowpayments_usdt_config) <> 1 then
    raise exception 'unexpected NOWPayments configuration singleton after migration';
  end if;

  begin
    select config.enabled
      into strict v_enabled
    from public.nowpayments_usdt_config config
    where config.id = 'USDT-BEP20'
      and config.asset = 'USDT'
      and config.network = 'BEP20'
      and config.provider_currency = 'usdtbsc'
      and config.deposit_minimum_usdt = 1
      and config.withdrawal_minimum_usdt = 2
      and config.withdrawal_fee_percent = 5
    for share;
  exception
    when no_data_found or too_many_rows then
      raise exception 'unexpected NOWPayments configuration singleton after migration';
  end;

  if v_enabled is distinct from true then
    raise exception 'unexpected NOWPayments configuration singleton after migration';
  end if;

  for v_expected in
    select *
    from (
      values
        (
          'public.get_nowpayments_usdt_deposit_overview_snapshot(uuid)'::text,
          'p_user_id uuid'::text,
          4988::integer,
          'fc8c7ab4814da7e5fa18c3a8a9609426'::text
        ),
        (
          'public.get_current_nowpayments_usdt_deposit_session(uuid)'::text,
          'p_user_id uuid'::text,
          3825::integer,
          'bd27d8765691815efe9dab0b7ca337d7'::text
        ),
        (
          'public.claim_nowpayments_usdt_deposit_session(uuid)'::text,
          'p_user_id uuid'::text,
          6213::integer,
          '2f75b2c972a671b87a8d4d1184425ffe'::text
        ),
        (
          'public.configure_nowpayments_usdt_deposit_session_amounts(uuid,uuid,uuid,text,text)'::text,
          'p_user_id uuid, p_session_id uuid, p_qhash_order_id uuid, p_provider_minimum_usdt text, p_technical_reference_amount_usdt text'::text,
          3434::integer,
          '8c04629406e21ec6c41f72189b1b37aa'::text
        )
    ) expected(identity, identity_arguments, source_length, source_md5)
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
      or v_function.identity_arguments <> v_expected.identity_arguments
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
