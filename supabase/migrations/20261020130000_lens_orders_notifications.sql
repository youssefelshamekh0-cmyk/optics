create table if not exists public.lens_orders (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  supplier_name text not null,
  customer_name text,
  lens_description text not null,
  quantity integer not null default 1 check (quantity between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','ordered','received','cancelled')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lens_orders_branch_status_created_idx on public.lens_orders(branch_id,status,created_at desc);
alter table public.lens_orders enable row level security;
