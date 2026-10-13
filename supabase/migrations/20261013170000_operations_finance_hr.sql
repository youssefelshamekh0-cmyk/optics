-- Core operational modules: delivery history, inventory controls, finance and staff compensation.
insert into public.permissions(key, description) values
  ('inventory.manage', 'إدارة المخزون والتحويلات'),
  ('purchases.manage', 'إدارة المشتريات والموردين'),
  ('finance.manage', 'إدارة الخزائن والمصروفات'),
  ('staff.manage', 'إدارة الموظفين والرواتب والعمولات')
on conflict (key) do nothing;

create table public.sale_delivery_events (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  from_status text,
  to_status text not null check (to_status in ('pending','processing','ready','delivered','cancelled')),
  changed_by uuid references auth.users(id) on delete set null,
  notes varchar(500),
  created_at timestamptz not null default now()
);
create index sale_delivery_events_sale_idx on public.sale_delivery_events(sale_id, created_at desc);
insert into public.sale_delivery_events(sale_id,from_status,to_status,created_at)
select id,null,delivery_status,created_at from public.sales;

create table public.inventory_transfers (
  id uuid primary key default gen_random_uuid(),
  source_branch_id uuid not null references public.branches(id) on delete restrict,
  destination_branch_id uuid not null references public.branches(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  reason varchar(300),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_branch_id <> destination_branch_id)
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  invoice_number varchar(100) not null,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  purchased_at timestamptz not null default now(),
  total_cost numeric(12,2) not null check (total_cost >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0 and amount_paid <= total_cost),
  status text not null default 'received' check (status in ('received','partially_paid','paid')),
  notes varchar(1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (supplier_id, invoice_number)
);
create index purchases_branch_date_idx on public.purchases(branch_id,purchased_at desc);
create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  received_quantity integer not null check (received_quantity >= 0 and received_quantity <= quantity),
  line_total numeric(14,2) generated always as (quantity * unit_cost) stored
);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  name varchar(120) not null,
  account_type text not null check (account_type in ('cash','bank','digital')),
  payment_method text not null check (payment_method in ('cash','card','instapay','other')),
  opening_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(branch_id,name)
);
create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  direction text not null check (direction in ('in','out')),
  amount numeric(14,2) not null check (amount > 0),
  transaction_type text not null check (transaction_type in ('sale_payment','supplier_payment','expense','payroll','commission','adjustment')),
  reference_id uuid,
  description varchar(500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index cash_transactions_account_time_idx on public.cash_transactions(cash_account_id,created_at desc);
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete restrict,
  cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  description varchar(300) not null,
  category varchar(100) not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  status text not null default 'paid' check (status in ('draft','paid','cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index expenses_branch_date_idx on public.expenses(branch_id,expense_date desc);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.user_profiles(id) on delete set null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  full_name varchar(160) not null,
  phone varchar(40),
  job_title varchar(100) not null default 'بائع',
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  commission_rate numeric(5,2) not null default 0 check (commission_rate between 0 and 100),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index employees_branch_idx on public.employees(branch_id,status);
create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  cash_account_id uuid references public.cash_accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  base_salary numeric(12,2) not null check (base_salary >= 0),
  commission_amount numeric(12,2) not null default 0 check (commission_amount >= 0),
  deductions numeric(12,2) not null default 0 check (deductions >= 0),
  amount_paid numeric(12,2) not null default 0 check (amount_paid >= 0),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  notes varchar(500),
  created_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (amount_paid <= base_salary + commission_amount - deductions)
);
create index payroll_entries_employee_period_idx on public.payroll_entries(employee_id,period_start desc);

alter table public.sale_delivery_events enable row level security;
alter table public.inventory_transfers enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.cash_accounts enable row level security;
alter table public.cash_transactions enable row level security;
alter table public.expenses enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_entries enable row level security;
revoke all on public.sale_delivery_events,public.inventory_transfers,public.purchases,public.purchase_items,public.cash_accounts,public.cash_transactions,public.expenses,public.employees,public.payroll_entries from anon,authenticated;
grant all on public.sale_delivery_events,public.inventory_transfers,public.purchases,public.purchase_items,public.cash_accounts,public.cash_transactions,public.expenses,public.employees,public.payroll_entries to service_role;

create or replace function public.record_sale_payment(p_sale_id uuid,p_amount numeric,p_payment_method text,p_received_by uuid,p_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_total numeric(12,2); v_paid numeric(12,2); v_status text; v_branch uuid; v_payment uuid; v_account uuid;
begin
  select grand_total,delivery_status,branch_id into v_total,v_status,v_branch from public.sales where id=p_sale_id for update;
  if not found then raise exception 'sale not found'; end if;
  if v_status='cancelled' or p_amount is null or p_amount<=0 or p_payment_method not in ('cash','card','instapay','other') then raise exception 'invalid payment'; end if;
  select coalesce(sum(amount),0) into v_paid from public.sale_payments where sale_id=p_sale_id;
  if p_amount>v_total-v_paid then raise exception 'payment exceeds remaining balance'; end if;
  select id into v_account from public.cash_accounts where branch_id=v_branch and payment_method=p_payment_method and active order by created_at limit 1;
  if v_account is null then raise exception 'cash account not configured for payment method'; end if;
  insert into public.sale_payments(sale_id,amount,payment_method,notes,received_by) values(p_sale_id,p_amount,p_payment_method,nullif(trim(p_notes),''),p_received_by) returning id into v_payment;
  insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
  values(v_account,'in',p_amount,'sale_payment',v_payment,'دفعة فاتورة #'||p_sale_id,p_received_by);
  return v_payment;
end $$;
revoke all on function public.record_sale_payment(uuid,numeric,text,uuid,text) from public,anon,authenticated;
grant execute on function public.record_sale_payment(uuid,numeric,text,uuid,text) to service_role;

create or replace function public.create_optics_sale(
  p_branch_id uuid,p_customer_id uuid,p_created_by uuid,p_sale_type text,p_items jsonb,p_prescription jsonb,p_final_total numeric,p_initial_payment numeric,p_payment_method text,p_notes text
) returns table (sale_id uuid,invoice_number bigint)
language plpgsql security definer set search_path = '' as $$
declare v_item jsonb; v_stock integer; v_product uuid; v_qty integer; v_price numeric(12,2); v_name text; v_kind text; v_total numeric(12,2):=0; v_sale uuid; v_invoice bigint; v_account uuid;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'invalid items'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin v_name:=trim(v_item->>'name'); v_qty:=(v_item->>'quantity')::integer; v_price:=round((v_item->>'unitPrice')::numeric,2); v_product:=nullif(v_item->>'productId','')::uuid; v_kind:=coalesce(v_item->>'itemKind','product'); exception when others then raise exception 'invalid sale item'; end;
    if length(v_name) not between 2 and 160 or v_qty not between 1 and 100 or v_price<0 or v_kind not in ('product','prescription_lens','service') then raise exception 'invalid sale item'; end if;
    if (v_kind='product' and v_product is null) or (v_kind<>'product' and v_product is not null) then raise exception 'invalid product association'; end if;
    if v_product is not null then select quantity into v_stock from public.branch_products where branch_id=p_branch_id and product_id=v_product for update; if not found or v_stock<v_qty then raise exception 'insufficient product stock'; end if; end if;
    v_total:=v_total+v_qty*v_price;
  end loop;
  if p_final_total is null or p_final_total<=0 or p_initial_payment is null or p_initial_payment<0 or p_initial_payment>p_final_total then raise exception 'invalid totals'; end if;
  if p_initial_payment>0 then
    if p_payment_method not in ('cash','card','instapay','other') then raise exception 'invalid payment method'; end if;
    select id into v_account from public.cash_accounts where branch_id=p_branch_id and payment_method=p_payment_method and active order by created_at limit 1;
    if v_account is null then raise exception 'cash account not configured for payment method'; end if;
  end if;
  insert into public.sales(branch_id,customer_id,created_by,sale_type,total_amount,discount_amount,reference_total,prescription,notes)
  values(p_branch_id,p_customer_id,p_created_by,p_sale_type,p_final_total,0,v_total,coalesce(p_prescription,'{}'::jsonb),nullif(trim(p_notes),'')) returning id,public.sales.invoice_number into v_sale,v_invoice;
  insert into public.sale_delivery_events(sale_id,from_status,to_status,changed_by) values(v_sale,null,'pending',p_created_by);
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty:=(v_item->>'quantity')::integer; v_product:=nullif(v_item->>'productId','')::uuid; v_kind:=coalesce(v_item->>'itemKind','product');
    insert into public.sale_items(sale_id,product_id,item_name,quantity,unit_price,item_kind,technical_details) values(v_sale,v_product,trim(v_item->>'name'),v_qty,round((v_item->>'unitPrice')::numeric,2),v_kind,coalesce(v_item->'technicalDetails','{}'::jsonb));
    if v_product is not null then update public.branch_products set quantity=quantity-v_qty,updated_at=now() where branch_id=p_branch_id and product_id=v_product and quantity>=v_qty; if not found then raise exception 'insufficient product stock'; end if;
      insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by) values(p_branch_id,v_product,-v_qty,'sale',v_sale,'صرف مع فاتورة بيع',p_created_by); end if;
  end loop;
  if p_initial_payment>0 then
    insert into public.sale_payments(sale_id,amount,payment_method,received_by) values(v_sale,p_initial_payment,p_payment_method,p_created_by);
    insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by) values(v_account,'in',p_initial_payment,'sale_payment',v_sale,'دفعة أولى للفاتورة #'||v_invoice,p_created_by);
  end if;
  return query select v_sale,v_invoice;
end $$;
revoke all on function public.create_optics_sale(uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text) from public,anon,authenticated;
grant execute on function public.create_optics_sale(uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text) to service_role;

create or replace function public.adjust_stock(p_branch_id uuid,p_product_id uuid,p_delta integer,p_reason text,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_qty integer;
begin
  if p_delta=0 or nullif(trim(p_reason),'') is null then raise exception 'invalid adjustment'; end if;
  select quantity into v_qty from public.branch_products where branch_id=p_branch_id and product_id=p_product_id for update;
  if not found then raise exception 'stock row not found'; end if;
  update public.branch_products set quantity=quantity+p_delta,updated_at=now() where branch_id=p_branch_id and product_id=p_product_id and quantity+p_delta>=0;
  if not found then raise exception 'insufficient product stock'; end if;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reason,created_by) values(p_branch_id,p_product_id,p_delta,'adjustment',trim(p_reason),p_actor);
end $$;
create or replace function public.transfer_stock(p_source uuid,p_destination uuid,p_product uuid,p_quantity integer,p_reason text,p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_transfer uuid;
begin
  if p_source=p_destination or p_quantity<1 then raise exception 'invalid transfer'; end if;
  perform 1 from public.branch_products where branch_id in (p_source,p_destination) and product_id=p_product order by branch_id for update;
  update public.branch_products set quantity=quantity-p_quantity,updated_at=now() where branch_id=p_source and product_id=p_product and quantity>=p_quantity;
  if not found then raise exception 'insufficient product stock'; end if;
  insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity)
  select p_destination,p_product,cost_price,reference_price,p_quantity from public.branch_products where branch_id=p_source and product_id=p_product
  on conflict(branch_id,product_id) do update set quantity=public.branch_products.quantity+excluded.quantity,updated_at=now();
  insert into public.inventory_transfers(source_branch_id,destination_branch_id,product_id,quantity,reason,created_by) values(p_source,p_destination,p_product,p_quantity,nullif(trim(p_reason),''),p_actor) returning id into v_transfer;
  insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by) values
    (p_source,p_product,-p_quantity,'transfer_out',v_transfer,coalesce(nullif(trim(p_reason),''),'تحويل إلى فرع آخر'),p_actor),
    (p_destination,p_product,p_quantity,'transfer_in',v_transfer,coalesce(nullif(trim(p_reason),''),'استلام تحويل من فرع آخر'),p_actor);
  return v_transfer;
