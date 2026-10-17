import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const paymentSchema = z.object({ amount: z.number().finite().positive().max(1_000_000_000), paymentMethod: z.enum(["cash", "card", "instapay", "other"]), notes: z.string().trim().max(500).default(""), operationId: z.string().uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("payments.record");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = paymentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع مبلغ وطريقة الدفع" }, { status: 400 });
  const amount = Math.round(parsed.data.amount * 100) / 100;
  if (amount < 0.01) return Response.json({ error: "الحد الأدنى للدفعة 0.01 جنيه" }, { status: 400 });
  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: sale, error: lookupError } = await admin.from("sales").select("id,branch_id").eq("id", id).maybeSingle();
  if (lookupError) throw lookupError;
  if (!sale) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(sale.branch_id)) return Response.json({ error: "ليس لديك وصول لهذه الفاتورة" }, { status: 403 });
  const { data, error } = await admin.rpc("record_sale_payment", {
    p_sale_id: id, p_amount: amount, p_payment_method: parsed.data.paymentMethod,
    p_received_by: user!.id, p_notes: parsed.data.notes,
  });
  if (error) return Response.json({ error: "تعذر تسجيل الدفعة؛ قد يكون المبلغ أكبر من المتبقي" }, { status: 400 });
  await audit(user!.id, "sale.payment.record", "sale", id, { amount, paymentMethod: parsed.data.paymentMethod, operationId: parsed.data.operationId });
  return Response.json({ paymentId: data }, { status: 201 });
}
