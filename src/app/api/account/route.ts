import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { currentWeek } from "@/lib/week";

const passwordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(200) });

/** Any signed-in user: own profile, weekly salary and hours (read-only). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const week = currentWeek();
  const { data: employee, error } = await admin.from("employees").select("id,job_title,base_salary,commission_rate,branches(name)").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  const base = { name: user.name, phone: user.phone, isOwner: user.roles.includes("super_admin"), week: { start: week.start, end: week.end } };
  if (!employee || base.isOwner) return Response.json({ ...base, salary: null });

  const [shifts, sales, payroll] = await Promise.all([
    admin.from("seller_shifts").select("opened_at,closed_at").eq("user_id", user.id).gte("opened_at", week.from).lt("opened_at", week.to),
    employee.commission_rate > 0 ? admin.from("sales").select("grand_total").eq("created_by", user.id).neq("delivery_status", "cancelled").gte("created_at", week.from).lt("created_at", week.to) : Promise.resolve({ data: [], error: null }),
    admin.from("payroll_entries").select("id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status").eq("employee_id", employee.id).order("period_start", { ascending: false }).limit(8),
  ]);
  if (shifts.error || sales.error || payroll.error) throw shifts.error ?? sales.error ?? payroll.error;
  const now = Date.now();
  const weekSeconds = Math.round((shifts.data ?? []).reduce((sum: number, s: any) => sum + Math.max(0, ((s.closed_at ? Date.parse(s.closed_at) : now) - Date.parse(s.opened_at)) / 1000), 0));
  const weekSales = (sales.data ?? []).reduce((sum: number, s: any) => sum + Number(s.grand_total), 0);
  const rate = Number(employee.commission_rate);
  return Response.json({
    ...base,
    salary: {
      jobTitle: employee.job_title, branch: employee.branches?.name ?? null,
      weeklySalary: Number(employee.base_salary), commissionRate: rate,
      weekSeconds, weekSales: rate > 0 ? weekSales : 0, weekCommission: Math.round(weekSales * rate) / 100,
      payroll: (payroll.data ?? []).map((p: any) => ({ ...p, base_salary: Number(p.base_salary), commission_amount: Number(p.commission_amount), deductions: Number(p.deductions), amount_paid: Number(p.amount_paid) })),
    },
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
