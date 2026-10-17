-- Phase 2 invoice integrity hardening.
-- Keep this migration on the phase2 branch until it is reviewed and applied to isolated staging.
create or replace function public.create_optics_sale(
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
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_stock integer;
  v_product uuid;
  v_qty integer;
  v_price numeric(12,2);
  v_name text;
  v_kind text;
  v_total numeric(12,2) := 0;
  v_discount numeric(12,2);
  v_sale uuid;
  v_invoice bigint;
  v_account uuid;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'invalid items';
  end if;

  -- Lock all requested stock rows in deterministic order to reduce deadlocks
  -- when concurrent invoices contain the same products in different orders.
  perform 1
  from public.branch_products bp
  where bp.branch_id = p_branch_id
    and bp.product_id in (
      select distinct nullif(items.value->>'productId', '')::uuid
      from jsonb_array_elements(p_items) as items(value)
      where nullif(items.value->>'productId', '') is not null
    )
  order by bp.product_id
  for update;

  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      v_name := trim(v_item->>'name');
      v_qty := (v_item->>'quantity')::integer;
      v_price := round((v_item->>'unitPrice')::numeric, 2);
      v_product := nullif(v_item->>'productId', '')::uuid;
      v_kind := coalesce(v_item->>'itemKind', 'product');
    exception when others then
      raise exception 'invalid sale item';
    end;

    if v_name is null or length(v_name) not between 2 and 160
       or v_qty is null or v_qty not between 1 and 100
       or v_price is null or v_price < 0
       or v_kind not in ('product', 'prescription_lens', 'service') then
      raise exception 'invalid sale item';
    end if;
    if (v_kind = 'product' and v_product is null)
       or (v_kind <> 'product' and v_product is not null) then
      raise exception 'invalid product association';
    end if;

    if v_product is not null then
      select quantity into v_stock
      from public.branch_products
      where branch_id = p_branch_id and product_id = v_product
      for update;
      if not found or v_stock < v_qty then raise exception 'insufficient product stock'; end if;
    end if;

    v_total := v_total + v_qty * v_price;
  end loop;

  if p_final_total is null or p_final_total <= 0 or p_final_total > v_total
     or p_initial_payment is null or p_initial_payment < 0 or p_initial_payment > p_final_total then
    raise exception 'invalid totals';
  end if;
  v_discount := round(v_total - p_final_total, 2);

  if p_initial_payment > 0 then
    if p_payment_method not in ('cash', 'card', 'instapay', 'other') then
      raise exception 'invalid payment method';
    end if;
    select id into v_account
    from public.cash_accounts
    where branch_id = p_branch_id and payment_method = p_payment_method and active
    order by created_at limit 1;
    if v_account is null then raise exception 'cash account not configured for payment method'; end if;
  end if;

  insert into public.sales(
    branch_id, customer_id, created_by, sale_type, total_amount, discount_amount,
    reference_total, prescription, notes
  )
  values(
    p_branch_id, p_customer_id, p_created_by, p_sale_type, v_total, v_discount,
    v_total, coalesce(p_prescription, '{}'::jsonb), nullif(trim(p_notes), '')
  )
  returning id, public.sales.invoice_number into v_sale, v_invoice;

  insert into public.sale_delivery_events(sale_id, from_status, to_status, changed_by)
  values(v_sale, null, 'pending', p_created_by);

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::integer;
    v_product := nullif(v_item->>'productId', '')::uuid;
    v_kind := coalesce(v_item->>'itemKind', 'product');

    insert into public.sale_items(
      sale_id, product_id, item_name, quantity, unit_price, item_kind, technical_details
    )
    values(
      v_sale, v_product, trim(v_item->>'name'), v_qty,
      round((v_item->>'unitPrice')::numeric, 2), v_kind,
      coalesce(v_item->'technicalDetails', '{}'::jsonb)
    );

    if v_product is not null then
      update public.branch_products
      set quantity = quantity - v_qty, updated_at = now()
      where branch_id = p_branch_id and product_id = v_product and quantity >= v_qty;
      if not found then raise exception 'insufficient product stock'; end if;

      insert into public.stock_movements(
        branch_id, product_id, quantity_delta, movement_type, reference_id, reason, created_by
      )
      values(
        p_branch_id, v_product, -v_qty, 'sale', v_sale, 'صرف مع فاتورة بيع', p_created_by
      );
    end if;
  end loop;

  if p_initial_payment > 0 then
    insert into public.sale_payments(sale_id, amount, payment_method, received_by)
    values(v_sale, p_initial_payment, p_payment_method, p_created_by);
    insert into public.cash_transactions(
      cash_account_id, direction, amount, transaction_type, reference_id, description, created_by
    )
    values(
      v_account, 'in', p_initial_payment, 'sale_payment', v_sale,
      'دفعة أولى للفاتورة #' || v_invoice, p_created_by
    );
  end if;

  return query select v_sale, v_invoice;
end;
$$;

revoke all on function public.create_optics_sale(uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.create_optics_sale(uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text)
  to service_role;
