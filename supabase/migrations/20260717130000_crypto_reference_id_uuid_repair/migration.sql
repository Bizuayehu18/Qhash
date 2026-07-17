-- Keep the crypto credit ledger reference aligned with the canonical
-- transactions.reference_id UUID column. The preceding manual-credit
-- functions accidentally cast the crypto deposit UUID to text, causing
-- PostgreSQL to fail at the duplicate-ledger comparison before any write.

do $migration$
declare
  v_reference_id_type text;
  v_function_definition text;
  v_repaired_definition text;
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

  select pg_get_functiondef(
    'public.credit_confirmed_bsc_crypto_deposit(uuid,uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,text,text)'::regprocedure
  ) into v_function_definition;

  if strpos(v_function_definition, 'v_reference_id text;') = 0 then
    raise exception 'Manual credit function no longer has the expected text reference declaration';
  end if;

  if strpos(v_function_definition, 'v_reference_id := v_deposit.id::text;') = 0 then
    raise exception 'Manual credit function no longer has the expected text reference assignment';
  end if;

  v_repaired_definition := replace(
    replace(
      v_function_definition,
      'v_reference_id text;',
      'v_reference_id uuid;'
    ),
    'v_reference_id := v_deposit.id::text;',
    'v_reference_id := v_deposit.id;'
  );

  if v_repaired_definition = v_function_definition then
    raise exception 'Manual credit UUID reference repair made no change';
  end if;

  execute v_repaired_definition;
end;
$migration$;

comment on function public.credit_confirmed_bsc_crypto_deposit(
  uuid, uuid, text, uuid, text, integer, text, text, text, text, bigint, integer, integer, text, text
) is 'Atomically and idempotently credits one canonically revalidated confirmed BSC USDT deposit using UUID-backed crypto user IDs and ledger references; service-role only.';
