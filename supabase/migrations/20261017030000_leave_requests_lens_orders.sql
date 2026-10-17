-- 1) Leave / permission requests submitted by employees and reviewed by the owner.
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  request_type text not null check (request_type in ('leave','permission')),
  start_date date not null,
  end_date date not null,
  start_time time,
  end_time time,
  reason varchar(500),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note varchar(500),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (request_type = 'leave' or (start_date = end_date and start_time is not null and end_time is not null and end_time > start_time))
);
create index leave_requests_user_time_idx on public.leave_requests(user_id, created_at desc);
create index leave_requests_status_idx on public.leave_requests(status, created_at);
create index leave_requests_branch_idx on public.leave_requests(branch_id);
create index leave_requests_employee_idx on public.leave_requests(employee_id);
create index leave_requests_decided_by_idx on public.leave_requests(decided_by);
alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon, authenticated;
grant all on public.leave_requests to service_role;

-- 2) Lenses ordered for a customer's invoice must be received from the lens company before they are ready.
alter table public.sale_items add column supply_status varchar(20) check (supply_status in ('pending','received'));
alter table public.sale_items add column lens_supply_id uuid references public.lens_supplies(id) on delete set null;
alter table public.sale_items add column supplied_at timestamptz;
create index sale_items_pending_lens_idx on public.sale_items(supply_status) where supply_status = 'pending';
create index sale_items_lens_supply_idx on public.sale_items(lens_supply_id);

-- Existing prescription lenses on invoices that are still being prepared count as awaiting supply; older ones as received.
update public.sale_items si
set supply_status = case when s.delivery_status in ('pending','processing') then 'pending' else 'received' end
from public.sales s
where s.id = si.sale_id and si.item_kind = 'prescription_lens';

create or replace function public.set_lens_supply_status() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.item_kind = 'prescription_lens' and new.supply_status is null then new.supply_status := 'pending'; end if;
  return new;
end;
$$;
create trigger sale_items_lens_supply_status before insert on public.sale_items
for each row execute function public.set_lens_supply_status();

alter table public.lens_supply_items alter column product_id drop not null;
alter table public.lens_supply_items add column sale_item_id uuid references public.sale_items(id) on delete restrict;
alter table public.lens_supply_items add column item_name varchar(200);
alter table public.lens_supply_items add constraint lens_supply_items_target_check check (product_id is not null or sale_item_id is not null);
create unique index lens_supply_items_sale_item_unique on public.lens_supply_items(sale_item_id) where sale_item_id is not null;

-- Completes one supplier invoice: stock lenses (p_items) and/or customer-ordered lenses that arrived (p_requirements).
create or replace function public.receive_lens_order(
  p_invoice_number text, p_supplier_name text, p_supplier_phone text, p_branch_id uuid,
  p_received_at timestamptz, p_items jsonb, p_requirements jsonb, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_supplier_id uuid; v_supply_id uuid; v_total numeric(12,2); v_item jsonb;
  v_sale_item uuid; v_cost numeric(12,2); v_name text;
begin
  p_items := coalesce(p_items, '[]'::jsonb);
  p_requirements := coalesce(p_requirements, '[]'::jsonb);
  if jsonb_typeof(p_items) <> 'array' or jsonb_typeof(p_requirements) <> 'array'
     or jsonb_array_length(p_items) + jsonb_array_length(p_requirements) = 0 then
    raise exception 'supply needs items';
  end if;
  select coalesce(sum((value->>'quantity')::integer * (value->>'unitCost')::numeric), 0) into v_total from jsonb_array_elements(p_items);
  v_total := v_total + coalesce((select sum((value->>'unitCost')::numeric) from jsonb_array_elements(p_requirements)), 0);

  insert into public.suppliers(name, phone) values(trim(p_supplier_name), nullif(trim(p_supplier_phone), ''))
  on conflict (name) do update set phone = coalesce(excluded.phone, public.suppliers.phone)
  returning id into v_supplier_id;
  insert into public.lens_supplies(invoice_number, supplier_id, branch_id, received_at, total_cost, created_by)
  values(trim(p_invoice_number), v_supplier_id, p_branch_id, p_received_at, v_total, p_created_by) returning id into v_supply_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.lens_supply_items(supply_id, product_id, quantity, unit_cost)
    values(v_supply_id, (v_item->>'productId')::uuid, (v_item->>'quantity')::integer, (v_item->>'unitCost')::numeric);
    insert into public.branch_products(branch_id, product_id, cost_price, quantity)
    values(p_branch_id, (v_item->>'productId')::uuid, (v_item->>'unitCost')::numeric, (v_item->>'quantity')::integer)
    on conflict (branch_id, product_id) do update set quantity = public.branch_products.quantity + excluded.quantity, cost_price = excluded.cost_price, updated_at = now();
    insert into public.stock_movements(branch_id, product_id, quantity_delta, movement_type, reference_id, reason, created_by)
    values(p_branch_id, (v_item->>'productId')::uuid, (v_item->>'quantity')::integer, 'purchase', v_supply_id, 'استلام توريد ' || trim(p_invoice_number), p_created_by);
  end loop;

  for v_item in select value from jsonb_array_elements(p_requirements) loop
    v_sale_item := (v_item->>'saleItemId')::uuid;
    v_cost := (v_item->>'unitCost')::numeric;
    if v_cost < 0 then raise exception 'invalid cost'; end if;
    select si.item_name into v_name
    from public.sale_items si join public.sales s on s.id = si.sale_id
    where si.id = v_sale_item and si.item_kind = 'prescription_lens' and si.supply_status = 'pending'
      and s.branch_id = p_branch_id and s.delivery_status <> 'cancelled'
    for update of si;
    if not found then raise exception 'lens requirement not available'; end if;
    insert into public.lens_supply_items(supply_id, sale_item_id, item_name, quantity, unit_cost)
    values(v_supply_id, v_sale_item, v_name, 1, v_cost);
    update public.sale_items set supply_status = 'received', lens_supply_id = v_supply_id, supplied_at = p_received_at where id = v_sale_item;
  end loop;
  return v_supply_id;
end;
$$;
revoke all on function public.receive_lens_order(text, text, text, uuid, timestamptz, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.receive_lens_order(text, text, text, uuid, timestamptz, jsonb, jsonb, uuid) to service_role;
