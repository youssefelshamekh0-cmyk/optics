import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const itemSchema = z.object({ name: z.string().trim().min(2).max(160), quantity: z.number().int().min(1).max(100), unitPrice: z.number().finite().positive().max(1_000_000) });
const prescriptionSchema = z.object({
  rightSphere: z.string().max(12).default(""), rightCylinder: z.string().max(12).default(""), rightAxis: z.string().max(12).default(""),
  leftSphere: z.string().max(12).default(""), leftCylinder: z.string().max(12).default(""), leftAxis: z.string().max(12).default(""),
  add: z.string().max(12).default(""), pupilDistance: z.string().max(12).default(""),
}).default({ rightSphere: "", rightCylinder: "", rightAxis: "", leftSphere: "", leftCylinder: "", leftAxis: "", add: "", pupilDistance: "" });
const createSaleSchema = z.object({
  branchId: z.string().uuid(), customerId: z.string().uuid(),
  items: z.array(itemSchema).min(1).max(20), discount: z.number().finite().min(0).default(0),
  initialPayment: z.number().finite().min(0).default(0),
  paymentMethod: z.enum(["cash", "card", "instapay", "other"]).default("cash"),
  prescription: prescriptionSchema, notes: z.string().trim().max(1000).default(""),
});

export async function GET(request: Request) {
  const { user, response } = await requirePermission("sales.read");
  if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (branchId && !user!.roles.includes("super_admin") && !user!.branchIds.includes(branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  if (!branchId && !user!.roles.includes("super_admin") && !user!.branchIds.length) return Response.json({ sales: [] });
  const admin = getSupabaseAdmin();
  let query = admin.from("sales").select("id,invoice_number,branch_id,customer_id,total_amount,discount_amount,grand_total,prescription,notes,delivery_status,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (branchId) query = query.eq("branch_id", branchId);
  else if (!user!.roles.includes("super_admin")) query = query.in("branch_id", user!.branchIds);
  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) return Response.json({ sales: [] });
  const saleIds = rows.map((sale) => sale.id);
  const customerIds = [...new Set(rows.map((sale) => sale.customer_id))];
  const branchIds = [...new Set(rows.map((sale) => sale.branch_id))];
  const [items, payments, customers, branches] = await Promise.all([
    admin.from("sale_items").select("id,sale_id,item_name,quantity,unit_price,line_total").in("sale_id", saleIds),
    admin.from("sale_payments").select("id,sale_id,amount,payment_method,notes,created_at").in("sale_id", saleIds).order("created_at", { ascending: true }),
    admin.from("customers").select("id,full_name,phone").in("id", customerIds),
    admin.from("branches").select("id,name,code").in("id", branchIds),
  ]);
  if (items.error || payments.error || customers.error || branches.error) throw new Error("تعذر تحميل تفاصيل الفواتير");
  const customerById = new Map((customers.data ?? []).map((row) => [row.id, row]));
  const branchById = new Map((branches.data ?? []).map((row) => [row.id, row]));
  const itemsBySale = new Map<string, typeof items.data>();
  for (const item of items.data ?? []) itemsBySale.set(item.sale_id, [...(itemsBySale.get(item.sale_id) ?? []), item]);
  const paymentsBySale = new Map<string, typeof payments.data>();
  for (const payment of payments.data ?? []) paymentsBySale.set(payment.sale_id, [...(paymentsBySale.get(payment.sale_id) ?? []), payment]);
  return Response.json({ sales: rows.map((sale) => {
    const salePayments = paymentsBySale.get(sale.id) ?? [];
    const paidAmount = salePayments.reduce((total, payment) => total + Number(payment.amount), 0);
    return { ...sale, paid_amount: paidAmount, due_amount: Math.max(0, Number(sale.grand_total) - paidAmount), customer: customerById.get(sale.customer_id) ?? null, branch: branchById.get(sale.branch_id) ?? null, items: itemsBySale.get(sale.id) ?? [], payments: salePayments };
  }) });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("sales.create");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = createSaleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع العميل والبنود والمبالغ المدخلة" }, { status: 400 });
  const input = parsed.data;
  const roundedItems = input.items.map((item) => ({ ...item, unitPrice: Math.round(item.unitPrice * 100) / 100 }));
  const total = roundedItems.reduce((sum, item) => sum + item.quantity * Math.round(item.unitPrice * 100), 0) / 100;
  const discount = Math.round(input.discount * 100) / 100;
  const initialPayment = Math.round(input.initialPayment * 100) / 100;
  const grandTotal = total - discount;
  if (discount > total || initialPayment > grandTotal) return Response.json({ error: "الخصم أو الدفعة أكبر من إجمالي الفاتورة" }, { status: 400 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(input.branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const admin = getSupabaseAdmin();
  const [branch, customer] = await Promise.all([
    admin.from("branches").select("id").eq("id", input.branchId).eq("status", "active").maybeSingle(),
    admin.from("customers").select("id").eq("id", input.customerId).maybeSingle(),
  ]);
  if (branch.error || customer.error) throw new Error("تعذر التحقق من بيانات الفاتورة");
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });
  if (!customer.data) return Response.json({ error: "العميل غير موجود" }, { status: 400 });
  const { data, error } = await admin.rpc("create_optics_sale", {
    p_branch_id: input.branchId, p_customer_id: input.customerId, p_created_by: user!.id,
    p_discount: discount, p_items: roundedItems, p_prescription: input.prescription,
    p_initial_payment: initialPayment, p_payment_method: input.paymentMethod, p_notes: input.notes,
  });
  if (error) return Response.json({ error: "تعذر إنشاء الفاتورة. راجع المبالغ والبنود." }, { status: 400 });
  const created = Array.isArray(data) ? data[0] : null;
  if (!created) throw new Error("لم ترجع قاعدة البيانات رقم الفاتورة");
  await audit(user!.id, "sale.create", "sale", created.sale_id, { branchId: input.branchId, invoiceNumber: created.invoice_number, total, discount });
  return Response.json({ saleId: created.sale_id, invoiceNumber: created.invoice_number }, { status: 201 });
}
