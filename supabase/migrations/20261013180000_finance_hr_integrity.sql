-- Opening balances are stored on the account and must not also be added as ledger entries.
create or replace function public.create_cash_account(p_branch uuid,p_name text,p_type text,p_method text,p_opening numeric,p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_opening<0 or p_type not in ('cash','bank','digital') or p_method not in ('cash','card','instapay','other') then raise exception 'invalid cash account'; end if;
  insert into public.cash_accounts(branch_id,name,account_type,payment_method,opening_balance,created_by) values(p_branch,trim(p_name),p_type,p_method,p_opening,p_actor) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_cash_account(uuid,text,text,text,numeric,uuid) from public,anon,authenticated;
grant execute on function public.create_cash_account(uuid,text,text,text,numeric,uuid) to service_role;

create unique index payroll_entries_period_unique_idx on public.payroll_entries(employee_id,period_start,period_end) where status <> 'cancelled';
