-- Phase 1: financial integrity, serialized cash withdrawals, and retry-safe expense/payroll operations.
-- Apply after 20261017180000_staff_time_off_central_payroll.sql.

create table if not exists public.financial_operation_keys (
  operation_id uuid primary key,
  operation_type text not null check (operation_type in ('expense','payroll_payment')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  result_id uuid,
  created_at timestamptz not null default now()
);
alter table public.financial_operation_keys enable row level security;
revoke all on public.financial_operation_keys from public,anon,authenticated;
grant all on public.financial_operation_keys to service_role;

-- A paid expense must never have two ledger outflows, even if a legacy caller retries.
create unique index if not exists cash_transactions_expense_reference_once
  on public.cash_transactions(reference_id)
  where transaction_type='expense' and reference_id is not null;

-- Separate advance payouts from payroll payments so each request can be paid at most once.
alter table public.cash_transactions drop constraint if exists cash_transactions_transaction_type_check;
alter table public.cash_transactions add constraint cash_transactions_transaction_type_check
  check (transaction_type in ('sale_payment','supplier_payment','expense','payroll','payroll_advance','commission','adjustment','central_deposit'));

-- Keep the legacy RPC safe for any internal caller: lock the account before reading balance.
create or replace function public.pay_payroll(p_payroll uuid,p_account uuid,p_amount numeric,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_due numeric; v_balance numeric;
begin
  if p_amount is null or p_amount<=0 then raise exception 'invalid payroll payment'; end if;
  select round(p.base_salary+p.commission_amount-p.deductions-p.amount_paid,2) into v_due
  from public.payroll_entries p where p.id=p_payroll and p.status='pending' for update;
  if not found or p_amount>v_due then raise exception 'invalid payroll payment'; end if;
  perform 1 from public.cash_accounts where id=p_account and is_central and active for update;
  if not found then raise exception 'payroll must be paid from central cash'; end if;
  v_balance:=public.cash_account_balance(p_account);
  if v_balance<p_amount then raise exception 'insufficient central cash balance'; end if;
  update public.payroll_entries
    set amount_paid=amount_paid+p_amount,
        cash_account_id=p_account,
        status=case when amount_paid+p_amount=base_salary+commission_amount-deductions then 'paid' else 'pending' end,
        paid_at=case when amount_paid+p_amount=base_salary+commission_amount-deductions then now() else paid_at end
    where id=p_payroll;
  insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
  values(p_account,'out',p_amount,'payroll',p_payroll,'صرف راتب/عمولة من الخزنة المركزية',p_actor);
end $$;
revoke all on function public.pay_payroll(uuid,uuid,numeric,uuid) from public,anon,authenticated;
grant execute on function public.pay_payroll(uuid,uuid,numeric,uuid) to service_role;

create or replace function public.pay_payroll_idempotent(
 p_payroll uuid,p_account uuid,p_amount numeric,p_actor uuid,p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_due numeric; v_balance numeric; v_inserted integer; v_key public.financial_operation_keys%rowtype;
begin
 if p_operation_id is null then raise exception 'operation id required'; end if;
 insert into public.financial_operation_keys(operation_id,operation_type,actor_id)
 values(p_operation_id,'payroll_payment',p_actor) on conflict(operation_id) do nothing;
 get diagnostics v_inserted = row_count;
 if v_inserted=0 then
   select * into v_key from public.financial_operation_keys where operation_id=p_operation_id for update;
   if v_key.operation_type<>'payroll_payment' or v_key.actor_id<>p_actor then raise exception 'idempotency key conflict'; end if;
   if v_key.result_id is null then raise exception 'operation is incomplete; retry with a new key after investigation'; end if;
   return v_key.result_id;
 end if;
 if p_amount is null or p_amount<=0 then raise exception 'invalid payroll payment'; end if;
 select round(p.base_salary+p.commission_amount-p.deductions-p.amount_paid,2) into v_due
 from public.payroll_entries p where p.id=p_payroll and p.status='pending' for update;
 if not found or p_amount>v_due then raise exception 'invalid payroll payment'; end if;
 perform 1 from public.cash_accounts where id=p_account and is_central and active for update;
 if not found then raise exception 'payroll must be paid from central cash'; end if;
 v_balance:=public.cash_account_balance(p_account);
 if v_balance<p_amount then raise exception 'insufficient central cash balance'; end if;
 update public.payroll_entries
  set amount_paid=amount_paid+p_amount,cash_account_id=p_account,
      status=case when amount_paid+p_amount=base_salary+commission_amount-deductions then 'paid' else 'pending' end,
      paid_at=case when amount_paid+p_amount=base_salary+commission_amount-deductions then now() else paid_at end
  where id=p_payroll;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',p_amount,'payroll',p_payroll,'صرف راتب/عمولة من الخزنة المركزية',p_actor);
 update public.financial_operation_keys set result_id=p_payroll where operation_id=p_operation_id;
 return p_payroll;
end $$;
revoke all on function public.pay_payroll_idempotent(uuid,uuid,numeric,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pay_payroll_idempotent(uuid,uuid,numeric,uuid,uuid) to service_role;

-- Retry-safe expense creation. A central account may be used only when fromCentral=true;
-- a branch account must belong to the selected branch. All withdrawals serialize on the account row.
create or replace function public.create_expense_from_account(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid,
 p_from_central boolean,p_operation_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_balance numeric; v_inserted integer; v_key public.financial_operation_keys%rowtype;
begin
 if p_operation_id is null then raise exception 'operation id required'; end if;
 insert into public.financial_operation_keys(operation_id,operation_type,actor_id)
 values(p_operation_id,'expense',p_actor) on conflict(operation_id) do nothing;
 get diagnostics v_inserted = row_count;
 if v_inserted=0 then
   select * into v_key from public.financial_operation_keys where operation_id=p_operation_id for update;
   if v_key.operation_type<>'expense' or v_key.actor_id<>p_actor then raise exception 'idempotency key conflict'; end if;
   if v_key.result_id is null then raise exception 'operation is incomplete; retry with a new key after investigation'; end if;
   return v_key.result_id;
 end if;
 if coalesce(p_amount,0)<=0 or nullif(trim(coalesce(p_description,'')),'') is null or nullif(trim(coalesce(p_category,'')),'') is null then raise exception 'invalid expense details'; end if;
 if p_from_central then
   perform 1 from public.cash_accounts where id=p_account and is_central and active for update;
 else
   perform 1 from public.cash_accounts where id=p_account and branch_id=p_branch and not is_central and active for update;
 end if;
 if not found then raise exception 'cash account does not match selected source'; end if;
 v_balance:=public.cash_account_balance(p_account);
 if v_balance<p_amount then raise exception 'insufficient cash balance'; end if;
 insert into public.expenses(branch_id,cash_account_id,description,category,amount,expense_date,status,created_by)
 values(p_branch,p_account,trim(p_description),trim(p_category),round(p_amount,2),p_date,'paid',p_actor) returning id into v_id;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',round(p_amount,2),'expense',v_id,trim(p_description),p_actor);
 update public.financial_operation_keys set result_id=v_id where operation_id=p_operation_id;
 return v_id;
end $$;
revoke all on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean,uuid) to service_role;

-- Preserve the old RPC signature, but route it through the same balance/source checks.
create or replace function public.create_expense_from_account(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid,p_from_central boolean
) returns uuid language sql security definer set search_path = '' as $
 select public.create_expense_from_account(p_branch,p_account,p_description,p_category,p_amount,p_date,p_actor,p_from_central,gen_random_uuid())
$;
revoke all on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean) from public,anon,authenticated;
grant execute on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean) to service_role;

-- Make advance decisions atomic and safe against concurrent payouts.
create or replace function public.decide_payroll_advance(p_request uuid,p_decision text,p_account uuid,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_amount numeric(12,2); v_status text; v_balance numeric;
begin
 select amount,status into v_amount,v_status from public.payroll_advance_requests where id=p_request for update;
 if not found or v_status<>'pending' then raise exception 'request is not pending'; end if;
 if p_decision='reject' then
   update public.payroll_advance_requests set status='rejected',decided_by=p_actor,decided_at=now() where id=p_request;
 elsif p_decision='pay' then
   perform 1 from public.cash_accounts where id=p_account and is_central and active for update;
   if not found then raise exception 'advance must be paid from central cash'; end if;
   v_balance:=public.cash_account_balance(p_account);
   if v_balance<v_amount then raise exception 'insufficient central cash balance'; end if;
   update public.payroll_advance_requests set status='paid',cash_account_id=p_account,decided_by=p_actor,decided_at=now() where id=p_request;
   insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
   values(p_account,'out',v_amount,'payroll_advance',p_request,'مسحوبات راتب معتمدة من الخزنة المركزية',p_actor);
 else raise exception 'invalid decision'; end if;
end $$;
revoke all on function public.decide_payroll_advance(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.decide_payroll_advance(uuid,text,uuid,uuid) to service_role;
