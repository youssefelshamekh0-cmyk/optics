-- Customer records are isolated by branch in application route handlers.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  full_name varchar(160) not null,
  phone varchar(40),
  email varchar(254),
  notes varchar(1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_not_blank check (length(trim(full_name)) >= 2)
);

create index customers_branch_created_idx on public.customers(branch_id, created_at desc);
create index customers_branch_name_idx on public.customers(branch_id, full_name);
create index customers_branch_phone_idx on public.customers(branch_id, phone) where phone is not null;

alter table public.customers enable row level security;
revoke all on table public.customers from anon, authenticated;
grant all on table public.customers to service_role;

-- Everyone with the salesperson role may load their assigned branch list.
insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'salesperson' and p.key = 'branches.read'
on conflict do nothing;
