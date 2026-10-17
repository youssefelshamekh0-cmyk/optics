-- Receiving customer-ordered prescription lenses against a supplier invoice.
-- Each prescription lens line on a sale (sale_items.item_kind = 'prescription_lens') is one order to the lens company.
alter table public.sale_items add column if not exists lens_received_at timestamptz;
alter table public.sale_items add column if not exists lens_supply_id uuid references public.lens_supplies(id) on delete set null;
alter table public.lens_supply_items add column if not exists sale_item_id uuid references public.sale_items(id) on delete set null;

create index if not exists sale_items_pending_lens_idx on public.sale_items(sale_id) where item_kind = 'prescription_lens' and lens_received_at is null;
create index if not exists sale_items_lens_supply_idx on public.sale_items(lens_supply_id) where lens_supply_id is not null;
create index if not exists lens_supply_items_sale_item_idx on public.lens_supply_items(sale_item_id) where sale_item_id is not null;

-- Records the supplier invoice and marks the chosen ordered lenses as received.
-- Lenses cut for a specific customer never enter branch stock, so stock is deliberately untouched.
create or replace function public.receive_ordered_lenses(
  p_invoice_number text, p_supplier_name text, p_supplier_phone text, p_branch_id uuid,
  p_received_at timestamptz, p_items jsonb, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_supplier_id uuid; v_supply_id uuid; v_total numeric(12,2); v_item jsonb; v_ok integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'supply needs items'; end if;
  -- Lock the chosen lines and make sure every one is still an unreceived lens order of this branch.
  select count(*) into v_ok from public.sale_items si join public.sales s on s.id = si.sale_id
  where si.id in (select (value->>'saleItemId')::uuid from jsonb_array_elements(p_items))
    and si.item_kind = 'prescription_lens' and si.lens_received_at is null
    and s.branch_id = p_branch_id and s.delivery_status <> 'cancelled';
  if v_ok <> jsonb_array_length(p_items) then raise exception 'lens item unavailable'; end if;
  perform 1 from public.sale_items where id in (select (value->>'saleItemId')::uuid from jsonb_array_elements(p_items)) for update;
  insert into public.suppliers(name,phone) values(trim(p_supplier_name),nullif(trim(p_supplier_phone),''))
  on conflict (name) do update set phone = coalesce(excluded.phone, public.suppliers.phone)
  returning id into v_supplier_id;
  select sum((value->>'unitCost')::numeric) into v_total from jsonb_array_elements(p_items);
  insert into public.lens_supplies(invoice_number,supplier_id,branch_id,received_at,total_cost,created_by)
  values(trim(p_invoice_number),v_supplier_id,p_branch_id,p_received_at,v_total,p_created_by) returning id into v_supply_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.lens_supply_items(supply_id,product_id,quantity,unit_cost,sale_item_id)
    values(v_supply_id,(v_item->>'productId')::uuid,1,(v_item->>'unitCost')::numeric,(v_item->>'saleItemId')::uuid);
    update public.sale_items set lens_received_at = p_received_at, lens_supply_id = v_supply_id where id = (v_item->>'saleItemId')::uuid;
  end loop;
  return v_supply_id;
end;
$$;
revoke all on function public.receive_ordered_lenses(text,text,text,uuid,timestamptz,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.receive_ordered_lenses(text,text,text,uuid,timestamptz,jsonb,uuid) to service_role;
