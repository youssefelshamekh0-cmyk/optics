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
  const { user, response } = await requirePermission("returns.manage");
  if (response) return response;
  const { id } = await context.params;
  const admin = getSupabaseAdmin();
  const { data: sale, error: saleError } = await admin.from("sales")
    .select("id,branch_id,grand_total").eq("id", id).maybeSingle();
  if (saleError) throw saleError;
  if (!sale) return Response.json({ error: "الفاتورة غير موجودة" }, { status: 404 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(sale.branch_id)) {
    return Response.json({ error: "ليس لديك وصول لهذه الفاتورة" }, { status: 403 });
  }
  const [{ data, error }, { data: returnedItems, error: returnedError }, { data: paymentRows, error: paymentError }, { data: returnRows, error: returnError }] = await Promise.all([
    (admin as any).from("cash_accounts")
      .select("id,name,payment_method").eq("branch_id", sale.branch_id).eq("active", true).order("name"),
    (admin as any).from("sale_return_items")
      .select("sale_item_id,quantity,sale_returns!inner(sale_id)")
      .eq("sale_returns.sale_id", id),
    (admin as any).from("sale_payments").select("amount").eq("sale_id", id),
    (admin as any).from("sale_returns").select("refund_amount").eq("sale_id", id),
  ]);
  if (error) throw error;
  if (returnedError) throw returnedError;
  if (paymentError) throw paymentError;
  if (returnError) throw returnError;
  const returnedQuantities: Record<string, number> = {};
  for (const item of returnedItems ?? []) returnedQuantities[item.sale_item_id] = (returnedQuantities[item.sale_item_id] ?? 0) + Number(item.quantity);
  const paidAmount = (paymentRows ?? []).reduce((sum: number, row: { amount: number }) => sum + Number(row.amount), 0);
  const refundedAmount = (returnRows ?? []).reduce((sum: number, row: { refund_amount: number }) => sum + Number(row.refund_amount), 0);
  return Response.json({ accounts: data ?? [], returnedQuantities, paidAmount, refundedAmount, refundableBalance: Math.max(0, Math.min(paidAmount, Number(sale.grand_total)) - refundedAmount) });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, response } = await requirePermission("returns.manage");
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
    if (/exceeds sold quantity/i.test(message)) {
      return Response.json({ error: "الكمية المطلوبة للمرتجع أكبر من الكمية المتبقية في الفاتورة." }, { status: 409 });
    }
    if (/exceeds net paid amount/i.test(message)) {
      return Response.json({ error: "قيمة المرتجع أكبر من صافي المبلغ الذي دفعه العميل. راجع المدفوع والمرتجعات السابقة." }, { status: 409 });
    }
    if (/invalid refund cash account/i.test(message)) {
      return Response.json({ error: "خزنة رد المبلغ غير تابعة لفرع الفاتورة أو غير مفعّلة. اختر خزنة نشطة من نفس الفرع." }, { status: 409 });
    }
    if (/invalid return|duplicate sale item/i.test(message)) {
      return Response.json({ error: "بيانات المرتجع غير صحيحة أو يوجد بند مكرر." }, { status: 400 });
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
