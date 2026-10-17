import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { todayCairo, weekRange } from "@/lib/week";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Everything here is scoped to the signed-in user's own record; nothing is read from the request.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const week = weekRange(todayCairo());
  const fromIso = week.from.toISOString(), toIso = week.to.toISOString();

  const employeeResult = await admin.from("employees").select("id,branch_id,job_title,base_salary,commission_rate,branches(name)").eq("user_id", user.id).maybeSingle();
  if (employeeResult.error) throw employeeResult.error;
  const employee = employeeResult.data as { id: string; branch_id: string; job_title: string; base_salary: number; commission_rate: number; branches: { name: string } | null } | null;

  const [shifts, advances, leaves, payroll, sales] = await Promise.all([
    admin.from("seller_shifts").select("opened_at,closed_at").eq("user_id", user.id).gte("opened_at", fromIso).lt("opened_at", toIso),
    admin.from("payroll_advance_requests").select("id,amount,notes,status,created_at,decided_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    admin.from("leave_requests").select("id,request_type,start_date,end_date,start_time,end_time,reason,status,decision_note,created_at,decided_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    employee ? admin.from("payroll_entries").select("id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status").eq("employee_id", employee.id).order("period_start", { ascending: false }).limit(12) : Promise.resolve({ data: [], error: null }),
    employee && Number(employee.commission_rate) > 0
      ? admin.from("sales").select("grand_total").eq("created_by", user.id).eq("branch_id", employee.branch_id).gte("created_at", fromIso).lt("created_at", toIso).neq("delivery_status", "cancelled")
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [shifts, advances, leaves, payroll, sales]) if (result.error) throw result.error;

  const hoursSeconds = Math.round((shifts.data ?? []).reduce((sum: number, s: any) => sum + Math.max(0, ((s.closed_at ? Date.parse(s.closed_at) : Date.now()) - Date.parse(s.opened_at)) / 1000), 0));
  const advanceRows = (advances.data ?? []) as any[];
  const advancesPaid = advanceRows.filter((a) => a.status === "paid" && a.decided_at && a.decided_at >= fromIso && a.decided_at < toIso).reduce((s, a) => s + Number(a.amount), 0);
  const advancesPending = advanceRows.filter((a) => a.status === "pending").reduce((s, a) => s + Number(a.amount), 0);
  const entries = (payroll.data ?? []) as any[];
  const thisWeekEntry = entries.find((e) => e.period_start === week.start) ?? null;

  let current = null as null | Record<string, number | boolean>;
  if (employee) {
    const salesTotal = (sales.data ?? []).reduce((s: number, x: any) => s + Number(x.grand_total), 0);
    const liveCommission = salesTotal * Number(employee.commission_rate) / 100;
    const base = thisWeekEntry ? Number(thisWeekEntry.base_salary) : Number(employee.base_salary);
    const commission = thisWeekEntry ? Number(thisWeekEntry.commission_amount) : liveCommission;
    const deductions = thisWeekEntry ? Number(thisWeekEntry.deductions) : 0;
    const salaryPaid = thisWeekEntry ? Number(thisWeekEntry.amount_paid) : 0;
    current = { salesTotal: round2(salesTotal), base: round2(base), commission: round2(commission), deductions: round2(deductions), advancesPaid: round2(advancesPaid), advancesPending: round2(advancesPending), salaryPaid: round2(salaryPaid), remaining: round2(base + commission - deductions - salaryPaid - advancesPaid), sheetIssued: Boolean(thisWeekEntry) };
  }

  return Response.json({
    profile: { name: user.name, phone: user.phone, isOwner: user.roles.includes("super_admin") },
    employee: employee ? { jobTitle: employee.job_title, branch: employee.branches?.name ?? "", weeklySalary: Number(employee.base_salary), commissionRate: Number(employee.commission_rate) } : null,
    week: { start: week.start, end: week.end, hoursSeconds, shifts: (shifts.data ?? []).length },
    current,
    payroll: entries.map((e) => ({ id: e.id, periodStart: e.period_start, periodEnd: e.period_end, base: Number(e.base_salary), commission: Number(e.commission_amount), deductions: Number(e.deductions), paid: Number(e.amount_paid), remaining: round2(Number(e.base_salary) + Number(e.commission_amount) - Number(e.deductions) - Number(e.amount_paid)), status: e.status })),
    advances: advanceRows,
    leaves: leaves.data ?? [],
  });
}
