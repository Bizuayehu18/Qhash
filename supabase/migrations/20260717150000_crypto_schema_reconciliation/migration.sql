-- Reconcile two production hardening details after the BSC credit path was
-- proven end to end. The original QHash schema declares the non-unique
-- reference lookup index, but manually built production databases may not
-- contain it. The crypto audit constraint was intentionally introduced as
-- NOT VALID and can now be validated after the live violation audit passed.

do $migration$
declare
  v_reference_id_type text;
  v_constraint_expression text;
  v_index_table oid;
  v_index_unique boolean;
  v_index_valid boolean;
  v_index_ready boolean;
  v_index_columns text[];
  v_index_predicate text;
begin
  select column_info.data_type
    into v_reference_id_type
  from information_schema.columns as column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'transactions'
    and column_info.column_name = 'reference_id';

  if v_reference_id_type is null then
    raise exception 'public.transactions.reference_id is missing';
  end if;

  if v_reference_id_type <> 'uuid' then
    raise exception 'Unexpected transactions.reference_id type: %', v_reference_id_type;
  end if;

  select lower(pg_get_expr(constraint_info.conbin, constraint_info.conrelid))
    into v_constraint_expression
  from pg_constraint as constraint_info
  where constraint_info.conname = 'crypto_deposits_credit_audit_fields_check'
    and constraint_info.conrelid = 'public.crypto_deposits'::regclass
    and constraint_info.contype = 'c';

  if v_constraint_expression is null then
    raise exception 'crypto_deposits_credit_audit_fields_check is missing';
  end if;

  v_constraint_expression := regexp_replace(
    replace(v_constraint_expression, '::text', ''),
    '[[:space:]()]',
    '',
    'g'
  );

  if v_constraint_expression <>
    'status<>''credited''orcredited_transaction_idisnotnullandcredited_by_admin_idisnotnull'
  then
    raise exception 'crypto_deposits_credit_audit_fields_check has an unexpected definition';
  end if;

  select
    index_info.indrelid,
    index_info.indisunique,
    index_info.indisvalid,
    index_info.indisready,
    array(
      select attribute_info.attname::text
      from unnest(index_info.indkey) with ordinality as index_key(attnum, position)
      join pg_attribute as attribute_info
        on attribute_info.attrelid = index_info.indrelid
       and attribute_info.attnum = index_key.attnum
      order by index_key.position
    ),
    pg_get_expr(index_info.indpred, index_info.indrelid)
  into
    v_index_table,
    v_index_unique,
    v_index_valid,
    v_index_ready,
    v_index_columns,
    v_index_predicate
  from pg_class as index_class
  join pg_namespace as index_namespace
    on index_namespace.oid = index_class.relnamespace
  join pg_index as index_info
    on index_info.indexrelid = index_class.oid
  where index_namespace.nspname = 'public'
    and index_class.relname = 'idx_transactions_reference';

  if found and (
    v_index_table <> 'public.transactions'::regclass
    or v_index_unique
    or not v_index_valid
    or not v_index_ready
    or v_index_columns <> array['reference_id']::text[]
    or regexp_replace(
      lower(coalesce(v_index_predicate, '')),
      '[[:space:]()]',
      '',
      'g'
    ) <> 'reference_idisnotnull'
  ) then
    raise exception 'public.idx_transactions_reference has an unexpected definition';
  end if;
end;
$migration$;

alter table public.crypto_deposits
  validate constraint crypto_deposits_credit_audit_fields_check;

create index if not exists idx_transactions_reference
  on public.transactions (reference_id)
  where reference_id is not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint as constraint_info
    where constraint_info.conname = 'crypto_deposits_credit_audit_fields_check'
      and constraint_info.conrelid = 'public.crypto_deposits'::regclass
      and constraint_info.contype = 'c'
      and constraint_info.convalidated
  ) then
    raise exception 'crypto_deposits_credit_audit_fields_check was not validated';
  end if;

  if not exists (
    select 1
    from pg_class as index_class
    join pg_namespace as index_namespace
      on index_namespace.oid = index_class.relnamespace
    join pg_index as index_info
      on index_info.indexrelid = index_class.oid
    where index_namespace.nspname = 'public'
      and index_class.relname = 'idx_transactions_reference'
      and index_info.indrelid = 'public.transactions'::regclass
      and not index_info.indisunique
      and index_info.indisvalid
      and index_info.indisready
      and array(
        select attribute_info.attname::text
        from unnest(index_info.indkey) with ordinality as index_key(attnum, position)
        join pg_attribute as attribute_info
          on attribute_info.attrelid = index_info.indrelid
         and attribute_info.attnum = index_key.attnum
        order by index_key.position
      ) = array['reference_id']::text[]
      and regexp_replace(
        lower(coalesce(pg_get_expr(index_info.indpred, index_info.indrelid), '')),
        '[[:space:]()]',
        '',
        'g'
      ) = 'reference_idisnotnull'
  ) then
    raise exception 'public.idx_transactions_reference was not created correctly';
  end if;
end;
$migration$;