end $$;

create or replace function public.change_sale_delivery(p_sale_id uuid,p_status text,p_actor uuid,p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  if p_status not in ('pending','processing','ready','delivered') then raise exception 'invalid delivery status'; end if;
  select delivery_status into v_old from public.sales where id=p_sale_id for update;
  if not found then raise exception 'sale not found'; end if;
  if v_old='cancelled' then raise exception 'cancelled sale'; end if;
  update public.sales set delivery_status=p_status,updated_at=now() where id=p_sale_id;
  insert into public.sale_delivery_events(sale_id,from_status,to_status,changed_by,notes) values(p_sale_id,v_old,p_status,p_actor,nullif(trim(p_notes),''));
end $$;

create or replace function public.create_cash_account(p_branch uuid,p_name text,p_type text,p_method text,p_opening numeric,p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_opening<0 or p_type not in ('cash','bank','digital') or p_method not in ('cash','card','instapay','other') then raise exception 'invalid cash account'; end if;
  insert into public.cash_accounts(branch_id,name,account_type,payment_method,opening_balance,created_by) values(p_branch,trim(p_name),p_type,p_method,p_opening,p_actor) returning id into v_id;
  if p_opening>0 then insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,description,created_by) values(v_id,'in',p_opening,'adjustment','رصيد افتتاحي',p_actor); end if;
  return v_id;
end $$;
create or replace function public.create_expense(p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_amount<=0 or not exists(select 1 from public.cash_accounts where id=p_account and branch_id=p_branch and active) then raise exception 'invalid expense account'; end if;
  insert into public.expenses(branch_id,cash_account_id,description,category,amount,expense_date,status,created_by) values(p_branch,p_account,trim(p_description),trim(p_category),p_amount,p_date,'paid',p_actor) returning id into v_id;
  insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by) values(p_account,'out',p_amount,'expense',v_id,trim(p_description),p_actor);
  return v_id;
end $$;
create or replace function public.pay_payroll(p_payroll uuid,p_account uuid,p_amount numeric,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_due numeric;
begin
  select e.branch_id,(p.base_salary+p.commission_amount-p.deductions-p.amount_paid) into v_branch,v_due from public.payroll_entries p join public.employees e on e.id=p.employee_id where p.id=p_payroll and p.status='pending' for update of p;
  if not found or p_amount<=0 or p_amount>v_due then raise exception 'invalid payroll payment'; end if;
  if not exists(select 1 from public.cash_accounts where id=p_account and branch_id=v_branch and active) then raise exception 'invalid cash account'; end if;
  update public.payroll_entries set amount_paid=amount_paid+p_amount,cash_account_id=p_account,status=case when amount_paid+p_amount=base_salary+commission_amount-deductions then 'paid' else 'pending' end,paid_at=case when amount_paid+p_amount=base_salary+commission_amount-deductions then now() else paid_at end where id=p_payroll;
  insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by) values(p_account,'out',p_amount,'payroll',p_payroll,'صرف راتب/عمولة',p_actor);
end $$;

create or replace function public.receive_purchase(p_invoice text,p_supplier text,p_phone text,p_branch uuid,p_items jsonb,p_paid numeric,p_account uuid,p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_supplier uuid; v_purchase uuid; v_total numeric(12,2); v_paid_id uuid; v_item jsonb; v_qty integer; v_cost numeric(12,2); v_product uuid;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'purchase needs items'; end if;
  select sum((value->>'quantity')::integer*(value->>'unitCost')::numeric) into v_total from jsonb_array_elements(p_items);
  if p_paid<0 or p_paid>v_total then raise exception 'invalid initial payment'; end if;
  if p_paid>0 and not exists(select 1 from public.cash_accounts where id=p_account and branch_id=p_branch and active) then raise exception 'invalid cash account'; end if;
  insert into public.suppliers(name,phone) values(trim(p_supplier),nullif(trim(p_phone),'')) on conflict(name) do update set phone=coalesce(excluded.phone,public.suppliers.phone) returning id into v_supplier;
  insert into public.purchases(invoice_number,supplier_id,branch_id,total_cost,amount_paid,status,created_by) values(trim(p_invoice),v_supplier,p_branch,v_total,p_paid,case when p_paid=v_total then 'paid' when p_paid>0 then 'partially_paid' else 'received' end,p_actor) returning id into v_purchase;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product:=(v_item->>'productId')::uuid; v_qty:=(v_item->>'quantity')::integer; v_cost:=(v_item->>'unitCost')::numeric;
    if v_qty<1 or v_cost<0 or not exists(select 1 from public.products where id=v_product and active) then raise exception 'invalid purchase item'; end if;
    insert into public.purchase_items(purchase_id,product_id,quantity,unit_cost,received_quantity) values(v_purchase,v_product,v_qty,v_cost,v_qty);
    insert into public.branch_products(branch_id,product_id,cost_price,reference_price,quantity) values(p_branch,v_product,v_cost,0,v_qty)
    on conflict(branch_id,product_id) do update set quantity=public.branch_products.quantity+excluded.quantity,cost_price=excluded.cost_price,updated_at=now();
    insert into public.stock_movements(branch_id,product_id,quantity_delta,movement_type,reference_id,reason,created_by) values(p_branch,v_product,v_qty,'purchase',v_purchase,'استلام مشتريات '||trim(p_invoice),p_actor);
  end loop;
  if p_paid>0 then insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by) values(p_account,'out',p_paid,'supplier_payment',v_purchase,'دفعة مشتريات '||trim(p_invoice),p_actor); end if;
  return v_purchase;
end $$;

revoke all on function public.adjust_stock(uuid,uuid,integer,text,uuid),public.transfer_stock(uuid,uuid,uuid,integer,text,uuid),public.change_sale_delivery(uuid,text,uuid,text),public.create_cash_account(uuid,text,text,text,numeric,uuid),public.create_expense(uuid,uuid,text,text,numeric,date,uuid),public.pay_payroll(uuid,uuid,numeric,uuid),public.receive_purchase(text,text,text,uuid,jsonb,numeric,uuid,uuid) from public,anon,authenticated;
grant execute on function public.adjust_stock(uuid,uuid,integer,text,uuid),public.transfer_stock(uuid,uuid,uuid,integer,text,uuid),public.change_sale_delivery(uuid,text,uuid,text),public.create_cash_account(uuid,text,text,text,numeric,uuid),public.create_expense(uuid,uuid,text,text,numeric,date,uuid),public.pay_payroll(uuid,uuid,numeric,uuid),public.receive_purchase(text,text,text,uuid,jsonb,numeric,uuid,uuid) to service_role;
