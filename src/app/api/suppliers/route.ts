import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().default(""),
});

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin") && !user.permissions.includes("purchases.manage")) {
    return Response.json({ error: "ليست لديك صلاحية إدارة الموردين" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "أدخل اسم مورد صحيحًا" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("suppliers").upsert({
    name: parsed.data.name, phone: parsed.data.phone || null, active: true,
  }, { onConflict: "name" }).select("id,name,phone").single();
  if (error) throw error;
  return Response.json({ supplier: data }, { status: 201 });
}
