import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const validDate = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string, pattern: RegExp) {
  if (!pattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}
function nextCalendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
function cairoMidnightUtc(value: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  const [year, month, day] = value.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let low = target - 36 * 60 * 60 * 1000;
  let high = target + 36 * 60 * 60 * 1000;
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2);
    const parts = Object.fromEntries(formatter.formatToParts(new Date(mid)).map((part) => [part.type, part.value]));
    const localDay = String(parts.year) + "-" + String(parts.month) + "-" + String(parts.day);
    if (localDay >= value) high = mid;
    else low = mid;
  }
  return new Date(high).toISOString();
}


export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "التقارير المالية الشاملة متاحة لحساب السوبر أدمن فقط" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const branchId = params.get("branchId") ?? "";
  if (!isValidCalendarDate(from, validDate) || !isValidCalendarDate(to, validDate) || from > to) {
    return Response.json({ error: "حدد فترة صحيحة للتقرير" }, { status: 400 });
  }

  const start = cairoMidnightUtc(from);
  const end = cairoMidnightUtc(nextCalendarDate(to));
  const admin = getSupabaseAdmin() as any;

  let salesQ = admin.from("sales").select("id,invoice_number,branch_id,grand_total,delivery_status,created_at,branches(name)")
    .gte("created_at", start).lt("created_at", end).neq("delivery_status", "cancelled");
  let expensesQ = admin.from("expenses").select("id,branch_id,amount,expense_date,status,category,description,created_at,branches(name)")
    .gte("expense_date", from).lte("expense_date", to).eq("status", "paid");
  let purchasesQ = admin.from("purchases").select("id,invoice_number,branch_id,total_cost,amount_paid,purchased_at,status,branches(name)")
    .gte("purchased_at", start).lt("purchased_at", end);
  if (branchId) {
    salesQ = salesQ.eq("branch_id", branchId);
    expensesQ = expensesQ.eq("branch_id", branchId);
    purchasesQ = purchasesQ.eq("branch_id", branchId);
  }

  const [salesR, expensesR, purchasesR, branchesR, employeesR, paymentsR, saleLedgerR, outflowsR] = await Promise.all([
    salesQ.order("created_at").limit(5000),
    expensesQ.order("expense_date").limit(5000),
    purchasesQ.order("purchased_at").limit(5000),
    admin.from("branches").select("id,name,code,status").order("name"),
    admin.from("employees").select("id,branch_id,full_name,branches(name)").order("full_name"),
    admin.from("sale_payments").select("id,sale_id,amount,created_at").gte("created_at", start).lt("created_at", end).order("created_at",{ascending:false}).limit(10000),
    admin.from("cash_transactions").select("id,amount,reference_id,created_at,cash_accounts(branch_id)")
      .eq("direction","in").eq("transaction_type","sale_payment").gte("created_at",start).lt("created_at",end).order("created_at",{ascending:false}).limit(20000),
    admin.from("cash_transactions").select("id,cash_account_id,amount,transaction_type,reference_id,created_at,cash_accounts(branch_id)")
      .eq("direction","out").in("transaction_type",["expense","supplier_payment","payroll"])
      .gte("created_at",start).lt("created_at",end).order("created_at",{ascending:false}).limit(20000),
  ]);
  for (const result of [salesR, expensesR, purchasesR, branchesR, employeesR, paymentsR, saleLedgerR, outflowsR]) {
    if (result.error) return Response.json({ error: "تعذر تحميل بيانات التقرير المالي" }, { status: 500 });
  }

  const sales = salesR.data ?? [];
  const rawPayments = paymentsR.data ?? [];
  const paidSaleIds = [...new Set([...rawPayments.map((row: any) => row.sale_id), ...(saleLedgerR.data ?? []).map((row: any) => row.reference_id).filter(Boolean)])];
  const paidSalesR = paidSaleIds.length
    ? await admin.from("sales").select("id,branch_id,branches(name)").in("id", paidSaleIds)
    : { data: [], error: null };
  if (paidSalesR.error) return Response.json({ error: "تعذر ربط التحصيلات بالفروع" }, { status: 500 });
  const paidSaleBranch = new Map((paidSalesR.data ?? []).map((row: any) => [row.id, row.branch_id]));
  const payments = rawPayments.filter((row: any) => {
    const id = paidSaleBranch.get(row.sale_id);
    return Boolean(id) && (!branchId || id === branchId);
  }).map((row: any) => ({ ...row, amount: Number(row.amount), branchId: paidSaleBranch.get(row.sale_id) }));

  const salePaymentTotals = new Map<string, number>();
  const saleLedgerTotals = new Map<string, number>();
  for (const row of payments) salePaymentTotals.set(row.sale_id, (salePaymentTotals.get(row.sale_id) ?? 0) + row.amount);
  const saleLedgerRows = (saleLedgerR.data ?? []).filter((row: any) => {
    const id = paidSaleBranch.get(row.reference_id);
    return Boolean(id) && (!branchId || id === branchId);
  });
  for (const row of saleLedgerRows) saleLedgerTotals.set(row.reference_id, (saleLedgerTotals.get(row.reference_id) ?? 0) + Number(row.amount));
  const paymentLedgerMismatches = [...new Set([...salePaymentTotals.keys(), ...saleLedgerTotals.keys()])]
    .map((saleId) => ({
      saleId,
      paymentTotal: salePaymentTotals.get(saleId) ?? 0,
      ledgerTotal: saleLedgerTotals.get(saleId) ?? 0,
      variance: (salePaymentTotals.get(saleId) ?? 0) - (saleLedgerTotals.get(saleId) ?? 0),
    }))
    .filter((row) => Math.abs(row.variance) > 0.009);

  const outflows = outflowsR.data ?? [];
  const expenseIds = [...new Set(outflows.filter((row: any) => row.transaction_type === "expense").map((row: any) => row.reference_id).filter(Boolean))];
  const purchaseIds = [...new Set(outflows.filter((row: any) => row.transaction_type === "supplier_payment").map((row: any) => row.reference_id).filter(Boolean))];
  const payrollIds = [...new Set(outflows.filter((row: any) => row.transaction_type === "payroll").map((row: any) => row.reference_id).filter(Boolean))];
  const [expenseRefsR, purchaseRefsR, payrollRefsR] = await Promise.all([
    expenseIds.length ? admin.from("expenses").select("id,branch_id").in("id", expenseIds) : { data: [], error: null },
    purchaseIds.length ? admin.from("purchases").select("id,branch_id").in("id", purchaseIds) : { data: [], error: null },
    payrollIds.length ? admin.from("payroll_entries").select("id,employee_id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status,paid_at,employees(branch_id,full_name,branches(name))").in("id", payrollIds) : { data: [], error: null },
  ]);
  if (expenseRefsR.error || purchaseRefsR.error || payrollRefsR.error) {
    return Response.json({ error: "تعذر مطابقة المدفوعات مع فروعها" }, { status: 500 });
  }

  const expenseBranch = new Map((expenseRefsR.data ?? []).map((row: any) => [row.id, row.branch_id]));
  const purchaseBranch = new Map((purchaseRefsR.data ?? []).map((row: any) => [row.id, row.branch_id]));
  const payrollById = new Map((payrollRefsR.data ?? []).map((row: any) => [row.id, row]));
  const branchForOutflow = (row: any) => {
    if (row.transaction_type === "expense") return expenseBranch.get(row.reference_id) ?? row.cash_accounts?.branch_id ?? null;
    if (row.transaction_type === "supplier_payment") return purchaseBranch.get(row.reference_id) ?? row.cash_accounts?.branch_id ?? null;
    if (row.transaction_type === "payroll") return payrollById.get(row.reference_id)?.employees?.branch_id ?? row.cash_accounts?.branch_id ?? null;
    return row.cash_accounts?.branch_id ?? null;
  };
  const allMappedOutflows = outflows.map((row: any) => ({ ...row, amount: Number(row.amount), branchId: branchForOutflow(row) }));
  const unmatchedOutflows = allMappedOutflows.filter((row: any) => !row.branchId);
  const periodOutflows = allMappedOutflows.filter((row: any) => row.branchId && (!branchId || row.branchId === branchId));
  const expenseOutflows = periodOutflows.filter((row: any) => row.transaction_type === "expense");
  const purchaseOutflows = periodOutflows.filter((row: any) => row.transaction_type === "supplier_payment");
  const payrollOutflows = periodOutflows.filter((row: any) => row.transaction_type === "payroll");
  const total = (rows: any[], key: string) => rows.reduce((sum: number, row: any) => sum + Number(row[key] ?? 0), 0);
  const invoiced = total(sales, "grand_total");
  const collected = total(payments, "amount");
  const expenseTotal = total(expenseOutflows, "amount");
  const purchaseTotal = total(purchaseOutflows, "amount");
  const payrollTotal = total(payrollOutflows, "amount");

  const branchNames = new Map((branchesR.data ?? []).map((row: any) => [row.id, row.name]));
  const byBranch = new Map<string, any>();
  const add = (id: string, key: string, value: number) => {
    if (!byBranch.has(id)) byBranch.set(id, { branchId: id, branchName: branchNames.get(id) ?? "—", invoiced: 0, collected: 0, expenses: 0, purchasesPaid: 0, payrollPaid: 0 });
    byBranch.get(id)[key] += value;
  };
  sales.forEach((row: any) => add(row.branch_id, "invoiced", Number(row.grand_total)));
  payments.forEach((row: any) => { if (row.branchId) add(row.branchId, "collected", row.amount); });
  expenseOutflows.forEach((row: any) => add(row.branchId, "expenses", row.amount));
  purchaseOutflows.forEach((row: any) => add(row.branchId, "purchasesPaid", row.amount));
  payrollOutflows.forEach((row: any) => add(row.branchId, "payrollPaid", row.amount));
  const branchRows = [...byBranch.values()].map((row: any) => ({ ...row, netCashFlow: row.collected - row.expenses - row.purchasesPaid - row.payrollPaid }));

  const expenses = (expensesR.data ?? []).map((row: any) => ({
    ...row,
    amount: Number(row.amount),
    paidInPeriod: total(expenseOutflows.filter((outflow: any) => outflow.reference_id === row.id), "amount"),
  }));
  const purchases = (purchasesR.data ?? []).map((row: any) => ({
    ...row,
    total_cost: Number(row.total_cost),
    amount_paid: Number(row.amount_paid),
    paidInPeriod: total(purchaseOutflows.filter((outflow: any) => outflow.reference_id === row.id), "amount"),
  }));
  const payroll = (payrollRefsR.data ?? []).map((row: any) => {
    const paidInPeriod = total(payrollOutflows.filter((outflow: any) => outflow.reference_id === row.id), "amount");
    const net = Number(row.base_salary) + Number(row.commission_amount) - Number(row.deductions);
    return {
      ...row,
      base_salary: Number(row.base_salary),
      commission_amount: Number(row.commission_amount),
      deductions: Number(row.deductions),
      amount_paid: Number(row.amount_paid),
      paidInPeriod,
      net,
      remaining: Math.max(0, net - Number(row.amount_paid)),
      employeeName: row.employees?.full_name ?? "موظف",
    };
  }).filter((row: any) => !branchId || row.employees?.branch_id === branchId);

  return Response.json({
    period: { from, to, branchId: branchId || null },
    branches: branchesR.data ?? [],
    employees: employeesR.data ?? [],
    summary: { salesCount: sales.length, invoiced, collected, expenses: expenseTotal, purchasesPaid: purchaseTotal, payrollPaid: payrollTotal, netCashFlow: collected - expenseTotal - purchaseTotal - payrollTotal },
    integrity: {
      paymentLedgerMismatchCount: paymentLedgerMismatches.length,
      paymentLedgerVariance: paymentLedgerMismatches.reduce((sum, row) => sum + Math.abs(row.variance), 0),
      paymentLedgerMismatches,
      unmatchedOutflowCount: unmatchedOutflows.length,
      unmatchedOutflowAmount: total(unmatchedOutflows, "amount"),
      dataLimit: sales.length >= 5000 || (expensesR.data ?? []).length >= 5000 || (purchasesR.data ?? []).length >= 5000 || rawPayments.length >= 10000 || (saleLedgerR.data ?? []).length >= 20000 || outflows.length >= 20000,
    },
    byBranch: branchRows,
    sales: sales.map((row: any) => ({ ...row, grand_total: Number(row.grand_total) })),
    collections: payments,
    expenses,
    purchases,
    payroll,
    cashOutflows: periodOutflows,
  });
}
