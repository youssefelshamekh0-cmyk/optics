-- Idempotent stock adjustments and globally unique sale-return operation keys.
-- Keep on the feature branch until isolated staging validation.
create table if not exists public.inventory_adjustment_operations (
  operation_id uuid primary key,
  actor_id uuid not null references auth.users(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta<>0),
  reason varchar(300) not null,
  request_fingerprint text not null,
  movement_id uuid references public.stock_movements(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.inventory_adjustment_operations enable row level security;
revoke all on table public.inventory_adjustment_operations from public,anon,authenticated;
grant all on table public.inventory_adjustment_operations to service_role;

create or replace function public.adjust_stock_idempotent(
  p_operation_id uuid,p_branch_id uuid,p_product_id uuid,p_delta integer,p_reason text,p_actor uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_key public.inventory_adjustment_operations%rowtype;
  v_fingerprint text;
  v_inserted integer;
  v_movement uuid;
begin
  if p_operation_id is null or p_actor is null or p_delta is null or p_delta=0
     or nullif(pg_catalog.btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'invalid adjustment';
  end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor and r.key='super_admin')
     and not exists(select 1 from public.user_branch_access where user_id=p_actor and branch_id=p_branch_id) then
    raise exception 'adjustment branch access denied';
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and status='active') then raise exception 'adjustment branch inactive'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object(
    'branchId',p_branch_id,'productId',p_product_id,'delta',p_delta,'reason',pg_catalog.btrim(p_reason),'actor',p_actor
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  insert into public.inventory_adjustment_operations(operation_id,actor_id,branch_id,product_id,quantity_delta,reason,request_fingerprint)
  values(p_operation_id,p_actor,p_branch_id,p_product_id,p_delta,pg_catalog.btrim(p_reason),v_fingerprint)
  on conflict(operation_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    select * into v_key from public.inventory_adjustment_operations where operation_id=p_operation_id for update;
    if v_key.actor_id<>p_actor or v_key.request_fingerprint<>v_fingerprint then raise exception 'operation id conflict'; end if;
    if v_key.movement_id is null then raise exception 'adjustment operation incomplete'; end if;
    return v_key.movement_id;
  end if;
  perform 1 from public.branch_products where branch_id=p_branch_id and product_id=p_product_id for update;
  if not found then raise exception 'stock row not found'; end if;
  update public.branch_products set quantity=quantity+p_delta,updated_at=now()
   where branch_id=p_branch_id and product_id=p_product_id and quantity+p_delta>=0;
  if not found then raise exception 'insufficient product stock'; end if;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
  values(p_branch_id,p_product_id,p_delta,'adjustment',p_operation_id,pg_catalog.btrim(p_reason),p_actor)
  returning id into v_movement;
  update public.inventory_adjustment_operations set movement_id=v_movement where operation_id=p_operation_id;
  return v_movement;
end;
$$;
revoke all on function public.adjust_stock_idempotent(uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.adjust_stock_idempotent(uuid,uuid,uuid,integer,text,uuid) to service_role;

-- A retry key may only ever identify one return globally, even if a client accidentally
-- reuses it for a different invoice.
do $$
begin
  if exists (
    select 1 from public.sale_returns
    where idempotency_key is not null
    group by idempotency_key having count(*)>1
  ) then
    raise exception 'duplicate legacy sale return idempotency keys require review before this migration can continue';
  end if;
end $$;
create unique index if not exists sale_returns_idempotency_key_global_idx
  on public.sale_returns(idempotency_key) where idempotency_key is not null;
