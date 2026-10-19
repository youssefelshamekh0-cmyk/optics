-- Offline-first sales: durable idempotency keys for queued operations.
-- Apply only to an isolated staging database after reviewing this migration.
create table if not exists public.offline_sync_operations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_id uuid not null,
  branch_id uuid not null references public.branches(id) on delete restrict,
  operation_type text not null check (operation_type in ('sale.create')),
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_id, operation_id)
);

create index if not exists offline_sync_operations_branch_created_idx
  on public.offline_sync_operations(branch_id, created_at desc);

alter table public.offline_sync_operations enable row level security;
revoke all on table public.offline_sync_operations from anon, authenticated;
grant all on table public.offline_sync_operations to service_role;

create or replace function public.create_optics_sale_idempotent(
  p_operation_id uuid,
  p_actor_id uuid,
  p_branch_id uuid,
  p_customer_id uuid,
  p_sale_type text,
  p_items jsonb,
  p_prescription jsonb,
  p_final_total numeric,
  p_initial_payment numeric,
  p_payment_method text,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.offline_sync_operations%rowtype;
  v_sale_id uuid;
  v_invoice_number bigint;
  v_result jsonb;
  v_fingerprint text;
begin
  if p_operation_id is null or p_actor_id is null or p_branch_id is null then
    raise exception 'operation id, actor and branch are required';
  end if;

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'branchId', p_branch_id,
    'customerId', p_customer_id,
    'saleType', p_sale_type,
    'items', p_items,
    'prescription', p_prescription,
    'finalTotal', p_final_total,
    'initialPayment', p_initial_payment,
    'paymentMethod', p_payment_method,
    'notes', p_notes
  )::text);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_id::text || ':' || p_operation_id::text, 0)
  );

  select * into v_existing
    from public.offline_sync_operations
   where actor_id = p_actor_id and operation_id = p_operation_id;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint
       or v_existing.branch_id <> p_branch_id
       or v_existing.operation_type <> 'sale.create' then
      raise exception 'idempotency key reused with different request';
    end if;
    return v_existing.result;
  end if;

  select s.sale_id, s.invoice_number
    into v_sale_id, v_invoice_number
    from public.create_optics_sale(
      p_branch_id, p_customer_id, p_actor_id, p_sale_type, p_items,
      p_prescription, p_final_total, p_initial_payment, p_payment_method, p_notes
    ) s;

  v_result := pg_catalog.jsonb_build_object(
    'success', true,
    'saleId', v_sale_id,
    'invoiceNumber', v_invoice_number,
    'operationId', p_operation_id
  );

  insert into public.offline_sync_operations(
    actor_id, operation_id, branch_id, operation_type, request_fingerprint, result
  ) values (
    p_actor_id, p_operation_id, p_branch_id, 'sale.create', v_fingerprint, v_result
  );

  return v_result;
end;
$$;

revoke all on function public.create_optics_sale_idempotent(uuid,uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.create_optics_sale_idempotent(uuid,uuid,uuid,uuid,text,jsonb,jsonb,numeric,numeric,text,text)
  to service_role;
