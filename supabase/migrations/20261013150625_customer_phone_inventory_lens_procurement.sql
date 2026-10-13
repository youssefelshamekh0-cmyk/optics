-- Customer records are global. Phone numbers are normalized by the app and unique when present.
update public.customers
set phone = '+20' || case
  when length(digits) = 11 and left(digits, 1) = '0' then substr(digits, 2)
  when length(digits) = 12 and left(digits, 2) = '20' then substr(digits, 3)
  when length(digits) = 10 and left(digits, 1) = '1' then digits
  else digits
end
from (
  select id, regexp_replace(translate(phone, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '\D', '', 'g') digits
  from public.customers where phone is not null and btrim(phone) <> ''
) normalized
where public.customers.id = normalized.id
  and normalized.digits ~ '^(0?1[0125][0-9]{8}|20?1[0125][0-9]{8})$';

create unique index customers_phone_unique_idx on public.customers(phone) where phone is not null;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku varchar(80) unique,
  name varchar(160) not null check (length(trim(name)) >= 2),
  category varchar(40) not null check (category in ('frame','lens','accessory','other')),
  brand varchar(100),
  model varchar(100),
  color varchar(60),
  size varchar(60),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branch_products (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  reference_price numeric(12,2) not null default 0 check (reference_price >= 0),
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (branch_id, product_id)
);
create index branch_products_branch_idx on public.branch_products(branch_id);
create index branch_products_product_idx on public.branch_products(product_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  movement_type varchar(30) not null check (movement_type in ('opening','purchase','adjustment','sale','return','transfer_in','transfer_out')),
  reference_id uuid,
  reason varchar(300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index stock_movements_branch_product_time_idx on public.stock_movements(branch_id, product_id, created_at desc);

create table public.lens_companies (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.lens_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.lens_companies(id) on delete restrict,
  name varchar(120) not null,
  category varchar(80) not null default 'طبي',
  specifications jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
create table public.branch_lens_prices (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  lens_type_id uuid not null references public.lens_types(id) on delete restrict,
  sphere_min numeric(5,2) not null,
  sphere_max numeric(5,2) not null,
  cylinder_min numeric(5,2),
  cylinder_max numeric(5,2),
  options varchar(300) not null default '',
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  reference_price numeric(12,2) not null check (reference_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint lens_sphere_range_valid check (sphere_min <= sphere_max),
  constraint lens_cylinder_range_valid check ((cylinder_min is null and cylinder_max is null) or (cylinder_min is not null and cylinder_max is not null and cylinder_min <= cylinder_max))
);
create index branch_lens_prices_lookup_idx on public.branch_lens_prices(branch_id, lens_type_id, sphere_min, sphere_max) where active;
create or replace function public.prevent_lens_price_overlap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.branch_lens_prices p
    where p.active and p.id is distinct from new.id
      and p.branch_id = new.branch_id and p.lens_type_id = new.lens_type_id and p.options = new.options
      and p.sphere_min <= new.sphere_max and p.sphere_max >= new.sphere_min
      and (p.cylinder_min is null or new.cylinder_min is null or (p.cylinder_min <= new.cylinder_max and p.cylinder_max >= new.cylinder_min))
  ) then raise exception 'overlapping lens price range'; end if;
  return new;
end;
$$;
create trigger lens_price_overlap_guard before insert or update on public.branch_lens_prices
for each row execute function public.prevent_lens_price_overlap();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name varchar(160) not null unique,
  phone varchar(40),
  address varchar(300),
  notes varchar(1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.lens_supplies (
  id uuid primary key default gen_random_uuid(),
  invoice_number varchar(100) not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  received_at timestamptz not null default now(),
  total_cost numeric(12,2) not null check (total_cost >= 0),
  status varchar(20) not null default 'received' check (status in ('received')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (supplier_id, invoice_number)
);
create index lens_supplies_branch_date_idx on public.lens_supplies(branch_id, received_at desc);
create table public.lens_supply_items (
  id uuid primary key default gen_random_uuid(),
  supply_id uuid not null references public.lens_supplies(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_total numeric(12,2) generated always as (quantity * unit_cost) stored
);
create index lens_supply_items_supply_idx on public.lens_supply_items(supply_id);

alter table public.products enable row level security;
alter table public.branch_products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.lens_companies enable row level security;
alter table public.lens_types enable row level security;
alter table public.branch_lens_prices enable row level security;
alter table public.suppliers enable row level security;
alter table public.lens_supplies enable row level security;
alter table public.lens_supply_items enable row level security;
revoke all on public.products, public.branch_products, public.stock_movements, public.lens_companies, public.lens_types, public.branch_lens_prices, public.suppliers, public.lens_supplies, public.lens_supply_items from anon, authenticated;
grant all on public.products, public.branch_products, public.stock_movements, public.lens_companies, public.lens_types, public.branch_lens_prices, public.suppliers, public.lens_supplies, public.lens_supply_items to service_role;

create or replace function public.create_optics_product(
  p_sku text, p_name text, p_category text, p_brand text, p_model text, p_color text, p_size text,
  p_branch_id uuid, p_quantity integer, p_cost_price numeric, p_reference_price numeric, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_product_id uuid;
begin
  if p_quantity < 0 or p_cost_price < 0 or p_reference_price < 0 then raise exception 'invalid product values'; end if;
  insert into public.products(sku,name,category,brand,model,color,size,created_by)
  values(nullif(trim(p_sku),''),trim(p_name),p_category,nullif(trim(p_brand),''),nullif(trim(p_model),''),nullif(trim(p_color),''),nullif(trim(p_size),''),p_created_by)
  returning id into v_product_id;
  insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity)
  values(p_branch_id,v_product_id,p_cost_price,p_reference_price,p_quantity);
  if p_quantity > 0 then
    insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reason,created_by)
    values(p_branch_id,v_product_id,p_quantity,'opening','رصيد بداية المخزون',p_created_by);
  end if;
  return v_product_id;
end;
$$;

create or replace function public.receive_lens_supply(
  p_invoice_number text, p_supplier_name text, p_supplier_phone text, p_branch_id uuid,
  p_received_at timestamptz, p_items jsonb, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_supplier_id uuid; v_supply_id uuid; v_total numeric(12,2); v_item jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'supply needs items'; end if;
  insert into public.suppliers(name,phone) values(trim(p_supplier_name),nullif(trim(p_supplier_phone),''))
  on conflict (name) do update set phone = coalesce(excluded.phone, public.suppliers.phone)
  returning id into v_supplier_id;
  select sum((value->>'quantity')::integer * (value->>'unitCost')::numeric) into v_total from jsonb_array_elements(p_items);
  insert into public.lens_supplies(invoice_number,supplier_id,branch_id,received_at,total_cost,created_by)
  values(trim(p_invoice_number),v_supplier_id,p_branch_id,p_received_at,v_total,p_created_by) returning id into v_supply_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.lens_supply_items(supply_id,product_id,quantity,unit_cost)
    values(v_supply_id,(v_item->>'productId')::uuid,(v_item->>'quantity')::integer,(v_item->>'unitCost')::numeric);
    insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity)
    values(p_branch_id,(v_item->>'productId')::uuid,(v_item->>'unitCost')::numeric,0,(v_item->>'quantity')::integer)
    on conflict (branch_id,product_id) do update set quantity = public.branch_products.quantity + excluded.quantity, cost_price = excluded.cost_price, updated_at = now();
    insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
    values(p_branch_id,(v_item->>'productId')::uuid,(v_item->>'quantity')::integer,'purchase',v_supply_id,'استلام توريد '||trim(p_invoice_number),p_created_by);
  end loop;
  return v_supply_id;
end;
$$;
revoke all on function public.create_optics_product(text,text,text,text,text,text,text,uuid,integer,numeric,numeric,uuid) from public, anon, authenticated;
grant execute on function public.create_optics_product(text,text,text,text,text,text,text,uuid,integer,numeric,numeric,uuid) to service_role;
revoke all on function public.receive_lens_supply(text,text,text,uuid,timestamptz,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.receive_lens_supply(text,text,text,uuid,timestamptz,jsonb,uuid) to service_role;
