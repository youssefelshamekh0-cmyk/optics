-- Staff leave/permission requests, central-cash expense and payroll disbursement.
create table public.staff_time_off_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.user_profiles(id) on delete restrict,
 employee_id uuid references public.employees(id) on delete set null,
 branch_id uuid not null references public.branches(id) on delete restrict,
 request_type text not null check (request_type in ('leave','permission')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason varchar(500) not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 reviewer_note varchar(500),
 created_at timestamptz not null default now(),
 check (ends_at > starts_at)
);
create index staff_time_off_user_time_idx on public.staff_time_off_requests(user_id,created_at desc);
create index staff_time_off_status_time_idx on public.staff_time_off_requests(status,created_at desc);
alter table public.staff_time_off_requests enable row level security;
revoke all on public.staff_time_off_requests from anon, authenticated;
grant all on public.staff_time_off_requests to service_role;

-- Expenses can explicitly target the single central account while retaining branch attribution.
create or replace function public.create_expense(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid,p_from_central boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_central boolean;
begin
 if p_amount<=0 or nullif(trim(p_description),'') is null or nullif(trim(p_category),'') is null then raise exception 'invalid expense'; end if;
 select is_central into v_central from public.cash_accounts where id=p_account and active for update;
 if not found then raise exception 'invalid expense account'; end if;
 if p_from_central then
   if not v_central then raise exception 'central cash account required'; end if;
 else
   if v_central or not exists(select 1 from public.cash_accounts where id=p_account and branch_id=p_branch and active) then raise exception 'invalid branch cash account'; end if;
 end if;
 insert into public.expenses(branch_id,cash_account_id,description,category,amount,expense_date,status,created_by)
 values(p_branch,p_account,trim(p_description),trim(p_category),p_amount,p_date,'paid',p_actor) returning id into v_id;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',round(p_amount,2),'expense',v_id,trim(p_description),p_actor);
 return v_id;
end $$;

create or replace function public.pay_payroll(p_payroll uuid,p_account uuid,p_amount numeric,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_due numeric; v_central boolean;
begin
 select e.branch_id,round(p.base_salary+p.commission_amount-p.deductions-p.amount_paid,2)
 into v_branch,v_due
 from public.payroll_entries p join public.employees e on e.id=p.employee_id
 where p.id=p_payroll and p.status='pending' for update of p;
 if not found or p_amount is null or p_amount<=0 or round(p_amount,2)>v_due then raise exception 'invalid payroll payment'; end if;
 select is_central into v_central from public.cash_accounts where id=p_account and active for update;
 if not found or not coalesce(v_central,false) then raise exception 'payroll must be paid from central cash'; end if;
 if public.cash_account_balance(p_account)<round(p_amount,2) then raise exception 'insufficient central cash balance'; end if;
 update public.payroll_entries
 set amount_paid=round(amount_paid+p_amount,2),
     cash_account_id=p_account,
     status=case when round(amount_paid+p_amount,2)>=round(base_salary+commission_amount-deductions,2) then 'paid' else 'pending' end,
     paid_at=case when round(amount_paid+p_amount,2)>=round(base_salary+commission_amount-deductions,2) then now() else paid_at end
 where id=p_payroll;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',round(p_amount,2),'payroll',p_payroll,'صرف راتب/عمولة من الخزنة المركزية',p_actor);
end $$;

create or replace function public.decide_payroll_advance(p_request uuid,p_decision text,p_account uuid,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_amount numeric(12,2); v_status text; v_central boolean;
begin
 select branch_id,amount,status into v_branch,v_amount,v_status from public.payroll_advance_requests where id=p_request for update;
 if not found or v_status<>'pending' then raise exception 'request is not pending'; end if;
 if p_decision='reject' then
   update public.payroll_advance_requests set status='rejected',decided_by=p_actor,decided_at=now() where id=p_request;
 elsif p_decision='pay' then
   select is_central into v_central from public.cash_accounts where id=p_account and active for update;
   if not found or not coalesce(v_central,false) then raise exception 'central cash account required'; end if;
   if public.cash_account_balance(p_account)<round(v_amount,2) then raise exception 'insufficient central cash balance'; end if;
   update public.payroll_advance_requests set status='paid',cash_account_id=p_account,decided_by=p_actor,decided_at=now() where id=p_request;
   insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
   values(p_account,'out',round(v_amount,2),'payroll',p_request,'مسحوبات راتب معتمدة من الخزنة المركزية',p_actor);
 else raise exception 'invalid decision'; end if;
