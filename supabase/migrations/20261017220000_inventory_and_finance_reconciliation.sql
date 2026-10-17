-- Comprehensive operational integrity: retry-safe transfers, physical stock counts,
-- and idempotent cash reconciliation. Keep on the feature branch until isolated staging validation.
alter table public.inventory_transfers
  add column if not exists operation_id uuid,
  add column if not exists request_fingerprint text,
  add column if not exists status text not null default 'received',
  add column if not exists dispatched_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists received_by uuid references auth.users(id) on delete set null;

alter table public.inventory_transfers drop constraint if exists inventory_transfers_status_check;
alter table public.inventory_transfers add constraint inventory_transfers_status_check
  check (status in ('in_transit','received','cancelled'));
create unique index if not exists inventory_transfers_operation_id_unique
  on public.inventory_transfers(operation_id) where operation_id is not null;
create index if not exists inventory_transfers_destination_status_idx
  on public.inventory_transfers(destination_branch_id,status,dispatched_at desc);

create table if not exists public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  expected_balance numeric(14,2) not null,
  counted_balance numeric(14,2) not null check (counted_balance >= 0),
  difference numeric(14,2) not null,
  notes varchar(500),
  request_fingerprint text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists cash_reconciliations_account_created_idx
  on public.cash_reconciliations(cash_account_id,created_at desc);
alter table public.cash_reconciliations enable row level security;
revoke all on table public.cash_reconciliations from public,anon,authenticated;
grant all on table public.cash_reconciliations to service_role;

create table if not exists public.inventory_stock_counts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  branch_id uuid not null references public.branches(id) on delete restrict,
  status text not null default 'completed' check (status in ('completed')),
  notes varchar(500),
  request_fingerprint text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.inventory_stock_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_stock_counts(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer not null check (counted_quantity >= 0),
  quantity_delta integer not null,
  cost_price_snapshot numeric(12,2) not null default 0 check (cost_price_snapshot >= 0),
  unique(count_id,product_id)
);
create index if not exists inventory_stock_counts_branch_created_idx
  on public.inventory_stock_counts(branch_id,created_at desc);
alter table public.inventory_stock_counts enable row level security;
alter table public.inventory_stock_count_items enable row level security;
revoke all on table public.inventory_stock_counts,public.inventory_stock_count_items from public,anon,authenticated;
grant all on table public.inventory_stock_counts,public.inventory_stock_count_items to service_role;

create or replace function public.record_cash_reconciliation(
  p_operation_id uuid,p_cash_account_id uuid,p_counted_balance numeric,p_actor uuid,p_notes text
) returns table(id uuid,expected_balance numeric,counted_balance numeric,difference numeric)
language plpgsql security definer set search_path = ''
as $$
declare
  v_expected numeric(14,2);
  v_fingerprint text;
  v_existing public.cash_reconciliations%rowtype;
  v_id uuid;
begin
  if p_operation_id is null or p_actor is null or p_counted_balance is null or p_counted_balance < 0 then
    raise exception 'invalid cash reconciliation';
  end if;
  if not exists (
    select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=p_actor and r.key='super_admin'
  ) then raise exception 'owner-only cash reconciliation'; end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.concat_ws('|',p_cash_account_id::text,round(p_counted_balance,2)::text,pg_catalog.btrim(coalesce(p_notes,''))));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.cash_reconciliations where operation_id=p_operation_id for update;
  if found then
    if v_existing.created_by<>p_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'operation id conflict';
    end if;
    return query select v_existing.id,v_existing.expected_balance,v_existing.counted_balance,v_existing.difference;
    return;
  end if;
  perform 1 from public.cash_accounts ca where ca.id=p_cash_account_id and ca.active for update;
  if not found then raise exception 'cash account not found or inactive'; end if;
  v_expected:=round(public.cash_account_balance(p_cash_account_id),2);
  insert into public.cash_reconciliations(operation_id,cash_account_id,expected_balance,counted_balance,difference,notes,request_fingerprint,created_by)
  values(p_operation_id,p_cash_account_id,v_expected,round(p_counted_balance,2),round(p_counted_balance-v_expected,2),nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),v_fingerprint,p_actor)
  returning cash_reconciliations.id into v_id;
  return query select v_id,v_expected,round(p_counted_balance,2),round(p_counted_balance-v_expected,2);
