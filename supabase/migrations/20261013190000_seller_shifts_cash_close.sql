create table public.seller_shifts(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.user_profiles(id) on delete restrict,
 branch_id uuid not null references public.branches(id) on delete restrict,
 cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
 opening_cash numeric(12,2) not null default 0 check(opening_cash>=0),
 closing_cash numeric(12,2) check(closing_cash>=0),
 expected_cash numeric(12,2),
 variance numeric(12,2),
 status text not null default 'open' check(status in ('open','closed')),
 opened_at timestamptz not null default now(),
 closed_at timestamptz,
 closing_notes varchar(500),
 created_at timestamptz not null default now(),
 check((status='open' and closed_at is null and closing_cash is null) or (status='closed' and closed_at is not null and closing_cash is not null))
);
create unique index seller_shifts_one_open_per_user_idx on public.seller_shifts(user_id) where status='open';
create index seller_shifts_branch_time_idx on public.seller_shifts(branch_id,opened_at desc);
alter table public.cash_transactions add column shift_id uuid references public.seller_shifts(id) on delete restrict;
create index cash_transactions_shift_idx on public.cash_transactions(shift_id,created_at);
alter table public.seller_shifts enable row level security;
revoke all on public.seller_shifts from anon,authenticated;
grant all on public.seller_shifts to service_role;

create or replace function public.guard_seller_sale_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=new.created_by and r.key='salesperson')
   and not exists(select 1 from public.seller_shifts s where s.user_id=new.created_by and s.branch_id=new.branch_id and s.status='open') then
   raise exception 'seller shift required';
 end if;
 return new;
end $$;
create trigger sales_require_open_shift before insert on public.sales for each row execute function public.guard_seller_sale_shift();

create or replace function public.attach_seller_transaction_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_branch uuid; v_method text; v_shift uuid;
begin
 select branch_id,payment_method into v_branch,v_method from public.cash_accounts where id=new.cash_account_id;
 if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=new.created_by and r.key='salesperson') then
   select id into v_shift from public.seller_shifts where user_id=new.created_by and branch_id=v_branch and status='open';
   if v_shift is null then raise exception 'seller shift required'; end if;
   if v_method='cash' and not exists(select 1 from public.seller_shifts where id=v_shift and cash_account_id=new.cash_account_id) then raise exception 'cash account does not match open shift'; end if;
   new.shift_id:=v_shift;
 end if;
 return new;
end $$;
create trigger cash_transactions_attach_shift before insert on public.cash_transactions for each row execute function public.attach_seller_transaction_shift();

create or replace function public.open_seller_shift(p_user uuid,p_branch uuid,p_cash_account uuid,p_opening_cash numeric)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if p_opening_cash<0 or not exists(select 1 from public.user_branch_access where user_id=p_user and branch_id=p_branch) then raise exception 'invalid shift branch'; end if;
 if not exists(select 1 from public.cash_accounts where id=p_cash_account and branch_id=p_branch and payment_method='cash' and active) then raise exception 'invalid drawer account'; end if;
 insert into public.seller_shifts(user_id,branch_id,cash_account_id,opening_cash) values(p_user,p_branch,p_cash_account,p_opening_cash) returning id into v_id;
 return v_id;
end $$;

create or replace function public.close_seller_shift(p_shift uuid,p_user uuid,p_count numeric,p_notes text default '')
returns table(expected_cash numeric,variance numeric) language plpgsql security definer set search_path = '' as $$
declare v_shift public.seller_shifts%rowtype; v_expected numeric(12,2);
begin
 if p_count<0 then raise exception 'invalid cash count'; end if;
 select * into v_shift from public.seller_shifts where id=p_shift and user_id=p_user and status='open' for update;
 if not found then raise exception 'open shift not found'; end if;
 select round(v_shift.opening_cash+coalesce(sum(case when direction='in' then amount else -amount end),0),2) into v_expected
 from public.cash_transactions where shift_id=v_shift.id and cash_account_id=v_shift.cash_account_id;
 update public.seller_shifts set status='closed',closing_cash=p_count,expected_cash=v_expected,variance=round(p_count-v_expected,2),closed_at=now(),closing_notes=nullif(trim(p_notes),'') where id=v_shift.id;
 return query select v_expected,round(p_count-v_expected,2);
end $$;
revoke all on function public.open_seller_shift(uuid,uuid,uuid,numeric),public.close_seller_shift(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.open_seller_shift(uuid,uuid,uuid,numeric),public.close_seller_shift(uuid,uuid,numeric,text) to service_role;
