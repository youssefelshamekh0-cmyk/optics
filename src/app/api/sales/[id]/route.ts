import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const statusSchema = z.object({ deliveryStatus: z.enum(["pending", "processing", "ready", "delivered"]) });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("deliveries.complete");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "حالة التسليم غير صحيحة" }, { status: 400 });
  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await admin.from("sales").select("id,branch_id,delivery_status").eq("id", id).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(existing.branch_id)) return Response.json({ error: "ليس لديك وصول لهذه الفاتورة" }, { status: 403 });
  if (existing.delivery_status === "cancelled") return Response.json({ error: "الفاتورة ملغاة" }, { status: 400 });
  const { error } = await admin.from("sales").update({ delivery_status: parsed.data.deliveryStatus, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  await audit(user!.id, "sale.delivery.update", "sale", id, { from: existing.delivery_status, to: parsed.data.deliveryStatus });
  return Response.json({ success: true });
}
