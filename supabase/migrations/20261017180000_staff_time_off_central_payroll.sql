-- Staff time-off requests and central disbursement support.
create table if not exists public.staff_time_off_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.user_profiles(id) on delete restrict,
 employee_id uuid references public.employees(id) on delete set null,
 branch_id uuid not null references public.branches(id) on delete restrict,
 request_type text not null check (request_type in ('leave','permission')),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 reason varchar(500) not null,
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz,
 reviewer_note varchar(500),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 constraint staff_time_off_valid_period check (ends_at > starts_at)
);
create index if not exists staff_time_off_user_time_idx on public.staff_time_off_requests(user_id,created_at desc);
create index if not exists staff_time_off_status_time_idx on public.staff_time_off_requests(status,created_at desc);
alter table public.staff_time_off_requests enable row level security;
revoke all on public.staff_time_off_requests from anon,authenticated;
grant all on public.staff_time_off_requests to service_role;

-- A dedicated function avoids silently resolving old create_expense calls to the old 7-argument overload.
create or replace function public.create_expense_from_account(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid,p_from_central boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if p_amount<=0 then raise exception 'invalid expense amount'; end if;
 if p_from_central then
   if not exists(select 1 from public.cash_accounts where id=p_account and is_central and active) then raise exception 'invalid central account'; end if;
 else
   if not exists(select 1 from public.cash_accounts where id=p_account and branch_id=p_branch and not is_central and active) then raise exception 'invalid branch cash account'; end if;
 end if;
 insert into public.expenses(branch_id,cash_account_id,description,category,amount,expense_date,status,created_by)
 values(p_branch,p_account,trim(p_description),trim(p_category),p_amount,p_date,'paid',p_actor) returning id into v_id;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',p_amount,'expense',v_id,trim(p_description),p_actor);
 return v_id;
end $$;
revoke all on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean) from public,anon,authenticated;
grant execute on function public.create_expense_from_account(uuid,uuid,text,text,numeric,date,uuid,boolean) to service_role;

create or replace function public.pay_payroll(p_payroll uuid,p_account uuid,p_amount numeric,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_due numeric;
begin
 select (p.base_salary+p.commission_amount-p.deductions-p.amount_paid) into v_due
 from public.payroll_entries p where p.id=p_payroll and p.status='pending' for update;
 if not found or p_amount<=0 or p_amount>v_due then raise exception 'invalid payroll payment'; end if;
 if not exists(select 1 from public.cash_accounts where id=p_account and is_central and active) then raise exception 'payroll must be paid from central cash'; end if;
 if public.cash_account_balance(p_account)<p_amount then raise exception 'insufficient central cash balance'; end if;
 update public.payroll_entries set amount_paid=amount_paid+p_amount,cash_account_id=p_account,
 status=case when amount_paid+p_amount=base_salary+commission_amount-deductions then 'paid' else 'pending' end,
 paid_at=case when amount_paid+p_amount=base_salary+commission_amount-deductions then now() else paid_at end
 where id=p_payroll;
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(p_account,'out',p_amount,'payroll',p_payroll,'صرف راتب/عمولة من الخزنة المركزية',p_actor);
end $$;
revoke all on function public.pay_payroll(uuid,uuid,numeric,uuid) from public,anon,authenticated;
grant execute on function public.pay_payroll(uuid,uuid,numeric,uuid) to service_role;

create or replace function public.decide_payroll_advance(p_request uuid,p_decision text,p_account uuid,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_amount numeric(12,2); v_status text;
begin
 select amount,status into v_amount,v_status from public.payroll_advance_requests where id=p_request for update;
 if not found or v_status<>'pending' then raise exception 'request is not pending'; end if;
 if p_decision='reject' then
   update public.payroll_advance_requests set status='rejected',decided_by=p_actor,decided_at=now() where id=p_request;
 elsif p_decision='pay' then
   if not exists(select 1 from public.cash_accounts where id=p_account and is_central and active) then raise exception 'advance must be paid from central cash'; end if;
   if public.cash_account_balance(p_account)<v_amount then raise exception 'insufficient central cash balance'; end if;
   update public.payroll_advance_requests set status='paid',cash_account_id=p_account,decided_by=p_actor,decided_at=now() where id=p_request;
   insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
   values(p_account,'out',v_amount,'payroll',p_request,'مسحوبات راتب معتمدة من الخزنة المركزية',p_actor);
 else raise exception 'invalid decision'; end if;
end $$;
revoke all on function public.decide_payroll_advance(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.decide_payroll_advance(uuid,text,uuid,uuid) to service_role;
