alter table public.payment_methods
add column if not exists is_archived boolean not null default false;

create index if not exists idx_payment_methods_is_archived
on public.payment_methods (is_archived);

create index if not exists idx_payment_methods_type_active_archived
on public.payment_methods (type, is_active, is_archived);

comment on column public.payment_methods.is_archived is
'Soft-hide old payment methods from the default admin list without deleting historical deposit references. Used accounts should be archived, not hard-deleted.';
