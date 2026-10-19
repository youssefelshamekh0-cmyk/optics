import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { todayCairo, weekRange } from "@/lib/week";

const passwordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });

/** Any signed-in user: own profile, weekly salary and hours (read-only). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const week = weekRange(todayCairo());
  const weekFrom = week.from.toISOString();
  const weekTo = week.to.toISOString();
  const { data: employee, error } = await admin.from("employees").select("id,job_title,base_salary,commission_rate").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  // A seller can be registered in several branches; hours, sales and commission below count across all of them.
  const branchRows = user.branchIds.length ? await admin.from("branches").select("name").in("id", user.branchIds).order("name") : { data: [], error: null };
  if (branchRows.error) throw branchRows.error;
  const branchNames: string[] = (branchRows.data ?? []).map((b: any) => b.name);
  const base = { name: user.name, phone: user.phone, isOwner: user.roles.includes("super_admin"), week: { start: week.start, end: week.end } };
  if (!employee || base.isOwner) return Response.json({ ...base, salary: null, profile: { name: user.name, phone: user.phone ?? "", isOwner: base.isOwner }, employee: null, week: { start: week.start, end: week.end, hoursSeconds: 0, shifts: 0 }, current: null, payroll: [], advances: [], leaves: [] });

  const [shifts, sales, payroll, advances, leaves] = await Promise.all([
    admin.from("seller_shifts").select("opened_at,closed_at").eq("user_id", user.id).gte("opened_at", weekFrom).lt("opened_at", weekTo),
    employee.commission_rate > 0 ? admin.from("sales").select("grand_total").eq("created_by", user.id).neq("delivery_status", "cancelled").gte("created_at", weekFrom).lt("created_at", weekTo) : Promise.resolve({ data: [], error: null }),
    admin.from("payroll_entries").select("id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status").eq("employee_id", employee.id).order("period_start", { ascending: false }).limit(12),
    admin.from("payroll_advance_requests").select("id,amount,notes,status,created_at,decided_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    admin.from("leave_requests").select("id,request_type,start_date,end_date,start_time,end_time,reason,status,decision_note,created_at,decided_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  if (shifts.error || sales.error || payroll.error || advances.error || leaves.error) throw shifts.error ?? sales.error ?? payroll.error ?? advances.error ?? leaves.error;
  const now = Date.now();
  const weekSeconds = Math.round((shifts.data ?? []).reduce((sum: number, s: any) => sum + Math.max(0, ((s.closed_at ? Date.parse(s.closed_at) : now) - Date.parse(s.opened_at)) / 1000), 0));
  const weekSales = (sales.data ?? []).reduce((sum: number, s: any) => sum + Number(s.grand_total), 0);
  const advanceRows = (advances.data ?? []) as any[];
  const advancesPaid = advanceRows.filter((a) => a.status === "paid" && a.decided_at && a.decided_at >= weekFrom && a.decided_at < weekTo).reduce((sum, a) => sum + Number(a.amount), 0);
  const advancesPending = advanceRows.filter((a) => a.status === "pending").reduce((sum, a) => sum + Number(a.amount), 0);
  const rate = Number(employee.commission_rate);
  const payrollRows = (payroll.data ?? []).map((p: any) => {
    const baseAmount = Number(p.base_salary);
    const commission = Number(p.commission_amount);
    const deductions = Number(p.deductions);
    const paid = Number(p.amount_paid);
    return { id: p.id, periodStart: p.period_start, periodEnd: p.period_end, base: baseAmount, commission, deductions, paid, remaining: Math.max(0, baseAmount + commission - deductions - paid), status: p.status };
  });
  const currentPayroll = payrollRows.find((p: any) => p.periodStart <= week.end && p.periodEnd >= week.start);
  const baseAmount = Number(employee.base_salary);
  const commission = Math.round((rate > 0 ? weekSales : 0) * rate) / 100;
  return Response.json({
    ...base,
    profile: { name: user.name, phone: user.phone ?? "", isOwner: false },
    employee: { jobTitle: employee.job_title ?? "موظف", branch: branchNames.join("، "), weeklySalary: baseAmount, commissionRate: rate },
    week: { start: week.start, end: week.end, hoursSeconds: weekSeconds, shifts: (shifts.data ?? []).length },
    current: { salesTotal: rate > 0 ? weekSales : 0, base: baseAmount, commission, deductions: currentPayroll?.deductions ?? 0, advancesPaid, advancesPending, salaryPaid: currentPayroll?.paid ?? 0, remaining: baseAmount + commission - (currentPayroll?.deductions ?? 0) - advancesPaid - (currentPayroll?.paid ?? 0), sheetIssued: Boolean(currentPayroll) },
    payroll: payrollRows,
    advances: advanceRows,
    leaves: leaves.data ?? [],
  });
}

/** Any signed-in user can change their own password after confirming the current one. */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = passwordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف" }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword === currentPassword) return Response.json({ error: "كلمة المرور الجديدة مطابقة للحالية" }, { status: 400 });
  if (!user.phone) return Response.json({ error: "لا يوجد رقم موبايل مرتبط بالحساب" }, { status: 400 });

  // Verify the current password with a throwaway client so the caller's own session cookies are untouched.
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: verifyError } = await verifier.auth.signInWithPassword({ phone: user.phone, password: currentPassword });
  if (verifyError) return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 400 });

  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) return Response.json({ error: "تعذر تغيير كلمة المرور" }, { status: 400 });
  await audit(user.id, "user.password_change", "user", user.id, {});
  return Response.json({ success: true });
}
