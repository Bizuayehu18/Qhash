-- Netlify Database uses text profile identifiers. The crypto deposit workflow
-- belongs to Supabase, whose profile identifiers are UUIDs, and is no longer
-- migrated through this directory. Repair any UUID column left by the earlier
-- failed Netlify migration attempt without changing Supabase.

do $$
declare
  v_data_type text;
begin
  select column_info.data_type
    into v_data_type
  from information_schema.columns as column_info
  where column_info.table_schema = 'public'
    and column_info.table_name = 'crypto_deposits'
    and column_info.column_name = 'credited_by_admin_id';

  if v_data_type is null then
    alter table public.crypto_deposits
      add column credited_by_admin_id text;
  elsif v_data_type in ('text', 'character varying') then
    null;
  elsif v_data_type = 'uuid' then
    alter table public.crypto_deposits
      alter column credited_by_admin_id type text
      using credited_by_admin_id::text;
  else
    raise exception 'Unexpected crypto_deposits.credited_by_admin_id type: %', v_data_type;
  end if;
end
$$;
