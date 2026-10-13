insert into public.permissions(key,description) values
 ('expenses.create','تسجيل مصروفات الفرع'),
 ('payroll.advance.request','طلب مسحوبات أو سلفة راتب')
on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.key='salesperson' and p.key in ('expenses.create','payroll.advance.request') on conflict do nothing;

create table public.payroll_advance_requests(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.user_profiles(id) on delete restrict,
 employee_id uuid references public.employees(id) on delete set null,
 branch_id uuid not null references public.branches(id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 notes varchar(500),
 status text not null default 'pending' check(status in ('pending','paid','rejected')),
 cash_account_id uuid references public.cash_accounts(id) on delete restrict,
 created_by uuid not null references auth.users(id) on delete restrict,
 decided_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 decided_at timestamptz
);
create index payroll_advance_requests_user_time_idx on public.payroll_advance_requests(user_id,created_at desc);
create index payroll_advance_requests_branch_status_idx on public.payroll_advance_requests(branch_id,status,created_at desc);
alter table public.payroll_advance_requests enable row level security;
revoke all on public.payroll_advance_requests from anon,authenticated;
grant all on public.payroll_advance_requests to service_role;

-- Ensure the existing sales team also has a central employee/finance profile.
insert into public.employees(user_id,branch_id,full_name,phone,job_title)
select p.id,access.branch_id,p.full_name,p.phone,'بائع'
from public.user_profiles p
join public.user_roles ur on ur.user_id=p.id
join public.roles r on r.id=ur.role_id and r.key='salesperson'
join lateral (select branch_id from public.user_branch_access where user_id=p.id order by branch_id limit 1) access on true
where p.status='active' and not exists(select 1 from public.employees e where e.user_id=p.id)
on conflict(user_id) do nothing;

create or replace function public.decide_payroll_advance(p_request uuid,p_decision text,p_account uuid,p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_amount numeric(12,2); v_status text;
begin
 select branch_id,amount,status into v_branch,v_amount,v_status from public.payroll_advance_requests where id=p_request for update;
 if not found or v_status<>'pending' then raise exception 'request is not pending'; end if;
 if p_decision='reject' then
   update public.payroll_advance_requests set status='rejected',decided_by=p_actor,decided_at=now() where id=p_request;
 elsif p_decision='pay' then
   if not exists(select 1 from public.cash_accounts where id=p_account and branch_id=v_branch and active) then raise exception 'invalid cash account'; end if;
   update public.payroll_advance_requests set status='paid',cash_account_id=p_account,decided_by=p_actor,decided_at=now() where id=p_request;
   insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
   values(p_account,'out',v_amount,'payroll',p_request,'مسحوبات راتب معتمدة',p_actor);
 else raise exception 'invalid decision'; end if;
end $$;
revoke all on function public.decide_payroll_advance(uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.decide_payroll_advance(uuid,text,uuid,uuid) to service_role;
