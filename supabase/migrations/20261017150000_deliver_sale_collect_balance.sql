-- Atomically complete delivery and collect the entire remaining balance in cash.
create or replace function public.deliver_sale_and_collect_balance(p_sale_id uuid,p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric(12,2);
  v_status text;
  v_branch uuid;
  v_paid numeric(12,2);
  v_due numeric(12,2);
  v_account uuid;
  v_payment uuid;
begin
  select grand_total,delivery_status,branch_id
    into v_total,v_status,v_branch
    from public.sales
    where id=p_sale_id
    for update;
  if not found then raise exception 'sale not found'; end if;
  if v_status='cancelled' then raise exception 'cancelled sale'; end if;
  if v_status='delivered' then raise exception 'already delivered'; end if;

  select coalesce(sum(amount),0) into v_paid
    from public.sale_payments where sale_id=p_sale_id;
  v_due:=round(v_total-v_paid,2);
  if v_due < 0 then raise exception 'invoice balance is negative'; end if;

  if v_due > 0 then
    select id into v_account
      from public.cash_accounts
      where branch_id=v_branch and payment_method='cash' and active
      order by created_at limit 1;
    if v_account is null then raise exception 'cash account not configured'; end if;

    insert into public.sale_payments(sale_id,amount,payment_method,notes,received_by)
      values(p_sale_id,v_due,'cash','تحصيل المتبقي عند التسليم',p_actor)
      returning id into v_payment;
    insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
      values(v_account,'in',v_due,'sale_payment',v_payment,'تحصيل المتبقي للفاتورة #'||p_sale_id,p_actor);
  end if;

  update public.sales set delivery_status='delivered',updated_at=now() where id=p_sale_id;
  insert into public.sale_delivery_events(sale_id,from_status,to_status,changed_by,notes)
    values(p_sale_id,v_status,'delivered',p_actor,'تم التسليم وتسجيل كامل المتبقي كدفعة نقدية');
  return v_payment;
end;
$$;

revoke all on function public.deliver_sale_and_collect_balance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.deliver_sale_and_collect_balance(uuid,uuid) to service_role;
