-- Two-phase inventory transfers: dispatch removes source stock; receipt adds destination stock.
alter table public.inventory_transfers
  add column if not exists operation_id uuid,
  add column if not exists request_fingerprint text,
  add column if not exists status text not null default 'received',
  add column if not exists source_cost_price numeric(12,2) not null default 0,
  add column if not exists source_reference_price numeric(12,2) not null default 0,
  add column if not exists dispatched_at timestamptz not null default now(),
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references auth.users(id) on delete set null;

update public.inventory_transfers t
set operation_id=coalesce(t.operation_id,gen_random_uuid()),
    source_cost_price=coalesce(bp.cost_price,0),
    source_reference_price=coalesce(bp.reference_price,0),
    received_at=coalesce(t.received_at,t.created_at)
from public.branch_products bp
where bp.branch_id=t.source_branch_id and bp.product_id=t.product_id
  and (t.operation_id is null or t.source_cost_price=0 or t.source_reference_price=0);
update public.inventory_transfers set operation_id=gen_random_uuid() where operation_id is null;
alter table public.inventory_transfers alter column operation_id set not null;
alter table public.inventory_transfers drop constraint if exists inventory_transfers_status_check;
alter table public.inventory_transfers add constraint inventory_transfers_status_check
  check (status in ('in_transit','received','cancelled'));
create unique index if not exists inventory_transfers_operation_id_idx on public.inventory_transfers(operation_id);
create index if not exists inventory_transfers_destination_status_idx
  on public.inventory_transfers(destination_branch_id,status,dispatched_at desc);

drop function if exists public.transfer_stock(uuid,uuid,uuid,integer,text,uuid);
create or replace function public.transfer_stock(
  p_source uuid,p_destination uuid,p_product uuid,p_quantity integer,p_reason text,p_actor uuid,p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer uuid;
  v_stock public.branch_products%rowtype;
  v_existing public.inventory_transfers%rowtype;
  v_fingerprint text;
begin
  if p_source=p_destination or p_quantity<1 or p_operation_id is null or nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'invalid transfer';
  end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',p_source,'destination',p_destination,'product',p_product,'quantity',p_quantity,'reason',trim(p_reason),'actor',p_actor
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.inventory_transfers where operation_id=p_operation_id;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint or v_existing.created_by<>p_actor then
      raise exception 'transfer operation id conflict';
    end if;
    return pg_catalog.jsonb_build_object('transferId',v_existing.id,'status',v_existing.status,'replayed',true);
  end if;

  perform 1 from public.branches where id in (p_source,p_destination) and status='active' order by id for update;
  if (select count(*) from public.branches where id in (p_source,p_destination) and status='active')<>2 then
    raise exception 'source or destination branch inactive';
  end if;
  select * into v_stock from public.branch_products
   where branch_id=p_source and product_id=p_product for update;
  if not found or v_stock.quantity<p_quantity then raise exception 'insufficient product stock'; end if;

  update public.branch_products set quantity=quantity-p_quantity,updated_at=now()
   where branch_id=p_source and product_id=p_product and quantity>=p_quantity;
  if not found then raise exception 'insufficient product stock'; end if;

  insert into public.inventory_transfers(
    operation_id,request_fingerprint,source_branch_id,destination_branch_id,product_id,quantity,reason,created_by,status,
    source_cost_price,source_reference_price,dispatched_at
  ) values (
    p_operation_id,v_fingerprint,p_source,p_destination,p_product,p_quantity,trim(p_reason),p_actor,'in_transit',
    v_stock.cost_price,v_stock.reference_price,now()
  ) returning id into v_transfer;

  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
  values(p_source,p_product,-p_quantity,'transfer_out',v_transfer,'إرسال تحويل مخزون: '||trim(p_reason),p_actor);

  return pg_catalog.jsonb_build_object('transferId',v_transfer,'status','in_transit','replayed',false);
end;
$$;

create or replace function public.receive_inventory_transfer(p_transfer uuid,p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
begin
  select * into v_transfer from public.inventory_transfers where id=p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if v_transfer.status='received' then
    return pg_catalog.jsonb_build_object('transferId',v_transfer.id,'status','received','replayed',true);
  end if;
  if v_transfer.status<>'in_transit' then raise exception 'transfer is not awaiting receipt'; end if;
  if v_transfer.destination_branch_id is null then raise exception 'transfer destination missing'; end if;

  perform 1 from public.branch_products
   where branch_id=v_transfer.destination_branch_id and product_id=v_transfer.product_id for update;
  insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity)
  values(v_transfer.destination_branch_id,v_transfer.product_id,v_transfer.source_cost_price,v_transfer.source_reference_price,v_transfer.quantity)
  on conflict(branch_id,product_id) do update
    set quantity=public.branch_products.quantity+excluded.quantity,
        cost_price=excluded.cost_price,
        reference_price=excluded.reference_price,
        updated_at=now();

  update public.inventory_transfers set status='received',received_at=now(),received_by=p_actor where id=p_transfer;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
  values(v_transfer.destination_branch_id,v_transfer.product_id,v_transfer.quantity,'transfer_in',p_transfer,'استلام تحويل مخزون',p_actor);
  return pg_catalog.jsonb_build_object('transferId',p_transfer,'status','received','replayed',false);
end;
$$;

revoke all on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid,uuid) to service_role;
revoke all on function public.receive_inventory_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.receive_inventory_transfer(uuid,uuid) to service_role;
