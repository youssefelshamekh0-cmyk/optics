-- Brand identity settings for invoices and reports. Apply to staging first.
create table if not exists public.brand_settings (
  id boolean primary key default true check (id = true),
  brand_name text not null default 'Optics',
  logo_path text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.brand_settings enable row level security;
revoke all on public.brand_settings from public, anon, authenticated;
grant all on public.brand_settings to service_role;
insert into public.brand_settings (id, brand_name)
values (true, 'Optics')
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-assets', 'brand-assets', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
