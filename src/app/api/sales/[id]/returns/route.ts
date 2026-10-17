import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const returnSchema = z.object({
  idempotencyKey: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  items: z.array(z.object({
    saleItemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100),
  })).min(1).max(20),
}).superRefine((value, ctx) => {
  const ids = value.items.map((item) => item.saleItemId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "لا تكرر نفس البند في طلب المرتجع" });
  }
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("payments.record");
  if (response) return response;
  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: sale, error: saleError } = await admin.from("sales")
    .select("id,branch_id").eq("id", id).maybeSingle();
  if (saleError) throw saleError;
  if (!sale) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(sale.branch_id)) {
    return Response.json({ error: "ليس لديك وصول لهذه الفاتورة" }, { status: 403 });
  }
  const { data, error } = await (admin as any).from("cash_accounts")
    .select("id,name,payment_method").eq("branch_id", sale.branch_id).eq("active", true).order("name");
  if (error) throw error;
  return Response.json({ accounts: data ?? [] });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("payments.record");
  if (response) return response;
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  }

  const parsed = returnSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "راجع بنود المرتجع والكمية وخزنة رد المبلغ" }, { status: 400 });
  }

  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: sale, error: lookupError } = await admin
    .from("sales")
    .select("id,branch_id,grand_total")
    .eq("id", id)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (!sale) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(sale.branch_id)) {
    return Response.json({ error: "ليس لديك وصول لهذه الفاتورة" }, { status: 403 });
  }

  const { data, error } = await (admin as any).rpc("process_sale_return", {
    p_sale_id: id,
    p_items: parsed.data.items,
    p_cash_account_id: parsed.data.cashAccountId,
    p_reason: parsed.data.reason,
    p_actor: user!.id,
    p_idempotency_key: parsed.data.idempotencyKey,
  });
  if (error) {
    const message = error.message ?? "";
    if (/sale not found/i.test(message)) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
    if (/exceeds sold quantity|exceeds net paid amount|invalid return|duplicate sale item|invalid refund cash account/i.test(message)) {
      return Response.json({ error: "تعذر تنفيذ المرتجع: راجع الكميات والمبلغ المدفوع وخزنة الفرع" }, { status: 409 });
    }
    throw error;
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.return_id) throw new Error("لم ترجع قاعدة البيانات رقم المرتجع");
  await audit(user!.id, "sale.return.create", "sale", id, {
    returnId: result.return_id,
    refundAmount: Number(result.refund_amount),
    itemCount: parsed.data.items.length,
  });
  return Response.json({
    returnId: result.return_id,
    refundAmount: Number(result.refund_amount),
  }, { status: 201 });
}
