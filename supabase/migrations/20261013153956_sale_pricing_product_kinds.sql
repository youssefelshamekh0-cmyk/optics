alter table public.products drop constraint if exists products_category_check;
alter table public.products add constraint products_category_check
  check (category in ('frame', 'lens', 'accessory', 'other', 'sunglasses', 'contact_lens', 'sports_glasses'));

alter table public.sales add column sale_type varchar(32) not null default 'other'
  check (sale_type in ('medical_glasses', 'frame_only', 'lenses_only', 'sunglasses', 'contact_lenses', 'sports_glasses', 'mixed', 'other'));
alter table public.sales add column reference_total numeric(12,2) not null default 0 check (reference_total >= 0);
update public.sales set reference_total = total_amount;

alter table public.sale_items add column item_kind varchar(32) not null default 'product'
  check (item_kind in ('product', 'prescription_lens', 'service'));
alter table public.sale_items add column technical_details jsonb not null default '{}'::jsonb;
alter table public.sale_items drop constraint if exists sale_items_unit_price_check;
alter table public.sale_items add constraint sale_items_unit_price_check check (unit_price >= 0);

comment on column public.sales.total_amount is 'Final sale amount for invoices created after sale_pricing_product_kinds; legacy invoices retain their original semantics.';
comment on column public.sales.reference_total is 'Sum of catalog and lens reference prices captured at sale time.';
comment on column public.sale_items.unit_price is 'Reference unit price captured at sale time; the final customer price is stored on the sale.';

drop function if exists public.create_optics_sale(uuid, uuid, uuid, numeric, jsonb, jsonb, numeric, text, text);

create function public.create_optics_sale(
  p_branch_id uuid,
  p_customer_id uuid,
  p_created_by uuid,
  p_sale_type text,
  p_items jsonb,
  p_prescription jsonb,
  p_final_total numeric,
  p_initial_payment numeric,
  p_payment_method text,
  p_notes text
) returns table (sale_id uuid, invoice_number bigint)
language plpgsql security invoker set search_path = '' as $$
declare
  v_item jsonb;
  v_name text;
  v_quantity integer;
  v_unit_price numeric(12,2);
  v_product_id uuid;
  v_item_kind text;
  v_technical_details jsonb;
  v_stock integer;
  v_reference_total numeric(12,2) := 0;
  v_sale_id uuid;
  v_invoice_number bigint;
begin
  if p_sale_type not in ('medical_glasses', 'frame_only', 'lenses_only', 'sunglasses', 'contact_lenses', 'sports_glasses', 'mixed', 'other') then
    raise exception 'invalid sale type';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'sale requires between 1 and 20 items';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) as item_rows(value) loop
    begin
      v_name := trim(v_item->>'name');
      v_quantity := (v_item->>'quantity')::integer;
      v_unit_price := round((v_item->>'unitPrice')::numeric, 2);
      v_product_id := nullif(v_item->>'productId', '')::uuid;
      v_item_kind := coalesce(v_item->>'itemKind', 'product');
      v_technical_details := coalesce(v_item->'technicalDetails', '{}'::jsonb);
    exception when others then
      raise exception 'invalid sale item';
    end;
    if length(v_name) < 2 or length(v_name) > 160 or v_quantity not between 1 and 100 or v_unit_price < 0 then
      raise exception 'invalid sale item';
    end if;
    if v_item_kind not in ('product', 'prescription_lens', 'service') then raise exception 'invalid sale item kind'; end if;
    if (v_item_kind = 'product' and v_product_id is null) or (v_item_kind <> 'product' and v_product_id is not null) then
      raise exception 'sale item product association is invalid';
    end if;
    if v_product_id is not null then
      select bp.quantity into v_stock
      from public.branch_products bp
      where bp.branch_id = p_branch_id and bp.product_id = v_product_id
      for update;
      if not found or v_stock < v_quantity then raise exception 'insufficient product stock'; end if;
    end if;
    v_reference_total := v_reference_total + (v_quantity * v_unit_price);
  end loop;
  if p_final_total is null or p_final_total <= 0 then raise exception 'invalid final total'; end if;
  if p_initial_payment is null or p_initial_payment < 0 or p_initial_payment > p_final_total then raise exception 'invalid initial payment'; end if;
  if p_initial_payment > 0 and p_payment_method not in ('cash','card','instapay','other') then raise exception 'invalid payment method'; end if;

  insert into public.sales(branch_id, customer_id, created_by, sale_type, total_amount, discount_amount, reference_total, prescription, notes)
  values(p_branch_id, p_customer_id, p_created_by, p_sale_type, p_final_total, 0, v_reference_total, coalesce(p_prescription, '{}'::jsonb), nullif(trim(p_notes), ''))
  returning id, public.sales.invoice_number into v_sale_id, v_invoice_number;

  for v_item in select value from jsonb_array_elements(p_items) as item_rows(value) loop
    v_quantity := (v_item->>'quantity')::integer;
    v_product_id := nullif(v_item->>'productId', '')::uuid;
    v_item_kind := coalesce(v_item->>'itemKind', 'product');
    insert into public.sale_items(sale_id, product_id, item_name, quantity, unit_price, item_kind, technical_details)
    values(v_sale_id, v_product_id, trim(v_item->>'name'), v_quantity, round((v_item->>'unitPrice')::numeric, 2), v_item_kind, coalesce(v_item->'technicalDetails', '{}'::jsonb));
    if v_product_id is not null then
      update public.branch_products set quantity = quantity - v_quantity, updated_at = now()
      where branch_id = p_branch_id and product_id = v_product_id and quantity >= v_quantity;
      if not found then raise exception 'insufficient product stock'; end if;
      insert into public.stock_movements(branch_id, product_id, quantity_delta, movement_type, reference_id, reason, created_by)
      values(p_branch_id, v_product_id, -v_quantity, 'sale', v_sale_id, 'صرف مع فاتورة بيع', p_created_by);
    end if;
  end loop;
  if p_initial_payment > 0 then
    insert into public.sale_payments(sale_id, amount, payment_method, received_by)
    values(v_sale_id, p_initial_payment, p_payment_method, p_created_by);
  end if;
  return query select v_sale_id, v_invoice_number;
end;
$$;

revoke all on function public.create_optics_sale(uuid, uuid, uuid, text, jsonb, jsonb, numeric, numeric, text, text) from public, anon, authenticated;
grant execute on function public.create_optics_sale(uuid, uuid, uuid, text, jsonb, jsonb, numeric, numeric, text, text) to service_role;
