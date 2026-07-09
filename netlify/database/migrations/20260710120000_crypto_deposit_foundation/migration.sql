-- QHash crypto deposit foundation for future USDT TRON/BSC support.
-- Foundation only: no watchers, sweeping, signing, private keys, or wallet crediting.

create table if not exists public.crypto_deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  network text not null,
  asset text not null default 'USDT',
  address text not null,
  derivation_index bigint,
  activation_status text not null default 'inactive',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_deposit_addresses_network_check
    check (network in ('TRON', 'BSC')),
  constraint crypto_deposit_addresses_asset_check
    check (asset = 'USDT'),
  constraint crypto_deposit_addresses_activation_status_check
    check (activation_status in ('inactive', 'active', 'activation_queued', 'activation_failed', 'not_required')),
  constraint crypto_deposit_addresses_status_check
    check (status in ('active', 'disabled')),
  constraint crypto_deposit_addresses_network_activation_check
    check (
      (network = 'TRON' and activation_status in ('inactive', 'active', 'activation_queued', 'activation_failed'))
      or (network = 'BSC' and activation_status = 'not_required')
    ),
  constraint crypto_deposit_addresses_user_network_asset_key
    unique (user_id, network, asset)
);

create unique index if not exists crypto_deposit_addresses_network_asset_address_key
  on public.crypto_deposit_addresses (network, asset, lower(address));

create unique index if not exists crypto_deposit_addresses_network_asset_derivation_key
  on public.crypto_deposit_addresses (network, asset, derivation_index)
  where derivation_index is not null;

create index if not exists idx_crypto_deposit_addresses_user_id
  on public.crypto_deposit_addresses (user_id);

create index if not exists idx_crypto_deposit_addresses_status
  on public.crypto_deposit_addresses (status);

create table if not exists public.crypto_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  address_id uuid references public.crypto_deposit_addresses(id),
  network text not null,
  asset text not null default 'USDT',
  tx_hash text not null,
  event_index integer not null default 0,
  from_address text not null,
  to_address text not null,
  amount_raw numeric(78, 0) not null,
  amount_usdt numeric(36, 6) not null,
  block_number bigint not null,
  confirmations integer not null default 0,
  status text not null default 'detected',
  exchange_rate_etb numeric(18, 6),
  credited_amount_etb numeric(18, 2),
  detected_at timestamptz not null default now(),
  confirmed_at timestamptz,
  credited_at timestamptz,
  swept_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_deposits_network_check
    check (network in ('TRON', 'BSC')),
  constraint crypto_deposits_asset_check
    check (asset = 'USDT'),
  constraint crypto_deposits_amount_raw_check
    check (amount_raw > 0),
  constraint crypto_deposits_amount_usdt_check
    check (amount_usdt > 0),
  constraint crypto_deposits_confirmations_check
    check (confirmations >= 0),
  constraint crypto_deposits_status_check
    check (status in ('detected', 'confirmed', 'credited', 'swept', 'failed')),
  constraint crypto_deposits_credit_fields_check
    check (
      status <> 'credited'
      or (
        exchange_rate_etb is not null
        and exchange_rate_etb > 0
        and credited_amount_etb is not null
        and credited_amount_etb > 0
        and credited_at is not null
      )
    ),
  constraint crypto_deposits_swept_fields_check
    check (status <> 'swept' or swept_at is not null),
  constraint crypto_deposits_network_tx_event_key
    unique (network, tx_hash, event_index)
);

create index if not exists idx_crypto_deposits_user_id
  on public.crypto_deposits (user_id);

create index if not exists idx_crypto_deposits_address_id
  on public.crypto_deposits (address_id);

create index if not exists idx_crypto_deposits_status
  on public.crypto_deposits (status);

create index if not exists idx_crypto_deposits_network_block
  on public.crypto_deposits (network, block_number desc);

create table if not exists public.crypto_sweep_jobs (
  id uuid primary key default gen_random_uuid(),
  crypto_deposit_id uuid not null references public.crypto_deposits(id),
  network text not null,
  from_address text not null,
  to_treasury_address text not null,
  amount_usdt numeric(36, 6) not null,
  status text not null default 'queued',
  gas_topup_tx_hash text,
  sweep_tx_hash text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crypto_sweep_jobs_network_check
    check (network in ('TRON', 'BSC')),
  constraint crypto_sweep_jobs_amount_usdt_check
    check (amount_usdt > 0),
  constraint crypto_sweep_jobs_status_check
    check (status in ('queued', 'gas_prepared', 'broadcasted', 'completed', 'failed')),
  constraint crypto_sweep_jobs_crypto_deposit_id_key
    unique (crypto_deposit_id)
);

create index if not exists idx_crypto_sweep_jobs_status
  on public.crypto_sweep_jobs (status);

create index if not exists idx_crypto_sweep_jobs_network_status
  on public.crypto_sweep_jobs (network, status);

create table if not exists public.crypto_watcher_state (
  network text primary key,
  last_scanned_block bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint crypto_watcher_state_network_check
    check (network in ('TRON', 'BSC')),
  constraint crypto_watcher_state_last_scanned_block_check
    check (last_scanned_block >= 0)
);

create or replace function public.set_crypto_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'set_crypto_deposit_addresses_updated_at') then
    create trigger set_crypto_deposit_addresses_updated_at
    before update on public.crypto_deposit_addresses
    for each row
    execute function public.set_crypto_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_crypto_deposits_updated_at') then
    create trigger set_crypto_deposits_updated_at
    before update on public.crypto_deposits
    for each row
    execute function public.set_crypto_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_crypto_sweep_jobs_updated_at') then
    create trigger set_crypto_sweep_jobs_updated_at
    before update on public.crypto_sweep_jobs
    for each row
    execute function public.set_crypto_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'set_crypto_watcher_state_updated_at') then
    create trigger set_crypto_watcher_state_updated_at
    before update on public.crypto_watcher_state
    for each row
    execute function public.set_crypto_updated_at();
  end if;
end $$;

insert into public.crypto_watcher_state (network, last_scanned_block)
values
  ('TRON', 0),
  ('BSC', 0)
on conflict (network) do nothing;

insert into public.app_settings (key, value)
values
  ('usdt_etb_rate', '160'),
  ('crypto_tron_min_usdt', '10'),
  ('crypto_bsc_min_usdt', '5'),
  ('crypto_auto_credit_enabled', 'false')
on conflict (key) do nothing;

comment on table public.crypto_deposit_addresses is
  'Future per-user permanent USDT deposit addresses for TRON and BSC. Stores public addresses only; no private keys.';

comment on table public.crypto_deposits is
  'Detected USDT token transfer events. Foundation only; wallet crediting is intentionally not implemented here.';

comment on table public.crypto_sweep_jobs is
  'Future sweep job tracking for confirmed crypto deposits. No signing or sweeping is implemented by this migration.';

comment on table public.crypto_watcher_state is
  'Future blockchain watcher checkpoint state per network.';
