import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { todayCairo } from "@/lib/week";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("leave"), startDate: date, endDate: date, reason: z.string().trim().min(2).max(500) }),
  z.object({ type: z.literal("permission"), startDate: date, startTime: time, endTime: time, reason: z.string().trim().min(2).max(500) }),
]);

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (user.roles.includes("super_admin")) return Response.json({ error: "طلبات الإجازة للموظفين فقط" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الطلب" }, { status: 400 });
  const input = parsed.data;
  const endDate = input.type === "leave" ? input.endDate : input.startDate;
  if (Number.isNaN(Date.parse(input.startDate)) || Number.isNaN(Date.parse(endDate))) return Response.json({ error: "تاريخ غير صالح" }, { status: 400 });
  if (endDate < input.startDate) return Response.json({ error: "نهاية الإجازة قبل بدايتها" }, { status: 400 });
  if (endDate < todayCairo()) return Response.json({ error: "لا يمكن تقديم طلب بتاريخ سابق" }, { status: 400 });
  if (input.type === "leave" && Date.parse(endDate) - Date.parse(input.startDate) > 60 * 86400000) return Response.json({ error: "مدة الإجازة أطول من المسموح" }, { status: 400 });
  if (input.type === "permission" && input.endTime <= input.startTime) return Response.json({ error: "وقت العودة يجب أن يكون بعد وقت الاستئذان" }, { status: 400 });

  const admin = getSupabaseAdmin() as any;
  const employee = await admin.from("employees").select("id,branch_id").eq("user_id", user.id).maybeSingle();
  if (employee.error) throw employee.error;
  const pending = await admin.from("leave_requests").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "pending");
  if (pending.error) throw pending.error;
  if ((pending.count ?? 0) >= 5) return Response.json({ error: "لديك طلبات معلقة كثيرة؛ انتظر مراجعة المالك" }, { status: 429 });

  const branchId = employee.data?.branch_id && user.branchIds.includes(employee.data.branch_id)
    ? employee.data.branch_id
    : user.branchIds[0];
  if (!branchId) return Response.json({ error: "حسابك غير مرتبط بفرع؛ تواصل مع المالك لتصحيح بيانات الموظف" }, { status: 409 });

  const { data, error } = await admin.from("leave_requests").insert({
    user_id: user.id, employee_id: employee.data?.id ?? null, branch_id: branchId,
    request_type: input.type, start_date: input.startDate, end_date: endDate,
    start_time: input.type === "permission" ? input.startTime : null, end_time: input.type === "permission" ? input.endTime : null,
    reason: input.reason, created_by: user.id,
  }).select("id").single();
  if (error) throw error;
  await audit(user.id, `leave.${input.type}.request`, "leave_request", data.id, {});
  return Response.json({ success: true, id: data.id }, { status: 201 });
}

// An employee may withdraw a request that has not been decided yet.
export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "طلب غير صالح" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("leave_requests").update({ status: "cancelled", decided_at: new Date().toISOString() }).eq("id", id.data).eq("user_id", user.id).eq("status", "pending").select("id");
  if (error) throw error;
  if (!data?.length) return Response.json({ error: "لا يمكن إلغاء هذا الطلب" }, { status: 409 });
  await audit(user.id, "leave.cancel", "leave_request", id.data, {});
  return Response.json({ success: true });
}
