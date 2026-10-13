alter table public.user_profiles drop constraint if exists user_profiles_phone_e164_check;
alter table public.user_profiles add constraint user_profiles_phone_e164_check
  check (phone is null or (left(phone, 3) = '+20' and substring(phone from 4) ~ '^1[0-5][0-9]{8}$'));

create or replace function public.admin_create_phone_profile(
  p_user_id uuid, p_phone text, p_full_name text, p_role_key text,
  p_branch_ids uuid[] default '{}', p_permission_keys text[] default '{}'
) returns void
language plpgsql security invoker set search_path = public
as $$
declare v_role_id uuid;
begin
  if p_role_key not in ('super_admin', 'salesperson') then raise exception 'invalid role'; end if;
  if left(p_phone, 3) <> '+20' or substring(p_phone from 4) !~ '^1[0-5][0-9]{8}$' then raise exception 'invalid Egyptian phone'; end if;
  select id into v_role_id from roles where key = p_role_key;
  if v_role_id is null then raise exception 'role not found'; end if;
  if exists (select 1 from unnest(p_branch_ids) x(id) left join branches b on b.id=x.id where b.id is null or b.status <> 'active') then raise exception 'invalid branch'; end if;
  if exists (select 1 from unnest(p_permission_keys) x(key) left join permissions p on p.key=x.key where p.key is null) then raise exception 'invalid permission'; end if;
  insert into user_profiles(id,phone,full_name) values(p_user_id,p_phone,trim(p_full_name));
  insert into user_roles(user_id,role_id) values(p_user_id,v_role_id);
  insert into user_branch_access(user_id,branch_id) select p_user_id,x from unnest(p_branch_ids) x on conflict do nothing;
  insert into user_permissions(user_id,permission_id) select p_user_id,p.id from permissions p where p.key=any(p_permission_keys) on conflict do nothing;
end;
$$;
