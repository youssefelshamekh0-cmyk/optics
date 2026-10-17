-- Append-only cash count reconciliation against the complete ledger balance.
create table if not exists public.cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique,
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  expected_balance numeric(14,2) not null,
  counted_balance numeric(14,2) not null check (counted_balance >= 0),
  difference numeric(14,2) generated always as (counted_balance - expected_balance) stored,
  notes varchar(500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_reconciliations_account_created_idx
  on public.cash_reconciliations(cash_account_id,created_at desc);
alter table public.cash_reconciliations enable row level security;
revoke all on public.cash_reconciliations from public,anon,authenticated;
grant all on public.cash_reconciliations to service_role;

create or replace function public.record_cash_reconciliation(
  p_operation_id uuid,
  p_cash_account_id uuid,
  p_counted_balance numeric,
  p_actor uuid,
  p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.cash_reconciliations%rowtype;
  v_expected numeric(14,2);
  v_id uuid;
begin
  if p_operation_id is null or p_cash_account_id is null or p_actor is null
     or p_counted_balance is null or p_counted_balance < 0 then
    raise exception 'invalid cash reconciliation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operation_id::text,0));
  select * into v_existing from public.cash_reconciliations where operation_id=p_operation_id;
  if found then
    if v_existing.cash_account_id<>p_cash_account_id or v_existing.counted_balance<>round(p_counted_balance,2)
       or v_existing.created_by<>p_actor then raise exception 'cash reconciliation operation id conflict'; end if;
    return pg_catalog.jsonb_build_object('id',v_existing.id,'cashAccountId',v_existing.cash_account_id,
      'expectedBalance',v_existing.expected_balance,'countedBalance',v_existing.counted_balance,
      'difference',v_existing.difference,'replayed',true);
  end if;
  perform 1 from public.cash_accounts where id=p_cash_account_id and active for update;
  if not found then raise exception 'cash account not found or inactive'; end if;
  v_expected:=round(public.cash_account_balance(p_cash_account_id),2);
  insert into public.cash_reconciliations(operation_id,cash_account_id,expected_balance,counted_balance,notes,created_by)
  values(p_operation_id,p_cash_account_id,v_expected,round(p_counted_balance,2),nullif(trim(coalesce(p_notes,'')),''),p_actor)
  returning id into v_id;
  return pg_catalog.jsonb_build_object('id',v_id,'cashAccountId',p_cash_account_id,
    'expectedBalance',v_expected,'countedBalance',round(p_counted_balance,2),
    'difference',round(p_counted_balance,2)-v_expected,'replayed',false);
end;
$$;
revoke all on function public.record_cash_reconciliation(uuid,uuid,numeric,uuid,text) from public,anon,authenticated;
grant execute on function public.record_cash_reconciliation(uuid,uuid,numeric,uuid,text) to service_role;
