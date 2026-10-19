-- Idempotent customer creation for offline-first POS.
-- Only service_role can call this function; auth and permissions remain in the API route.
create table if not exists public.customer_operation_keys (
  operation_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_fingerprint text not null,
  customer_id uuid references public.customers(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.customer_operation_keys enable row level security;
revoke all on public.customer_operation_keys from public, anon, authenticated;
grant all on public.customer_operation_keys to service_role;

create or replace function public.create_customer_idempotent(
  p_operation_id uuid,
  p_actor_id uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fingerprint text;
  v_existing public.customer_operation_keys%rowtype;
  v_customer public.customers%rowtype;
begin
  if p_operation_id is null or p_actor_id is null then raise exception 'operation id and actor are required'; end if;
  if nullif(trim(coalesce(p_full_name,'')),'') is null or length(trim(p_full_name)) < 2 or length(trim(p_full_name)) > 160 then
    raise exception 'invalid customer name';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'name',trim(p_full_name),'phone',nullif(trim(coalesce(p_phone,'')),''),
    'email',nullif(trim(coalesce(p_email,'')),''),'notes',nullif(trim(coalesce(p_notes,'')),'')
  )::text);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text || ':' || p_operation_id::text, 0));
  select * into v_existing from public.customer_operation_keys where operation_id=p_operation_id for update;
  if found then
    if v_existing.actor_id<>p_actor_id or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'idempotency key reused with different customer details';
    end if;
    if v_existing.customer_id is null then raise exception 'customer operation incomplete'; end if;
    select * into v_customer from public.customers where id=v_existing.customer_id;
    return pg_catalog.jsonb_build_object('id',v_customer.id,'full_name',v_customer.full_name,'phone',v_customer.phone,'email',v_customer.email,'notes',v_customer.notes,'created_at',v_customer.created_at,'updated_at',v_customer.updated_at);
  end if;

  insert into public.customer_operation_keys(operation_id,actor_id,request_fingerprint)
  values(p_operation_id,p_actor_id,v_fingerprint);

  if nullif(trim(coalesce(p_phone,'')),'') is not null then
    select * into v_customer from public.customers where phone=trim(p_phone) for update;
    if found then raise exception 'customer phone already exists'; end if;
  end if;

  insert into public.customers(full_name,phone,email,notes,created_by)
  values(trim(p_full_name),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_email,'')),''),nullif(trim(coalesce(p_notes,'')),''),p_actor_id)
  returning * into v_customer;

  update public.customer_operation_keys set customer_id=v_customer.id where operation_id=p_operation_id;
  return pg_catalog.jsonb_build_object('id',v_customer.id,'full_name',v_customer.full_name,'phone',v_customer.phone,'email',v_customer.email,'notes',v_customer.notes,'created_at',v_customer.created_at,'updated_at',v_customer.updated_at);
end;
$$;

revoke all on function public.create_customer_idempotent(uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant execute on function public.create_customer_idempotent(uuid,uuid,text,text,text,text) to service_role;
