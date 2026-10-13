import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeEgyptianPhone } from "@/lib/phone";

const schema = z.object({ phone: z.string().min(10).max(20), name: z.string().trim().min(2).max(160), branchIds: z.array(z.string().uuid()).min(1), permissionKeys: z.array(z.string().max(80)).default([]) });

export async function GET() {
  const { user, response } = await requirePermission("users.read");
  if (response) return response;
  if (!user!.roles.includes("super_admin")) return Response.json({ error: "عرض المستخدمين للمالك فقط" }, { status: 403 });
  const admin = getSupabaseAdmin();
  const { data: profiles, error } = await admin.from("user_profiles").select("id,email,phone,full_name,status,created_at").order("created_at", { ascending: false });
  if (error) throw error;
  const users = await Promise.all((profiles ?? []).map(async (p) => {
    const [roleRows, grantRows, branchRows] = await Promise.all([
      admin.from("user_roles").select("roles(key,name)").eq("user_id", p.id),
      admin.from("user_permissions").select("permissions(key)").eq("user_id", p.id),
      admin.from("user_branch_access").select("branches(id,code,name)").eq("user_id", p.id),
    ]);
    if (roleRows.error || grantRows.error || branchRows.error) throw new Error("تعذر تحميل صلاحيات المستخدمين");
    const roles = roleRows.data as unknown as Array<{ roles: { key: string; name: string } | null }>;
    const grants = grantRows.data as unknown as Array<{ permissions: { key: string } | null }>;
    const branchAccess = branchRows.data as unknown as Array<{ branches: { id: string; code: string; name: string } | null }>;
    return { id: p.id, phone: p.phone, name: p.full_name, status: p.status.toUpperCase(), createdAt: p.created_at, roles: roles.map((r) => ({ role: r.roles })), grants: grants.map((r) => ({ permission: r.permissions })), branchAccess: branchAccess.map((r) => ({ branch: r.branches })) };
  }));
  return Response.json({ users });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("users.manage");
  if (response) return response;
  if (!user!.roles.includes("super_admin")) return Response.json({ error: "إدارة المستخدمين للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المستخدم" }, { status: 400 });
  const input = parsed.data;
  const phone = normalizeEgyptianPhone(input.phone);
  if (!phone) return Response.json({ error: "أدخل رقم موبايل مصري صحيحًا" }, { status: 400 });
  if (new Set(input.branchIds).size !== input.branchIds.length || new Set(input.permissionKeys).size !== input.permissionKeys.length) return Response.json({ error: "توجد اختيارات مكررة" }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: created, error: authError } = await admin.auth.admin.createUser({ phone: phone.phone, password: phone.initialPassword, phone_confirm: true, user_metadata: { full_name: input.name } });
  if (authError || !created.user) {
    if (authError?.message.toLowerCase().includes("already")) return Response.json({ error: "رقم الموبايل مسجل بالفعل" }, { status: 409 });
    return Response.json({ error: "تعذر إنشاء حساب تسجيل الدخول" }, { status: 400 });
  }
  const permissions = [...new Set([...input.permissionKeys, "branches.read"])];
  const { error } = await admin.rpc("admin_create_phone_profile", { p_user_id: created.user.id, p_phone: phone.phone, p_full_name: input.name, p_role_key: "salesperson", p_branch_ids: input.branchIds, p_permission_keys: permissions });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    if (error.code === "23505") return Response.json({ error: "رقم الموبايل مسجل بالفعل" }, { status: 409 });
    return Response.json({ error: "راجع الفروع والصلاحيات المختارة" }, { status: 400 });
  }
  await audit(user!.id, "user.create", "user", created.user.id, { phone: phone.phone, branches: input.branchIds, permissions });
  return Response.json({ user: { id: created.user.id, phone: phone.phone, name: input.name, status: "ACTIVE" } }, { status: 201 });
}
