-- All business data is accessed through authenticated Next.js route handlers.
-- No direct Data API table privileges are granted to anon/authenticated clients.
create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code varchar(32) not null unique,
  name varchar(120) not null,
  address varchar(500),
  phone varchar(40),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email varchar(254) not null unique,
  full_name varchar(160) not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  key varchar(40) not null unique check (key in ('super_admin', 'salesperson')),
  name varchar(100) not null
);

create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key varchar(80) not null unique,
  description varchar(200) not null
);

create table public.user_roles (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete restrict,
  primary key (user_id, role_id)
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_permissions (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (user_id, permission_id)
);

create table public.user_branch_access (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  primary key (user_id, branch_id)
);
create index user_branch_access_branch_id_idx on public.user_branch_access(branch_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action varchar(80) not null,
  entity_type varchar(80) not null,
  entity_id varchar(100),
  details jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

insert into public.roles(key, name) values
  ('super_admin', 'مالك البراند'),
  ('salesperson', 'بائع');

insert into public.permissions(key, description) values
  ('branches.read', 'عرض الفروع'),
  ('branches.manage', 'إدارة الفروع'),
  ('users.read', 'عرض المستخدمين'),
  ('users.manage', 'إدارة المستخدمين والصلاحيات'),
  ('customers.read', 'عرض العملاء'),
  ('customers.manage', 'إدارة العملاء'),
  ('sales.create', 'إنشاء الفواتير'),
  ('payments.record', 'تسجيل المدفوعات'),
  ('deliveries.complete', 'إتمام التسليمات'),
  ('returns.manage', 'إدارة المرتجعات'),
  ('reports.own.read', 'عرض تقارير المستخدم نفسه');

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.key = 'super_admin';

create or replace function public.admin_create_user_profile(
  p_user_id uuid, p_email text, p_full_name text, p_role_key text,
  p_branch_ids uuid[] default '{}', p_permission_keys text[] default '{}'
) returns void
language plpgsql security invoker set search_path = public
as $$
declare
  v_role_id uuid;
begin
  if p_role_key not in ('super_admin', 'salesperson') then raise exception 'invalid role'; end if;
  select id into v_role_id from roles where key = p_role_key;
  if v_role_id is null then raise exception 'role not found'; end if;
  if exists (select 1 from unnest(p_branch_ids) x(id) left join branches b on b.id = x.id where b.id is null or b.status <> 'active') then raise exception 'invalid branch'; end if;
  if exists (select 1 from unnest(p_permission_keys) x(key) left join permissions p on p.key = x.key where p.key is null) then raise exception 'invalid permission'; end if;
  insert into user_profiles(id,email,full_name) values (p_user_id, lower(trim(p_email)), trim(p_full_name));
  insert into user_roles(user_id,role_id) values (p_user_id,v_role_id);
  insert into user_branch_access(user_id,branch_id) select p_user_id, x from unnest(p_branch_ids) x on conflict do nothing;
  insert into user_permissions(user_id,permission_id) select p_user_id,p.id from permissions p where p.key = any(p_permission_keys) on conflict do nothing;
end;
$$;

create or replace function public.admin_update_salesperson(
  p_user_id uuid, p_full_name text, p_status text, p_branch_ids uuid[], p_permission_keys text[]
) returns void
language plpgsql security invoker set search_path = public
as $$
begin
  if p_status not in ('active','disabled') then raise exception 'invalid status'; end if;
  if not exists (select 1 from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = p_user_id and r.key = 'salesperson') then raise exception 'salesperson not found'; end if;
  if exists (select 1 from unnest(p_branch_ids) x(id) left join branches b on b.id = x.id where b.id is null or b.status <> 'active') then raise exception 'invalid branch'; end if;
  if exists (select 1 from unnest(p_permission_keys) x(key) left join permissions p on p.key = x.key where p.key is null) then raise exception 'invalid permission'; end if;
  update user_profiles set full_name=trim(p_full_name), status=p_status, updated_at=now() where id=p_user_id;
  delete from user_branch_access where user_id=p_user_id;
  insert into user_branch_access(user_id,branch_id) select p_user_id,x from unnest(p_branch_ids) x on conflict do nothing;
  delete from user_permissions where user_id=p_user_id;
  insert into user_permissions(user_id,permission_id) select p_user_id,p.id from permissions p where p.key = any(p_permission_keys) on conflict do nothing;
end;
$$;

revoke all on function public.admin_create_user_profile(uuid,text,text,text,uuid[],text[]) from public, anon, authenticated;
revoke all on function public.admin_update_salesperson(uuid,text,text,uuid[],text[]) from public, anon, authenticated;
grant execute on function public.admin_create_user_profile(uuid,text,text,text,uuid[],text[]) to service_role;
grant execute on function public.admin_update_salesperson(uuid,text,text,uuid[],text[]) to service_role;

-- Enable RLS on every public table. The browser's publishable key receives no table grants;
-- server handlers use a server-only service role after checking Auth and application permissions.
alter table public.branches enable row level security;
alter table public.user_profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.user_branch_access enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.branches from anon, authenticated;
revoke all on table public.user_profiles from anon, authenticated;
revoke all on table public.roles from anon, authenticated;
revoke all on table public.permissions from anon, authenticated;
revoke all on table public.user_roles from anon, authenticated;
revoke all on table public.role_permissions from anon, authenticated;
revoke all on table public.user_permissions from anon, authenticated;
revoke all on table public.user_branch_access from anon, authenticated;
revoke all on table public.audit_logs from anon, authenticated;

grant all on table public.branches to service_role;
grant all on table public.user_profiles to service_role;
grant all on table public.roles to service_role;
grant all on table public.permissions to service_role;
grant all on table public.user_roles to service_role;
grant all on table public.role_permissions to service_role;
grant all on table public.user_permissions to service_role;
grant all on table public.user_branch_access to service_role;
grant all on table public.audit_logs to service_role;
