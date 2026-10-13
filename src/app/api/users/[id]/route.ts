import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({ name: z.string().trim().min(2).max(160), status: z.enum(["ACTIVE", "DISABLED"]), branchIds: z.array(z.string().uuid()).min(1), permissionKeys: z.array(z.string().max(80)), password: z.string().min(12).max(200).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("users.manage");
  if (response) return response;
  if (!user!.roles.includes("super_admin")) return Response.json({ error: "إدارة المستخدمين للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const { id } = await context.params;
  if (id === user!.id) return Response.json({ error: "لا يمكن تغيير حساب المالك من هنا" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المستخدم" }, { status: 400 });
  const input = parsed.data;
  if (new Set(input.branchIds).size !== input.branchIds.length || new Set(input.permissionKeys).size !== input.permissionKeys.length) return Response.json({ error: "توجد اختيارات مكررة" }, { status: 400 });
  const admin = getSupabaseAdmin();
  const permissions = [...new Set([...input.permissionKeys, "branches.read"])];
  const { error } = await admin.rpc("admin_update_salesperson", { p_user_id: id, p_full_name: input.name, p_status: input.status.toLowerCase(), p_branch_ids: input.branchIds, p_permission_keys: permissions });
  if (error) {
    if (error.message.includes("salesperson not found")) return Response.json({ error: "البائع غير موجود" }, { status: 404 });
    return Response.json({ error: "راجع الفروع والصلاحيات المختارة" }, { status: 400 });
  }
  if (input.password) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(id, { password: input.password });
    if (passwordError) return Response.json({ error: "تم حفظ البيانات لكن تعذر تغيير كلمة المرور" }, { status: 400 });
  }
  await audit(user!.id, "user.update", "user", id, { name: input.name, status: input.status, branches: input.branchIds, permissions, passwordChanged: Boolean(input.password) });
  return Response.json({ user: { id, name: input.name, status: input.status } });
}
