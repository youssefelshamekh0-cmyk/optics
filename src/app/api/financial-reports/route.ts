import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const validDate = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "التقارير المالية الشاملة متاحة لحساب السوبر أدمن فقط" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const branchId = params.get("branchId") ?? "";
  if (!validDate.test(from) || !validDate.test(to) || from > to) return Response.json({ error: "حدد فترة صحيحة للتقرير" }, { status: 400 });
  const start = new Date(from + "T00:00:00.000Z").toISOString();
  const end = new Date(new Date(to + "T00:00:00.000Z").getTime() + 86400000).toISOString();
  const admin = getSupabaseAdmin() as any;

  let salesQ = admin.from("sales").select("id,branch_id,grand_total,delivery_status,created_at,branches(name)").gte("created_at", start).lt("created_at", end).neq("delivery_status", "cancelled");
  let expensesQ = admin.from("expenses").select("id,branch_id,amount,expense_date,status,category,branches(name)").gte("expense_date", from).lte("expense_date", to).eq("status", "paid");
  let purchasesQ = admin.from("purchases").select("id,branch_id,total_cost,amount_paid,purchased_at,status,branches(name)").gte("purchased_at", start).lt("purchased_at", end);
  let payrollQ = admin.from("payroll_entries").select("id,employee_id,base_salary,commission_amount,deductions,amount_paid,status,paid_at,employees(branch_id,branches(name))").gte("paid_at", start).lt("paid_at", end).gt("amount_paid", 0);
  if (branchId) {
    salesQ = salesQ.eq("branch_id", branchId);
    expensesQ = expensesQ.eq("branch_id", branchId);
    purchasesQ = purchasesQ.eq("branch_id", branchId);
  }
  const [salesR, expensesR, purchasesR, payrollR, branchesR, employeesR] = await Promise.all([
    salesQ.order("created_at").limit(5000),
    expensesQ.order("expense_date").limit(5000),
    purchasesQ.order("purchased_at").limit(5000),
    payrollQ.order("paid_at").limit(5000),
    admin.from("branches").select("id,name,code,status").order("name"),
    admin.from("employees").select("id,branch_id,full_name,branches(name)").order("full_name"),
  ]);
  for (const result of [salesR, expensesR, purchasesR, payrollR, branchesR, employeesR]) {
    if (result.error) return Response.json({ error: "تعذر تحميل بيانات التقرير المالي" }, { status: 500 });
  }
  const sales = salesR.data ?? [];
  const paymentsR = await admin.from("sale_payments").select("id,sale_id,amount,created_at").gte("created_at", start).lt("created_at", end).limit(10000);
  if (paymentsR.error) return Response.json({ error: "تعذر تحميل تحصيلات الفترة" }, { status: 500 });
  const rawPayments = paymentsR.data ?? [];
  const paidSaleIds = [...new Set(rawPayments.map((x: any) => x.sale_id))];
  const paidSalesR = paidSaleIds.length
    ? await admin.from("sales").select("id,branch_id,branches(name)").in("id", paidSaleIds)
    : { data: [], error: null };
  if (paidSalesR.error) return Response.json({ error: "تعذر ربط التحصيلات بالفروع" }, { status: 500 });
  const paidSaleBranch = new Map((paidSalesR.data ?? []).map((x: any) => [x.id, x.branch_id]));
  const payments = rawPayments.filter((x: any) => {
    const id = paidSaleBranch.get(x.sale_id);
    return id && (!branchId || id === branchId);
  });
  const expenses = expensesR.data ?? [];
  const purchases = purchasesR.data ?? [];
  const payroll = (payrollR.data ?? []).filter((x: any) => !branchId || x.employees?.branch_id === branchId);
  const payments = paymentsR.data ?? [];
  const total = (rows: any[], key: string) => rows.reduce((sum: number, row: any) => sum + Number(row[key] ?? 0), 0);
  const invoiced = total(sales, "grand_total");
  const collected = total(payments, "amount");
  const expenseTotal = total(expenses, "amount");
  const purchaseTotal = total(purchases, "amount_paid");
  const payrollTotal = total(payroll, "amount_paid");
  const groupByBranch = (rows: any[], getBranch: (row: any) => string, key: string) => {
    const result = new Map<string, number>();
    rows.forEach((row) => result.set(getBranch(row), (result.get(getBranch(row)) ?? 0) + Number(row[key] ?? 0)));
    return result;
  };
  const branchNames = new Map((branchesR.data ?? []).map((b: any) => [b.id, b.name]));
  const byBranch = new Map<string, any>();
  const add = (id: string, key: string, value: number) => {
    if (!byBranch.has(id)) byBranch.set(id, { branchId: id, branchName: branchNames.get(id) ?? "—", invoiced: 0, collected: 0, expenses: 0, purchasesPaid: 0, payrollPaid: 0 });
    byBranch.get(id)[key] += value;
  };
  sales.forEach((x: any) => add(x.branch_id, "invoiced", Number(x.grand_total)));
  payments.forEach((x: any) => { const id = paidSaleBranch.get(x.sale_id); if (id) add(id, "collected", Number(x.amount)); });
  expenses.forEach((x: any) => add(x.branch_id, "expenses", Number(x.amount)));
  purchases.forEach((x: any) => add(x.branch_id, "purchasesPaid", Number(x.amount_paid)));
  payroll.forEach((x: any) => { const id = x.employees?.branch_id; if (id) add(id, "payrollPaid", Number(x.amount_paid)); });
  const branchRows = [...byBranch.values()].map((x: any) => ({ ...x, netCashFlow: x.collected - x.expenses - x.purchasesPaid - x.payrollPaid }));
  return Response.json({
    period: { from, to, branchId: branchId || null },
    branches: branchesR.data ?? [],
    employees: employeesR.data ?? [],
    summary: { salesCount: sales.length, invoiced, collected, expenses: expenseTotal, purchasesPaid: purchaseTotal, payrollPaid: payrollTotal, netCashFlow: collected - expenseTotal - purchaseTotal - payrollTotal },
    byBranch: branchRows,
    sales: sales.map((x: any) => ({ ...x, grand_total: Number(x.grand_total) })),
    collections: payments.map((x: any) => ({ ...x, amount: Number(x.amount), branchId: paidSaleBranch.get(x.sale_id) })),
    expenses,
    purchases,
    payroll: payroll.map((x: any) => ({ ...x, base_salary: Number(x.base_salary), commission_amount: Number(x.commission_amount), deductions: Number(x.deductions), amount_paid: Number(x.amount_paid), employeeName: (employeesR.data ?? []).find((e: any) => e.id === x.employee_id)?.full_name ?? "موظف" })),
  });
}
