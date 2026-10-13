-- Customers are shared across all branches; sales keep their own branch_id.
drop index if exists public.customers_branch_created_idx;
drop index if exists public.customers_branch_name_idx;
drop index if exists public.customers_branch_phone_idx;
alter table public.customers drop constraint if exists customers_branch_id_fkey;
alter table public.customers drop column if exists branch_id;
create index if not exists customers_created_idx on public.customers(created_at desc);
create index if not exists customers_name_idx on public.customers(full_name);
create index if not exists customers_phone_idx on public.customers(phone) where phone is not null;
