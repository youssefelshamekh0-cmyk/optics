-- Manual, owner-authorized sweep of positive balances from non-cash branch accounts
-- into the brand-level central cash box. No pg_cron extension or scheduled job is created.
-- A NULL p_account means all active non-cash branch accounts; a UUID means one account.
create or replace function public.deposit_non_cash_accounts_to_central(
  p_account uuid default null,
  p_actor uuid default null
)
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
  if p_actor is null or not exists (
    select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.user_id = p_actor and r.key = 'super_admin'
  ) then
    raise exception 'central treasury deposit is owner-only';
  end if;

  -- Serialize sweeps so concurrent requests cannot transfer the same balance twice.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('optics:manual_non_cash_central_deposit', 0));

  select id
    into v_central
    from public.cash_accounts
   where is_central = true and active = true
   for update;

  if v_central is null then
    raise exception 'active central cash account is missing';
  end if;

  if p_account is not null and not exists (
    select 1 from public.cash_accounts a
     where a.id = p_account
       and a.is_central = false
       and a.branch_id is not null
       and a.active = true
       and a.payment_method <> 'cash'
  ) then
    raise exception 'selected account is not an active non-cash branch account';
  end if;

  for v_account in
    select a.id, a.name
      from public.cash_accounts a
     where coalesce(a.is_central, false) = false
       and a.branch_id is not null
       and a.active = true
       and a.payment_method <> 'cash'
       and (p_account is null or a.id = p_account)
     order by a.id
     for update of a
  loop
    v_balance := round(coalesce(public.cash_account_balance(v_account.id), 0), 2);

    if v_balance > 0 then
      v_amount := v_balance;
      v_reference := gen_random_uuid();

      insert into public.cash_transactions
        (cash_account_id, direction, amount, transaction_type, reference_id, description, created_by)
      values
        (v_account.id, 'out', v_amount, 'central_deposit', v_reference,
         'توريد يدوي للخزنة المركزية', p_actor);

      insert into public.cash_transactions
        (cash_account_id, direction, amount, transaction_type, reference_id, description, created_by)
      values
        (v_central, 'in', v_amount, 'central_deposit', v_reference,
         'توريد يدوي من حساب ' || v_account.name, p_actor);

      v_count := v_count + 1;
      v_total := v_total + v_amount;
      v_transfers := v_transfers || jsonb_build_array(
        jsonb_build_object(
          'accountId', v_account.id,
          'accountName', v_account.name,
          'amount', v_amount,
          'referenceId', v_reference,
          'status', 'transferred'
        )
      );
    else
      v_transfers := v_transfers || jsonb_build_array(
        jsonb_build_object(
          'accountId', v_account.id,
          'accountName', v_account.name,
          'amount', 0,
          'referenceId', null,
          'status', 'no_positive_balance'
        )
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

revoke all on function public.deposit_non_cash_accounts_to_central(uuid, uuid) from public, anon, authenticated;
grant execute on function public.deposit_non_cash_accounts_to_central(uuid, uuid) to service_role;
