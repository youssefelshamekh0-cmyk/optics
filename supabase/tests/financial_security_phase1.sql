-- Integration regression tests for phase-one financial controls.
-- Run on a disposable/staging Supabase database after all migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/financial_security_phase1.sql
-- The entire test is rolled back; it temporarily uses a real active user/branch and the central account.

begin;
do $test$
declare
 v_actor uuid; v_profile uuid; v_branch uuid; v_employee uuid; v_central uuid; v_branch_account uuid;
 v_payroll uuid; v_payroll_key uuid:=gen_random_uuid(); v_expense_key uuid:=gen_random_uuid();
 v_expense_id uuid; v_expense_retry uuid; v_advance uuid;
 v_count bigint; v_paid numeric; v_failed boolean;
begin
 select u.id,p.id into v_actor,v_profile
 from auth.users u join public.user_profiles p on p.id=u.id
 where p.status='active' order by p.created_at limit 1;
 if v_actor is null then raise exception 'TEST FIXTURE MISSING: need one active auth user/profile'; end if;
 select id into v_branch from public.branches order by created_at limit 1;
 if v_branch is null then raise exception 'TEST FIXTURE MISSING: need one branch'; end if;
 select id into v_central from public.cash_accounts where is_central and active limit 1;
 if v_central is null then raise exception 'TEST FIXTURE MISSING: need an active central cash account'; end if;

 insert into public.employees(branch_id,full_name,job_title,base_salary,commission_rate)
 values(v_branch,'__financial_security_test__','اختبار',100,0) returning id into v_employee;
 insert into public.cash_accounts(branch_id,name,account_type,payment_method,opening_balance,active)
 values(v_branch,'__financial_security_test__'||gen_random_uuid()::text,'cash','cash',1000,true)
 returning id into v_branch_account;
 update public.cash_accounts set opening_balance=opening_balance+10000 where id=v_central;

 insert into public.payroll_entries(employee_id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status,created_by)
 values(v_employee,current_date,current_date,100,0,0,0,'pending',v_actor) returning id into v_payroll;

 -- A branch account must never be accepted for central payroll.
 v_failed:=false;
 begin
   perform public.pay_payroll_idempotent(v_payroll,v_branch_account,25,v_actor,gen_random_uuid());
 exception when others then
   if sqlerrm not like '%payroll must be paid from central cash%' then raise; end if;
   v_failed:=true;
 end;
 if not v_failed then raise exception 'TEST FAILED: branch account accepted for payroll'; end if;
 select amount_paid into v_paid from public.payroll_entries where id=v_payroll;
 if v_paid<>0 then raise exception 'TEST FAILED: rejected payroll payout changed payroll'; end if;

 -- Replaying the same operation key must not create another disbursement.
 perform public.pay_payroll_idempotent(v_payroll,v_central,25,v_actor,v_payroll_key);
 perform public.pay_payroll_idempotent(v_payroll,v_central,25,v_actor,v_payroll_key);
 select count(*) into v_count from public.cash_transactions where transaction_type='payroll' and reference_id=v_payroll;
 if v_count<>1 then raise exception 'TEST FAILED: payroll retry created % ledger rows, expected 1',v_count; end if;
 select amount_paid into v_paid from public.payroll_entries where id=v_payroll;
 if v_paid<>25 then raise exception 'TEST FAILED: payroll amount_paid is %, expected 25',v_paid; end if;

 -- Expense retries with the same key return the original expense and one ledger row.
 v_expense_id:=public.create_expense_from_account(v_branch,v_central,'security test expense','test',5,current_date,v_actor,true,v_expense_key);
 v_expense_retry:=public.create_expense_from_account(v_branch,v_central,'security test expense','test',5,current_date,v_actor,true,v_expense_key);
 if v_expense_id<>v_expense_retry then raise exception 'TEST FAILED: expense retry returned a different id'; end if;
 select count(*) into v_count from public.cash_transactions where transaction_type='expense' and reference_id=v_expense_id;
 if v_count<>1 then raise exception 'TEST FAILED: expense retry created % ledger rows, expected 1',v_count; end if;

 -- A central account cannot be disguised as a branch account.
 v_failed:=false;
 begin
   perform public.create_expense_from_account(v_branch,v_central,'wrong source test','test',5,current_date,v_actor,false,gen_random_uuid());
 exception when others then
   if sqlerrm not like '%cash account does not match selected source%' then raise; end if;
   v_failed:=true;
 end;
 if not v_failed then raise exception 'TEST FAILED: central account accepted as branch cash'; end if;

 -- An advance can be paid only from central cash and only once.
 insert into public.payroll_advance_requests(user_id,employee_id,branch_id,amount,notes,status,created_by)
 values(v_profile,v_employee,v_branch,10,'security test','pending',v_actor) returning id into v_advance;
 v_failed:=false;
 begin
   perform public.decide_payroll_advance(v_advance,'pay',v_branch_account,v_actor);
 exception when others then
   if sqlerrm not like '%advance must be paid from central cash%' then raise; end if;
   v_failed:=true;
 end;
 if not v_failed then raise exception 'TEST FAILED: branch account accepted for central advance'; end if;
 perform public.decide_payroll_advance(v_advance,'pay',v_central,v_actor);
 v_failed:=false;
 begin
   perform public.decide_payroll_advance(v_advance,'pay',v_central,v_actor);
 exception when others then
   if sqlerrm not like '%request is not pending%' then raise; end if;
   v_failed:=true;
 end;
 if not v_failed then raise exception 'TEST FAILED: paid advance was paid twice'; end if;
 select count(*) into v_count from public.cash_transactions where transaction_type='payroll_advance' and reference_id=v_advance;
 if v_count<>1 then raise exception 'TEST FAILED: advance has % ledger rows, expected 1',v_count; end if;
 raise notice 'PASS: wrong-account rejection, payroll idempotency, expense idempotency, and single advance payout';
end
$test$;
rollback;
