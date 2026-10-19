create table if not exists public.brand_settings (
  id boolean primary key default true check (id = true),
  logo_data_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.brand_settings enable row level security;
revoke all on public.brand_settings from anon, authenticated;
grant select, insert, update, delete on public.brand_settings to service_role;
