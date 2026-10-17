-- Retry-safe sale collections: one operation key creates one payment and one matching ledger movement.
alter table public.financial_operation_keys drop constraint if exists financial_operation_keys_operation_type_check;
alter table public.financial_operation_keys add constraint financial_operation_keys_operation_type_check
  check (operation_type in ('expense','payroll_payment','sale_payment'));

create or replace function public.record_sale_payment_idempotent(
  p_sale_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_received_by uuid,
  p_notes text,
  p_operation_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale public.sales%rowtype;
  v_paid numeric(12,2);
  v_account uuid;
  v_fingerprint text;
  v_inserted integer;
  v_key public.financial_operation_keys%rowtype;
  v_payment uuid;
begin
  if p_operation_id is null or p_sale_id is null or p_received_by is null
     or p_amount is null or p_amount<=0 or p_payment_method not in ('cash','card','instapay','other') then
    raise exception 'invalid sale payment';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'saleId',p_sale_id,'amount',round(p_amount,2),'paymentMethod',p_payment_method,
    'notes',pg_catalog.btrim(coalesce(p_notes,'')),'actorId',p_received_by
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  insert into public.financial_operation_keys(operation_id,operation_type,actor_id,request_fingerprint)
  values(p_operation_id,'sale_payment',p_received_by,v_fingerprint)
  on conflict(operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then
    select * into v_key from public.financial_operation_keys where operation_id=p_operation_id for update;
    if v_key.operation_type<>'sale_payment' or v_key.actor_id<>p_received_by
       or v_key.request_fingerprint<>v_fingerprint then raise exception 'payment idempotency key conflict'; end if;
    if v_key.result_id is null then raise exception 'payment operation incomplete'; end if;
    return v_key.result_id;
  end if;

  select * into v_sale from public.sales where id=p_sale_id for update;
  if not found or v_sale.delivery_status='cancelled' then raise exception 'sale not found or cancelled'; end if;
  if not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p_received_by and r.key='super_admin')
     and not exists(select 1 from public.user_branch_access where user_id=p_received_by and branch_id=v_sale.branch_id) then
    raise exception 'payment branch access denied';
  end if;

  select id into v_account from public.cash_accounts
   where branch_id=v_sale.branch_id and payment_method=p_payment_method and active and not is_central
   order by created_at limit 1 for update;
  if v_account is null then raise exception 'cash account not configured'; end if;
  select coalesce(sum(amount),0) into v_paid from public.sale_payments where sale_id=p_sale_id;
  if round(p_amount,2)>round(v_sale.grand_total-v_paid,2) then raise exception 'payment exceeds remaining balance'; end if;

  insert into public.sale_payments(sale_id,amount,payment_method,notes,received_by)
  values(p_sale_id,round(p_amount,2),p_payment_method,nullif(pg_catalog.btrim(coalesce(p_notes,'')),''),p_received_by)
  returning id into v_payment;
  insert into public.cash_transactions(cash_account_id,direction,amount,transaction_type,reference_id,description,created_by)
  values(v_account,'in',round(p_amount,2),'sale_payment',p_sale_id,
    'تحصيل دفعة فاتورة #'||v_sale.invoice_number::text||' · دفعة '||v_payment::text,p_received_by);
  update public.financial_operation_keys set result_id=v_payment where operation_id=p_operation_id;
  return v_payment;
end;
$$;

revoke all on function public.record_sale_payment_idempotent(uuid,numeric,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_sale_payment_idempotent(uuid,numeric,text,uuid,text,uuid) to service_role;
