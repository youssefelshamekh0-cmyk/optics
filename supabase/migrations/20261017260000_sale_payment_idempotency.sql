-- Retry-safe sale collections: one operation key can create at most one payment and ledger movement.
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
  v_fingerprint text;
  v_inserted integer;
  v_key public.financial_operation_keys%rowtype;
  v_payment uuid;
begin
  if p_operation_id is null then raise exception 'operation id required'; end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'saleId',p_sale_id,'amount',round(p_amount,2),'paymentMethod',p_payment_method,
    'notes',trim(coalesce(p_notes,'')),'actorId',p_received_by
  )::text);
  insert into public.financial_operation_keys(operation_id,operation_type,actor_id,request_fingerprint)
  values(p_operation_id,'sale_payment',p_received_by,v_fingerprint)
  on conflict(operation_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then
    select * into v_key from public.financial_operation_keys where operation_id=p_operation_id for update;
    if v_key.operation_type<>'sale_payment' or v_key.actor_id<>p_received_by
       or v_key.request_fingerprint<>v_fingerprint then
      raise exception 'payment idempotency key conflict';
    end if;
    if v_key.result_id is null then raise exception 'payment operation incomplete'; end if;
    return v_key.result_id;
  end if;

  v_payment := public.record_sale_payment(p_sale_id,p_amount,p_payment_method,p_received_by,p_notes);
  update public.financial_operation_keys set result_id=v_payment where operation_id=p_operation_id;
  return v_payment;
end;
$$;
revoke all on function public.record_sale_payment_idempotent(uuid,numeric,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.record_sale_payment_idempotent(uuid,numeric,text,uuid,text,uuid) to service_role;
