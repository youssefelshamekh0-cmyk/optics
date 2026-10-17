-- Stock take workflow and low-stock thresholds. Apply only after staging validation.
alter table public.branch_products
  add column if not exists low_stock_threshold integer not null default 3
  check (low_stock_threshold between 0 and 100000);

create table if not exists public.stock_takes (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  branch_id uuid not null references public.branches(id) on delete restrict,
  request_fingerprint text not null,
  notes varchar(500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_takes_branch_created_idx on public.stock_takes(branch_id,created_at desc);

create table if not exists public.stock_take_items (
  id uuid primary key default gen_random_uuid(),
  stock_take_id uuid not null references public.stock_takes(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  expected_quantity integer not null check (expected_quantity >= 0),
  counted_quantity integer not null check (counted_quantity >= 0),
  quantity_delta integer generated always as (counted_quantity - expected_quantity) stored,
  unique(stock_take_id,product_id)
);
create index if not exists stock_take_items_product_idx on public.stock_take_items(branch_id,product_id,stock_take_id desc);

alter table public.stock_takes enable row level security;
alter table public.stock_take_items enable row level security;
revoke all on public.stock_takes,public.stock_take_items from public,anon,authenticated;
grant all on public.stock_takes,public.stock_take_items to service_role;

create or replace function public.commit_stock_take(
  p_operation_id uuid,
  p_branch_id uuid,
  p_actor uuid,
  p_counts jsonb,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.stock_takes%rowtype;
  v_fingerprint text;
  v_take_id uuid;
  v_item jsonb;
  v_product uuid;
  v_count integer;
  v_expected integer;
  v_delta integer;
  v_counted integer := 0;
  v_adjusted integer := 0;
  v_changes jsonb := '[]'::jsonb;
begin
  if p_operation_id is null or p_branch_id is null or p_actor is null
     or jsonb_typeof(p_counts) <> 'array' or jsonb_array_length(p_counts) < 1
     or jsonb_array_length(p_counts) > 500 then
    raise exception 'invalid stock take request';
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and status='active') then
    raise exception 'stock take branch inactive';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object('branchId',p_branch_id,'counts',p_counts,'notes',trim(coalesce(p_notes,'')))::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.stock_takes where operation_id=p_operation_id;
  if found then
    if v_existing.branch_id<>p_branch_id or v_existing.created_by<>p_actor or v_existing.request_fingerprint<>v_fingerprint then
      raise exception 'stock take operation id conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'stockTakeId',v_existing.id,'replayed',true,
      'countedItems',(select count(*) from public.stock_take_items where stock_take_id=v_existing.id),
      'adjustedItems',(select count(*) from public.stock_take_items where stock_take_id=v_existing.id and quantity_delta<>0)
    );
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_counts) x
    group by x.value->>'productId' having count(*) > 1
  ) then raise exception 'duplicate product in stock take'; end if;

  -- Lock all stock rows in stable order, then capture and apply the count atomically.
  perform 1
    from public.branch_products bp
   where bp.branch_id=p_branch_id
     and bp.product_id in (
       select (x.value->>'productId')::uuid
       from jsonb_array_elements(p_counts) x
     )
   order by bp.product_id
   for update;

  insert into public.stock_takes(operation_id,branch_id,request_fingerprint,notes,created_by)
  values(p_operation_id,p_branch_id,v_fingerprint,nullif(trim(coalesce(p_notes,'')),''),p_actor)
  returning id into v_take_id;

  for v_item in
    select value from jsonb_array_elements(p_counts)
    order by value->>'productId'
  loop
    begin
      v_product := (v_item->>'productId')::uuid;
      v_count := (v_item->>'countedQuantity')::integer;
    exception when others then raise exception 'invalid stock count item'; end;
    if v_product is null or v_count is null or v_count < 0 or v_count > 100000 then
      raise exception 'invalid stock count item';
    end if;

    select bp.quantity into v_expected from public.branch_products bp
     where bp.branch_id=p_branch_id and bp.product_id=v_product for update;
    if not found then raise exception 'stock row missing for counted product'; end if;

    v_delta := v_count-v_expected;
    insert into public.stock_take_items(stock_take_id,branch_id,product_id,expected_quantity,counted_quantity)
    values(v_take_id,p_branch_id,v_product,v_expected,v_count);

    if v_delta<>0 then
      update public.branch_products set quantity=v_count,updated_at=now()
       where branch_id=p_branch_id and product_id=v_product;
      insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
      values(p_branch_id,v_product,v_delta,'adjustment',v_take_id,
        'تسوية جرد مخزون: من '||v_expected::text||' إلى '||v_count::text,p_actor);
      v_adjusted:=v_adjusted+1;
    end if;
    v_counted:=v_counted+1;
    v_changes:=v_changes||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'productId',v_product,'expectedQuantity',v_expected,'countedQuantity',v_count,'delta',v_delta
    ));
  end loop;

  return pg_catalog.jsonb_build_object(
    'stockTakeId',v_take_id,'branchId',p_branch_id,'countedItems',v_counted,
    'adjustedItems',v_adjusted,'changes',v_changes,'replayed',false
  );
end;
$$;

revoke all on function public.commit_stock_take(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_stock_take(uuid,uuid,uuid,jsonb,text) to service_role;
