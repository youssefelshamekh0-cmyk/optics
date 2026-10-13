import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeEgyptianPhone } from "@/lib/phone";

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("customers.manage");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = customerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع اسم العميل وبياناته" }, { status: 400 });
  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await admin.from("customers").select("id").eq("id", id).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return Response.json({ error: "العميل غير موجود" }, { status: 404 });
  const input = parsed.data;
  const phone = input.phone ? normalizeEgyptianPhone(input.phone)?.phone : null;
  if (input.phone && !phone) return Response.json({ error: "أدخل رقم موبايل مصري صحيح" }, { status: 400 });
  const { data, error } = await admin.from("customers").update({
    full_name: input.name, phone, email: input.email || null,
    notes: input.notes || null, updated_at: new Date().toISOString(),
  }).eq("id", id).select("id,full_name,phone,email,notes,created_at,updated_at").single();
  if (error?.code === "23505") return Response.json({ error: "رقم الموبايل مسجل لعميل بالفعل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "customer.update", "customer", id, {});
  return Response.json({ customer: data });
}
