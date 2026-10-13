import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({ code: z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_-]+$/u), name: z.string().trim().min(2).max(120), address: z.string().trim().max(500).nullable(), phone: z.string().trim().max(40).nullable(), status: z.enum(["ACTIVE", "INACTIVE"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("branches.manage");
  if (response) return response;
  if (!user!.roles.includes("super_admin")) return Response.json({ error: "إدارة الفروع للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الفرع" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().from("branches").update({ ...parsed.data, code: parsed.data.code.toUpperCase(), status: parsed.data.status === "ACTIVE" ? "active" : "inactive" }).eq("id", id).select().maybeSingle();
  if (error?.code === "23505") return Response.json({ error: "كود الفرع مستخدم بالفعل" }, { status: 409 });
  if (error) throw error;
  if (!data) return Response.json({ error: "الفرع غير موجود" }, { status: 404 });
  await audit(user!.id, "branch.update", "branch", id, parsed.data);
  return Response.json({ branch: { ...data, status: data.status.toUpperCase() } });
}
