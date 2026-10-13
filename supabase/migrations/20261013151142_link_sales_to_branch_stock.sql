alter table public.sale_items add column product_id uuid references public.products(id) on delete restrict;
create index sale_items_product_idx on public.sale_items(product_id) where product_id is not null;

create or replace function public.create_optics_sale(
  p_branch_id uuid, p_customer_id uuid, p_created_by uuid, p_discount numeric, p_items jsonb,
  p_prescription jsonb, p_initial_payment numeric, p_payment_method text, p_notes text
) returns table (sale_id uuid, invoice_number bigint)
language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb; v_name text; v_quantity integer; v_unit_price numeric(12,2); v_product_id uuid;
  v_stock integer; v_total numeric(12,2) := 0; v_grand_total numeric(12,2); v_sale_id uuid; v_invoice_number bigint;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'sale requires between 1 and 20 items'; end if;
  for v_item in select value from jsonb_array_elements(p_items) as item_rows(value) loop
    begin
      v_name := trim(v_item->>'name'); v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := round((v_item->>'unitPrice')::numeric, 2);
      v_product_id := nullif(v_item->>'productId','')::uuid;
    exception when others then raise exception 'invalid sale item'; end;
    if length(v_name) < 2 or length(v_name) > 160 or v_quantity not between 1 and 100 or v_unit_price <= 0 then raise exception 'invalid sale item'; end if;
    if v_product_id is not null then
      select bp.quantity into v_stock from public.branch_products bp where bp.branch_id = p_branch_id and bp.product_id = v_product_id for update;
      if not found or v_stock < v_quantity then raise exception 'insufficient product stock'; end if;
    end if;
    v_total := v_total + (v_quantity * v_unit_price);
  end loop;
  if p_discount is null or p_discount < 0 or p_discount > v_total then raise exception 'invalid discount'; end if;
  v_grand_total := v_total - p_discount;
  if p_initial_payment is null or p_initial_payment < 0 or p_initial_payment > v_grand_total then raise exception 'invalid initial payment'; end if;
  if p_initial_payment > 0 and p_payment_method not in ('cash','card','instapay','other') then raise exception 'invalid payment method'; end if;

  insert into public.sales(branch_id,customer_id,created_by,total_amount,discount_amount,prescription,notes)
  values(p_branch_id,p_customer_id,p_created_by,v_total,p_discount,coalesce(p_prescription,'{}'::jsonb),nullif(trim(p_notes),''))
  returning id, public.sales.invoice_number into v_sale_id, v_invoice_number;

  for v_item in select value from jsonb_array_elements(p_items) as item_rows(value) loop
    v_quantity := (v_item->>'quantity')::integer; v_product_id := nullif(v_item->>'productId','')::uuid;
    insert into public.sale_items(sale_id,product_id,item_name,quantity,unit_price)
    values(v_sale_id,v_product_id,trim(v_item->>'name'),v_quantity,round((v_item->>'unitPrice')::numeric,2));
    if v_product_id is not null then
      update public.branch_products set quantity = quantity - v_quantity, updated_at = now()
      where branch_id = p_branch_id and product_id = v_product_id and quantity >= v_quantity;
      if not found then raise exception 'insufficient product stock'; end if;
      insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
      values(p_branch_id,v_product_id,-v_quantity,'sale',v_sale_id,'صرف مع فاتورة بيع',p_created_by);
    end if;
  end loop;
  if p_initial_payment > 0 then
    insert into public.sale_payments(sale_id,amount,payment_method,received_by) values(v_sale_id,p_initial_payment,p_payment_method,p_created_by);
  end if;
  return query select v_sale_id,v_invoice_number;
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
    insert into public.branch_products(branch_id,product_id,cost_price,quantity)
    values(p_branch_id,(v_item->>'productId')::uuid,(v_item->>'unitCost')::numeric,(v_item->>'quantity')::integer)
    on conflict (branch_id,product_id) do update set quantity = public.branch_products.quantity + excluded.quantity, cost_price = excluded.cost_price, updated_at = now();
    insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by)
    values(p_branch_id,(v_item->>'productId')::uuid,(v_item->>'quantity')::integer,'purchase',v_supply_id,'استلام توريد '||trim(p_invoice_number),p_created_by);
  end loop;
  return v_supply_id;
end;
$$;
