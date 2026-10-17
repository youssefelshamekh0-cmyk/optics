-- Phase 2: controlled partial/full sale returns with stock and cash-ledger updates.
-- Keep on the phase2 branch; do not apply to production until isolated staging is available.
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  refund_amount numeric(12,2) not null check (refund_amount > 0),
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  reason varchar(500) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sale_returns_sale_idx on public.sale_returns(sale_id, created_at desc);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete restrict,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_refund numeric(12,2) not null check (unit_refund >= 0),
  line_refund numeric(12,2) generated always as (quantity * unit_refund) stored
);
create index if not exists sale_return_items_sale_item_idx on public.sale_return_items(sale_item_id);

alter table public.cash_transactions drop constraint if exists cash_transactions_transaction_type_check;
alter table public.cash_transactions add constraint cash_transactions_transaction_type_check
  check (transaction_type in ('sale_payment','sale_refund','supplier_payment','expense','payroll','commission','adjustment'));

create or replace function public.process_sale_return(
  p_sale_id uuid,
  p_items jsonb,
  p_cash_account_id uuid,
  p_reason text,
  p_actor uuid
) returns table(return_id uuid, refund_amount numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_sale record;
  v_item jsonb;
  v_sale_item record;
  v_requested_qty integer;
  v_already_returned integer;
  v_line_refund numeric(12,2);
  v_total_refund numeric(12,2) := 0;
  v_paid numeric(12,2);
  v_refunded numeric(12,2);
  v_return_id uuid;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     or nullif(trim(p_reason), '') is null then
    raise exception 'invalid return request';
  end if;

  select s.id, s.branch_id, s.grand_total
  into v_sale
  from public.sales s
  where s.id = p_sale_id
  for update;
  if not found then raise exception 'sale not found'; end if;

  if not exists (
    select 1 from public.cash_accounts ca
    where ca.id = p_cash_account_id and ca.branch_id = v_sale.branch_id and ca.active
  ) then raise exception 'invalid refund cash account'; end if;

  -- Lock item rows in deterministic order before checking previously returned quantities.
  for v_item in
    select value from jsonb_array_elements(p_items) as items(value)
    order by value->>'saleItemId'
  loop
    begin
      v_sale_item.id := (v_item->>'saleItemId')::uuid;
      v_requested_qty := (v_item->>'quantity')::integer;
    exception when others then raise exception 'invalid return item'; end;
    if v_requested_qty is null or v_requested_qty < 1 then raise exception 'invalid return quantity'; end if;

    select si.id, si.sale_id, si.product_id, si.quantity, si.unit_price
    into v_sale_item
    from public.sale_items si
    where si.id = (v_item->>'saleItemId')::uuid and si.sale_id = p_sale_id
    for update;
    if not found then raise exception 'sale item not found'; end if;

    select coalesce(sum(sri.quantity), 0)::integer into v_already_returned
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id = sri.return_id
    where sri.sale_item_id = v_sale_item.id;

    if v_already_returned + v_requested_qty > v_sale_item.quantity then
      raise exception 'return quantity exceeds sold quantity';
    end if;
    v_total_refund := v_total_refund + round(v_requested_qty * v_sale_item.unit_price, 2);
  end loop;

  select coalesce(sum(sp.amount),0) into v_paid
  from public.sale_payments sp where sp.sale_id = p_sale_id;
  select coalesce(sum(sr.refund_amount),0) into v_refunded
  from public.sale_returns sr where sr.sale_id = p_sale_id;

  if v_total_refund <= 0 or v_refunded + v_total_refund > v_paid then
    raise exception 'refund exceeds net paid amount';
  end if;

  insert into public.sale_returns(sale_id, branch_id, refund_amount, cash_account_id, reason, created_by)
  values(p_sale_id, v_sale.branch_id, v_total_refund, p_cash_account_id, trim(p_reason), p_actor)
  returning id into v_return_id;

  for v_item in
    select value from jsonb_array_elements(p_items) as items(value)
    order by value->>'saleItemId'
  loop
    select si.id, si.product_id, si.unit_price
    into v_sale_item
    from public.sale_items si
    where si.id = (v_item->>'saleItemId')::uuid and si.sale_id = p_sale_id;

    v_requested_qty := (v_item->>'quantity')::integer;
    v_line_refund := round(v_requested_qty * v_sale_item.unit_price, 2);
    insert into public.sale_return_items(return_id, sale_item_id, quantity, unit_refund)
    values(v_return_id, v_sale_item.id, v_requested_qty, v_sale_item.unit_price);

    if v_sale_item.product_id is not null then
      update public.branch_products
      set quantity = quantity + v_requested_qty, updated_at = now()
      where branch_id = v_sale.branch_id and product_id = v_sale_item.product_id;
      if not found then
        raise exception 'branch stock row missing for returned product';
      end if;
      insert into public.stock_movements(
        branch_id, product_id, quantity_delta, movement_type, reference_id, reason, created_by
      ) values(
        v_sale.branch_id, v_sale_item.product_id, v_requested_qty, 'return', v_return_id,
        'مرتجع فاتورة #' || p_sale_id::text, p_actor
      );
    end if;
  end loop;

  insert into public.cash_transactions(
    cash_account_id, direction, amount, transaction_type, reference_id, description, created_by
  ) values(
    p_cash_account_id, 'out', v_total_refund, 'sale_refund', v_return_id,
    'رد قيمة مرتجع فاتورة ' || p_sale_id::text, p_actor
  );

  return query select v_return_id, v_total_refund;
end;
$$;

revoke all on function public.process_sale_return(uuid,jsonb,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.process_sale_return(uuid,jsonb,uuid,text,uuid) to service_role;
