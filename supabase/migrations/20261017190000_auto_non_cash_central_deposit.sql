-- Automatically sweep the full positive balance of every non-cash branch account
-- into the brand-level central cash box once per day.
-- Runs at 21:00 UTC (approximately 23:00/00:00 Cairo depending on daylight saving).

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.sweep_non_cash_accounts_to_central()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_central uuid;
  v_account record;
  v_balance numeric(14,2);
  v_amount numeric(14,2);
  v_reference uuid;
  v_count integer := 0;
  v_total numeric(14,2) := 0;
  v_transfers jsonb := '[]'::jsonb;
begin
  -- Serialize scheduled/manual invocations so a retry cannot sweep the same balance twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('optics:sweep_non_cash_accounts_to_central', 0));

  select id
    into v_central
    from public.cash_accounts
   where is_central = true and active = true
   for update;

  if v_central is null then
    raise exception 'active central cash account is missing';
  end if;

  -- Include inactive accounts too: the requirement is to clear every non-cash account,
  -- including accounts that may still hold a carried balance after being deactivated.
  for v_account in
    select a.id, a.name
      from public.cash_accounts a
     where coalesce(a.is_central, false) = false
       and a.branch_id is not null
       and a.payment_method <> 'cash'
     order by a.id
     for update of a
  loop
    v_balance := round(coalesce(public.cash_account_balance(v_account.id), 0), 2);

    -- Never create an invalid/negative transfer. Zero and negative balances are left untouched.
    if v_balance > 0 then
      v_amount := v_balance;
      v_reference := gen_random_uuid();

      insert into public.cash_transactions
        (cash_account_id, direction, amount, transaction_type, reference_id, description, created_by)
      values
        (v_account.id, 'out', v_amount, 'central_deposit', v_reference,
         'توريد تلقائي للخزنة المركزية — نهاية اليوم', null);

      insert into public.cash_transactions
        (cash_account_id, direction, amount, transaction_type, reference_id, description, created_by)
      values
        (v_central, 'in', v_amount, 'central_deposit', v_reference,
         'توريد تلقائي من حساب ' || v_account.name, null);

      v_count := v_count + 1;
      v_total := v_total + v_amount;
      v_transfers := v_transfers || jsonb_build_array(
        jsonb_build_object('accountId', v_account.id, 'accountName', v_account.name, 'amount', v_amount, 'referenceId', v_reference)
      );
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'accountsTransferred', v_count,
    'totalAmount', round(v_total, 2),
    'transfers', v_transfers
  );
end;
$$;

-- The function is only callable by the database owner/cron and the trusted server role.
revoke all on function public.sweep_non_cash_accounts_to_central() from public, anon, authenticated;
grant execute on function public.sweep_non_cash_accounts_to_central() to service_role;

-- Replace an existing job with the same name safely, then schedule one daily run.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'optics-auto-non-cash-central-deposit'
   limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'optics-auto-non-cash-central-deposit',
    '0 21 * * *',
    'select public.sweep_non_cash_accounts_to_central();'
  );
end;
$$;
