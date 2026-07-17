-- Add a dedicated, disabled-by-default switch for exposing active BSC deposit
-- addresses and BSC deposit history to the owning user. This is intentionally
-- separate from crypto_auto_credit_enabled: confirmation and crediting remain
-- explicit admin operations, and TRON remains unavailable.

do $migration$
begin
  if to_regclass('public.app_settings') is null then
    raise exception 'public.app_settings is missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'key'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'value'
  ) then
    raise exception 'public.app_settings does not have the expected key/value columns';
  end if;
end;
$migration$;

insert into public.app_settings (key, value)
values ('crypto_bsc_user_deposits_enabled', 'false')
on conflict (key) do nothing;

do $migration$
declare
  v_setting_value text;
begin
  select setting.value
    into v_setting_value
  from public.app_settings as setting
  where setting.key = 'crypto_bsc_user_deposits_enabled';

  if v_setting_value is null then
    raise exception 'crypto_bsc_user_deposits_enabled was not created';
  end if;

  if v_setting_value not in ('true', 'false') then
    raise exception 'crypto_bsc_user_deposits_enabled has an invalid value';
  end if;
end;
$migration$;