end;
$$;
revoke all on function public.record_cash_reconciliation(uuid,uuid,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.record_cash_reconciliation(uuid,uuid,numeric,uuid,text) to service_role;

create or replace function public.transfer_stock(
  p_source uuid,p_destination uuid,p_product uuid,p_quantity integer,p_reason text,p_actor uuid,p_operation_id uuid
) returns table("transferId" uuid,status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.inventory_transfers%rowtype;
  v_source_cost numeric(12,2);
  v_source_price numeric(12,2);
  v_source_qty integer;
  v_fingerprint text;
  v_id uuid;
begin
  if p_operation_id is null or p_actor is null or p_source=p_destination or p_quantity is null or p_quantity<1
     or nullif(pg_catalog.btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'invalid transfer';
  end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor and r.key='super_admin') then
    if not exists(select 1 from public.user_branch_access where user_id=p_actor and branch_id=p_source)
       or not exists(select 1 from public.user_branch_access where user_id=p_actor and branch_id=p_destination) then
      raise exception 'transfer branch access denied';
    end if;
  end if;
  v_fingerprint:=pg_catalog.md5(pg_catalog.concat_ws('|',p_source::text,p_destination::text,p_product::text,p_quantity::text,pg_catalog.btrim(p_reason)));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.inventory_transfers where operation_id=p_operation_id for update;
  if found then
    if v_existing.created_by<>p_actor or v_existing.request_fingerprint<>v_fingerprint then raise exception 'operation id conflict'; end if;
    return query select v_existing.id,v_existing.status;
    return;
  end if;
  if not exists(select 1 from public.branches where id=p_source and status='active')
     or not exists(select 1 from public.branches where id=p_destination and status='active') then
    raise exception 'invalid transfer branch';
  end if;
  perform 1 from public.branch_products where branch_id in (p_source,p_destination) and product_id=p_product order by branch_id for update;
  select quantity,cost_price,reference_price into v_source_qty,v_source_cost,v_source_price
    from public.branch_products where branch_id=p_source and product_id=p_product for update;
  if not found or v_source_qty<p_quantity then raise exception 'insufficient product stock'; end if;
  update public.branch_products set quantity=quantity-p_quantity,updated_at=now()
    where branch_id=p_source and product_id=p_product;
  insert into public.inventory_transfers(source_branch_id,destination_branch_id,product_id,quantity,reason,created_by,operation_id,request_fingerprint,status,dispatched_at)
  values(p_source,p_destination,p_product,p_quantity,pg_catalog.btrim(p_reason),p_actor,p_operation_id,v_fingerprint,'in_transit',now())
  returning id into v_id;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
  values(p_source,p_product,-p_quantity,'transfer_out',v_id,'إرسال إلى فرع آخر: '||pg_catalog.btrim(p_reason),p_actor);
  return query select v_id,'in_transit'::text;
end;
$$;
revoke all on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid,uuid) to service_role;

-- Keep legacy internal callers on the same safe dispatch/receive lifecycle.
create or replace function public.transfer_stock(p_source uuid,p_destination uuid,p_product uuid,p_quantity integer,p_reason text,p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  select t."transferId" into v_id
  from public.transfer_stock(p_source,p_destination,p_product,p_quantity,p_reason,p_actor,pg_catalog.gen_random_uuid()) t;
  return v_id;
end;
$$;
revoke all on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.transfer_stock(uuid,uuid,uuid,integer,text,uuid) to service_role;

create or replace function public.receive_inventory_transfer(p_transfer uuid,p_actor uuid)
returns table("transferId" uuid,status text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_cost numeric(12,2);
  v_price numeric(12,2);
begin
  if p_actor is null then raise exception 'actor required'; end if;
  select * into v_transfer from public.inventory_transfers where id=p_transfer for update;
  if not found then raise exception 'transfer not found'; end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor and r.key='super_admin') then
    if not exists(select 1 from public.user_branch_access where user_id=p_actor and branch_id=v_transfer.destination_branch_id) then
      raise exception 'transfer destination access denied';
    end if;
  end if;
  if v_transfer.status='received' then
    return query select v_transfer.id,v_transfer.status;
    return;
  end if;
  if v_transfer.status<>'in_transit' then raise exception 'not awaiting receipt'; end if;
  select cost_price,reference_price into v_cost,v_price
    from public.branch_products where branch_id=v_transfer.source_branch_id and product_id=v_transfer.product_id;
  if not found then raise exception 'source stock row missing'; end if;
  insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity)
  values(v_transfer.destination_branch_id,v_transfer.product_id,v_cost,v_price,0)
  on conflict(branch_id,product_id) do nothing;
  perform 1 from public.branch_products where branch_id=v_transfer.destination_branch_id and product_id=v_transfer.product_id for update;
  update public.branch_products set quantity=quantity+v_transfer.quantity,updated_at=now()
    where branch_id=v_transfer.destination_branch_id and product_id=v_transfer.product_id;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
  values(v_transfer.destination_branch_id,v_transfer.product_id,v_transfer.quantity,'transfer_in',v_transfer.id,'استلام تحويل من فرع آخر',p_actor);
  update public.inventory_transfers set status='received',received_at=now(),received_by=p_actor where id=p_transfer;
  return query select p_transfer,'received'::text;
end;
$$;
revoke all on function public.receive_inventory_transfer(uuid,uuid) from public,anon,authenticated;
grant execute on function public.receive_inventory_transfer(uuid,uuid) to service_role;

create or replace function public.record_inventory_stock_count(
  p_operation_id uuid,p_branch_id uuid,p_items jsonb,p_actor uuid,p_notes text
) returns table(count_id uuid,items_count integer,adjusted_items integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_item jsonb;
  v_product uuid;
  v_counted integer;
  v_expected integer;
  v_delta integer;
  v_cost numeric(12,2);
  v_fingerprint text;
  v_existing public.inventory_stock_counts%rowtype;
  v_count_id uuid;
  v_items_count integer:=0;
  v_adjusted integer:=0;
begin
  if p_operation_id is null or p_branch_id is null or p_actor is null or p_items is null or jsonb_typeof(p_items)<>'array'
     or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>500 then raise exception 'invalid stock count'; end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_actor and r.key='super_admin') then
    raise exception 'owner-only stock count';
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and status='active') then raise exception 'invalid branch'; end if;
  if (select count(*) from jsonb_array_elements(p_items))<>(select count(distinct value->>'productId') from jsonb_array_elements(p_items)) then raise exception 'duplicate product in stock count'; end if;
  v_fingerprint:=pg_catalog.md5(p_branch_id::text||':'||p_items::text||':'||pg_catalog.btrim(coalesce(p_notes,'')));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.inventory_stock_counts where operation_id=p_operation_id for update;
  if found then
    if v_existing.created_by<>p_actor or v_existing.request_fingerprint<>v_fingerprint then raise exception 'operation id conflict'; end if;
    return query select v_existing.id,(select count(*)::integer from public.inventory_stock_count_items where count_id=v_existing.id),
      (select count(*)::integer from public.inventory_stock_count_items where count_id=v_existing.id and quantity_delta<>0);
    return;
  end if;
  insert into public.inventory_stock_counts(operation_id,branch_id,notes,request_fingerprint,created_by)
  values(p_operation_id,p_branch_id,nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),v_fingerprint,p_actor)
  returning id into v_count_id;
  for v_item in select value from jsonb_array_elements(p_items) order by value->>'productId' loop
    begin
      v_product:=(v_item->>'productId')::uuid;
      v_counted:=(v_item->>'countedQuantity')::integer;
    exception when others then raise exception 'invalid stock count item'; end;
    if v_counted is null or v_counted<0 then raise exception 'invalid counted quantity'; end if;
    select quantity,cost_price into v_expected,v_cost from public.branch_products
      where branch_id=p_branch_id and product_id=v_product for update;
    if not found then raise exception 'product not stocked in branch'; end if;
    v_delta:=v_counted-v_expected;
    insert into public.inventory_stock_count_items(count_id,product_id,expected_quantity,counted_quantity,quantity_delta,cost_price_snapshot)
    values(v_count_id,v_product,v_expected,v_counted,v_delta,v_cost);
    if v_delta<>0 then
      update public.branch_products set quantity=v_counted,updated_at=now() where branch_id=p_branch_id and product_id=v_product;
      insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
      values(p_branch_id,v_product,v_delta,'adjustment',v_count_id,'تسوية جرد فعلي',p_actor);
      v_adjusted:=v_adjusted+1;
    end if;
    v_items_count:=v_items_count+1;
  end loop;
  return query select v_count_id,v_items_count,v_adjusted;
end;
$$;
revoke all on function public.record_inventory_stock_count(uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.record_inventory_stock_count(uuid,uuid,jsonb,uuid,text) to service_role;
