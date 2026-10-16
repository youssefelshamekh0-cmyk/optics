-- Central cash box (الخزنة المركزية): one brand-level account that sellers deposit into from their shift drawer.

alter table public.cash_accounts alter column branch_id drop not null;
alter table public.cash_accounts add column is_central boolean not null default false;
alter table public.cash_accounts add constraint cash_accounts_branch_or_central_check check (is_central or branch_id is not null);
create unique index cash_accounts_one_central_idx on public.cash_accounts(is_central) where is_central;

insert into public.cash_accounts(branch_id,name,account_type,payment_method,opening_balance,is_central)
values (null,'الخزنة المركزية','cash','cash',0,true);

-- Allow the new ledger entry type.
do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid='public.cash_transactions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%transaction_type%';
  if c is not null then execute format('alter table public.cash_transactions drop constraint %I', c); end if;
end $$;
alter table public.cash_transactions add constraint cash_transactions_transaction_type_check
  check (transaction_type in ('sale_payment','supplier_payment','expense','payroll','commission','adjustment','central_deposit'));

-- The central account has no branch, so the seller-shift trigger must not demand a branch shift for it.
create or replace function public.attach_seller_transaction_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_method text; v_shift uuid;
begin
 select branch_id,payment_method into v_branch,v_method from public.cash_accounts where id=new.cash_account_id;
 if v_branch is null then return new; end if;
 if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=new.created_by and r.key='salesperson') then
   select id into v_shift from public.seller_shifts where user_id=new.created_by and branch_id=v_branch and status='open';
   if v_shift is null then raise exception 'seller shift required'; end if;
   if v_method='cash' and not exists(select 1 from public.seller_shifts where id=v_shift and cash_account_id=new.cash_account_id) then raise exception 'cash account does not match open shift'; end if;
   new.shift_id:=v_shift;
 end if;
 return new;
end $$;

-- Same balance rule the app already uses: opening balance + ledger, ignoring the opening-balance ledger row.
create or replace function public.cash_account_balance(p_account uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(a.opening_balance + coalesce((
    select sum(case when t.direction='in' then t.amount else -t.amount end)
    from public.cash_transactions t
    where t.cash_account_id=a.id and t.description is distinct from 'رصيد افتتاحي'),0),2)
  from public.cash_accounts a where a.id=p_account
$$;

-- A seller moves cash from the open shift drawer to the central box. Both ledger rows are written in one transaction,
-- and the drawer entry stays inside the shift so the closing reconciliation remains correct.
create or replace function public.deposit_to_central(p_shift uuid,p_user uuid,p_amount numeric,p_notes text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_shift public.seller_shifts%rowtype; v_central uuid; v_available numeric(12,2); v_ref uuid := gen_random_uuid(); v_note text; v_amount numeric(12,2);
begin
 v_amount := round(coalesce(p_amount,0),2);
 if v_amount<=0 then raise exception 'invalid amount'; end if;
 select * into v_shift from public.seller_shifts where id=p_shift and user_id=p_user and status='open' for update;
 if not found then raise exception 'open shift not found'; end if;
 select id into v_central from public.cash_accounts where is_central and active;
 if v_central is null then raise exception 'central account missing'; end if;
 select round(v_shift.opening_cash+coalesce(sum(case when direction='in' then amount else -amount end),0),2) into v_available
 from public.cash_transactions where shift_id=v_shift.id and cash_account_id=v_shift.cash_account_id;
 if v_amount>v_available then raise exception 'amount exceeds drawer cash'; end if;
 v_note := left(nullif(trim(coalesce(p_notes,'')),''),200);
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(v_shift.cash_account_id,'out',v_amount,'central_deposit',v_ref,'توريد للخزنة المركزية'||coalesce(' — '||v_note,''),p_user);
 insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
 values(v_central,'in',v_amount,'central_deposit',v_ref,'توريد من بائع'||coalesce(' — '||v_note,''),p_user);
 return v_ref;
end $$;

revoke all on function public.cash_account_balance(uuid), public.deposit_to_central(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.cash_account_balance(uuid), public.deposit_to_central(uuid,uuid,numeric,text) to service_role;
