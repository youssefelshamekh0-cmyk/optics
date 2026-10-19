import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "تقارير الموظفين متاحة لحساب السوبر أدمن فقط" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const employeeId = params.get("employeeId") ?? "";
  const branchId = params.get("branchId") ?? "";
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) {
    return Response.json({ error: "حدد فترة صحيحة للتقرير" }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as any;
  let employeesQuery = admin.from("employees").select("id,branch_id,full_name,phone,job_title,base_salary,commission_rate,branches(name)").order("full_name");
  if (employeeId) employeesQuery = employeesQuery.eq("id", employeeId);
  if (branchId) employeesQuery = employeesQuery.eq("branch_id", branchId);
  const { data: employees, error: employeesError } = await employeesQuery;
  if (employeesError) return Response.json({ error: "تعذر تحميل بيانات الموظفين" }, { status: 500 });
  const ids = (employees ?? []).map((e: any) => e.id);
  if (!ids.length) return Response.json({ employees: [], payroll: [] });

  const { data: payroll, error } = await admin.from("payroll_entries")
    .select("id,employee_id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status,notes,created_at,paid_at")
    .in("employee_id", ids)
    .lte("period_start", to)
    .gte("period_end", from)
    .order("period_start", { ascending: true })
    .limit(2000);
  if (error) return Response.json({ error: "تعذر تحميل كشوف الرواتب" }, { status: 500 });

  return Response.json({ employees: employees ?? [], payroll: (payroll ?? []).map((p: any) => ({
    ...p,
    base_salary: Number(p.base_salary),
    commission_amount: Number(p.commission_amount),
    deductions: Number(p.deductions),
    amount_paid: Number(p.amount_paid),
    net: Number(p.base_salary) + Number(p.commission_amount) - Number(p.deductions),
    remaining: Math.max(0, Number(p.base_salary) + Number(p.commission_amount) - Number(p.deductions) - Number(p.amount_paid)),
  })) });
}
