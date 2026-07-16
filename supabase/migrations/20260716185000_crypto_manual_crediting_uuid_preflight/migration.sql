-- Repair a partial pre-migration state left by Netlify Database before the
-- manual-crediting migration adds its UUID foreign key. QHash stores this
-- audit column as UUID because public.profiles.id is UUID in live databases.

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
      add column credited_by_admin_id uuid;
  elsif v_data_type = 'uuid' then
    null;
  elsif v_data_type in ('text', 'character varying') then
    if exists (
      select 1
      from public.crypto_deposits
      where credited_by_admin_id is not null
        and btrim(credited_by_admin_id) <> ''
        and credited_by_admin_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'crypto_deposits.credited_by_admin_id contains a non-UUID value';
    end if;

    alter table public.crypto_deposits
      alter column credited_by_admin_id type uuid
      using nullif(btrim(credited_by_admin_id), '')::uuid;
  else
    raise exception 'Unexpected crypto_deposits.credited_by_admin_id type: %', v_data_type;
  end if;
end
$$;
