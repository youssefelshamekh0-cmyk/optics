-- Route legacy expense RPC signatures through the hardened account and balance checks.
create or replace function public.create_expense(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid
) returns uuid language sql security definer set search_path = '' as $$
 select public.create_expense_from_account(p_branch,p_account,p_description,p_category,p_amount,p_date,p_actor,false,gen_random_uuid())
$$;
revoke all on function public.create_expense(uuid,uuid,text,text,numeric,date,uuid) from public,anon,authenticated;
grant execute on function public.create_expense(uuid,uuid,text,text,numeric,date,uuid) to service_role;

create or replace function public.create_expense(
 p_branch uuid,p_account uuid,p_description text,p_category text,p_amount numeric,p_date date,p_actor uuid,p_from_central boolean
) returns uuid language sql security definer set search_path = '' as $$
 select public.create_expense_from_account(p_branch,p_account,p_description,p_category,p_amount,p_date,p_actor,p_from_central,gen_random_uuid())
$$;
revoke all on function public.create_expense(uuid,uuid,text,text,numeric,date,uuid,boolean) from public,anon,authenticated;
grant execute on function public.create_expense(uuid,uuid,text,text,numeric,date,uuid,boolean) to service_role;
