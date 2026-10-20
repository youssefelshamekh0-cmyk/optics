import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notifications";
import type { Json } from "@/lib/supabase/database.types";

const itemSchema = z.object({
  name: z.string().trim().min(2).max(160), quantity: z.number().int().min(1).max(100),
  productId: z.string().uuid().nullable().optional(), itemKind: z.enum(["product", "service"]).default("product"),
});
const lensSelectionSchema = z.object({
  lensTypeId: z.string().uuid(), options: z.string().trim().max(300).default(""),
  rightSphere: z.number().finite().min(-30).max(30), rightCylinder: z.number().finite().min(-20).max(20), rightAxis: z.string().max(12).default(""),
  leftSphere: z.number().finite().min(-30).max(30), leftCylinder: z.number().finite().min(-20).max(20), leftAxis: z.string().max(12).default(""),
});
const createSaleSchema = z.object({
  branchId: z.string().uuid(), customerId: z.string().uuid(),
  saleType: z.enum(["medical_glasses", "frame_only", "lenses_only", "sunglasses", "contact_lenses", "sports_glasses", "mixed", "other"]),
  items: z.array(itemSchema).max(20), lensSelection: lensSelectionSchema.nullable().default(null), finalTotal: z.number().finite().positive().max(1_000_000),
  initialPayment: z.number().finite().min(0).default(0),
  paymentMethod: z.enum(["cash", "card", "instapay", "other"]).default("cash"),
  notes: z.string().trim().max(1000).default(""),
  operationId: z.string().uuid().optional(),
});

async function lookupLensPrice(admin: ReturnType<typeof getSupabaseAdmin>, branchId: string, lensTypeId: string, sphere: number, cylinder: number, options: string) {
  const { data, error } = await admin.from("branch_lens_prices")
    .select("id,sphere_min,sphere_max,cylinder_min,cylinder_max,options,reference_price")
    .eq("branch_id", branchId).eq("lens_type_id", lensTypeId).eq("options", options).eq("active", true)
    .lte("sphere_min", sphere).gte("sphere_max", sphere);
  if (error) throw error;
  return (data ?? []).filter((row) => row.cylinder_min === null || (Number(row.cylinder_min) <= cylinder && Number(row.cylinder_max) >= cylinder));
}

export async function GET(request: Request) {
  const { user, response } = await requirePermission("sales.read");
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId");
  const customerId = params.get("customerId");
  if (branchId && !user!.roles.includes("super_admin") && !user!.branchIds.includes(branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  if (!branchId && !user!.roles.includes("super_admin") && !user!.branchIds.length) return Response.json({ sales: [] });
  const admin = getSupabaseAdmin();
  let query = admin.from("sales").select("id,invoice_number,branch_id,customer_id,sale_type,total_amount,discount_amount,grand_total,reference_total,prescription,notes,delivery_status,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (branchId) query = query.eq("branch_id", branchId);
  else if (!user!.roles.includes("super_admin")) query = query.in("branch_id", user!.branchIds);
  if (customerId) query = query.eq("customer_id", customerId);
  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) return Response.json({ sales: [] });
  const saleIds = rows.map((sale) => sale.id);
  const customerIds = [...new Set(rows.map((sale) => sale.customer_id))];
  const branchIds = [...new Set(rows.map((sale) => sale.branch_id))];
  const [items, payments, customers, branches] = await Promise.all([
    admin.from("sale_items").select("id,sale_id,product_id,item_name,quantity,unit_price,line_total,item_kind,technical_details").in("sale_id", saleIds),
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
    const paidAmount = Math.round(salePayments.reduce((total, payment) => total + Number(payment.amount), 0) * 100) / 100;
    const grandTotal = Math.round(Number(sale.grand_total) * 100) / 100;
    const dueAmount = Math.round((grandTotal - paidAmount) * 100) / 100;
    return { ...sale, paid_amount: paidAmount, due_amount: dueAmount, payment_balance_error: dueAmount < -0.009, customer: customerById.get(sale.customer_id) ?? null, branch: branchById.get(sale.branch_id) ?? null, items: itemsBySale.get(sale.id) ?? [], payments: salePayments };
  }) });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("sales.create");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = createSaleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع العميل والبنود والمبالغ المدخلة" }, { status: 400 });
  const input = parsed.data;
  const initialPayment = Math.round(input.initialPayment * 100) / 100;
  const finalTotal = Math.round(input.finalTotal * 100) / 100;
  if (initialPayment > finalTotal) return Response.json({ error: "الدفعة أكبر من سعر البيع النهائي" }, { status: 400 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(input.branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const admin = getSupabaseAdmin();
  const [branch, customer] = await Promise.all([
    admin.from("branches").select("id").eq("id", input.branchId).eq("status", "active").maybeSingle(),
    admin.from("customers").select("id").eq("id", input.customerId).maybeSingle(),
  ]);
  if (branch.error || customer.error) throw new Error("تعذر التحقق من بيانات الفاتورة");
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });
  if (!customer.data) return Response.json({ error: "العميل غير موجود" }, { status: 400 });

  const productIds = [...new Set(input.items.filter((item) => item.itemKind === "product").map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  if (input.items.some((item) => item.itemKind === "product" && !item.productId) || input.items.some((item) => item.itemKind === "service" && item.productId)) {
    return Response.json({ error: "راجع ربط الصنف بالكتالوج" }, { status: 400 });
  }
  const [productsResult, branchProductsResult] = productIds.length ? await Promise.all([
    admin.from("products").select("id,name,category").in("id", productIds).eq("active", true),
    admin.from("branch_products").select("product_id,reference_price").eq("branch_id", input.branchId).in("product_id", productIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (productsResult.error || branchProductsResult.error) throw productsResult.error ?? branchProductsResult.error;
  const productById = new Map((productsResult.data ?? []).map((row) => [row.id, row]));
  const branchProductById = new Map((branchProductsResult.data ?? []).map((row) => [row.product_id, row]));
  const expectedCategory: Record<string, string> = { sunglasses: "sunglasses", contact_lenses: "contact_lens", sports_glasses: "sports_glasses", frame_only: "frame" };
  const items = [] as { name: string; quantity: number; unitPrice: number; productId: string | null; itemKind: "product" | "prescription_lens" | "service"; technicalDetails: Json }[];
  for (const item of input.items) {
    if (item.itemKind === "service") {
      items.push({ name: item.name, quantity: item.quantity, unitPrice: 0, productId: null, itemKind: "service", technicalDetails: {} });
      continue;
    }
    const product = productById.get(item.productId!);
    const branchProduct = branchProductById.get(item.productId!);
    if (!product || !branchProduct) return Response.json({ error: "الصنف غير متاح في مخزون الفرع المحدد" }, { status: 400 });
    const requiredCategory = expectedCategory[input.saleType];
    if (requiredCategory && product.category !== requiredCategory) return Response.json({ error: "نوع الصنف لا يطابق نوع البيع المحدد" }, { status: 400 });
    if (input.saleType === "medical_glasses" && ["sunglasses", "contact_lens", "sports_glasses"].includes(product.category)) return Response.json({ error: "اختر النظارة الشمسية أو الرياضية أو العدسات اللاصقة كنوع بيع مستقل" }, { status: 400 });
    items.push({ name: product.name, quantity: item.quantity, unitPrice: Number(branchProduct.reference_price), productId: product.id, itemKind: "product", technicalDetails: { category: product.category } });
  }

  let prescription: Json = {};
  if (input.lensSelection) {
    const lens = input.lensSelection;
    const [rightMatches, leftMatches, typeResult] = await Promise.all([
      lookupLensPrice(admin, input.branchId, lens.lensTypeId, lens.rightSphere, lens.rightCylinder, lens.options),
      lookupLensPrice(admin, input.branchId, lens.lensTypeId, lens.leftSphere, lens.leftCylinder, lens.options),
      admin.from("lens_types").select("id,name,company_id,category").eq("id", lens.lensTypeId).eq("active", true).maybeSingle(),
    ]);
    if (typeResult.error) throw typeResult.error;
    if (!typeResult.data) return Response.json({ error: "نوع العدسة غير موجود أو متوقف" }, { status: 400 });
    if (rightMatches.length !== 1 || leftMatches.length !== 1) return Response.json({ error: "تعذر اعتماد سعر العدسات: لا يوجد نطاق مطابق أو توجد نطاقات متعارضة. راجع إعدادات الأسعار والقياسات." }, { status: 409 });
    const { data: company, error: companyError } = await admin.from("lens_companies").select("name").eq("id", typeResult.data.company_id).eq("active", true).maybeSingle();
    if (companyError) throw companyError;
    if (!company) return Response.json({ error: "شركة العدسات غير موجودة أو متوقفة" }, { status: 400 });
    const rightReference = Number(rightMatches[0].reference_price);
    const leftReference = Number(leftMatches[0].reference_price);
    const lensName = `${company.name} ${typeResult.data.name}`.trim();
    items.push({
      name: `عدسات طبية — ${lensName}`, quantity: 1, unitPrice: rightReference + leftReference, productId: null,
      itemKind: "prescription_lens",
      technicalDetails: { lensTypeId: lens.lensTypeId, lensTypeName: typeResult.data.name, company: company.name, options: lens.options,
        right: { sphere: lens.rightSphere, cylinder: lens.rightCylinder, axis: lens.rightAxis, priceId: rightMatches[0].id, referencePrice: rightReference },
        left: { sphere: lens.leftSphere, cylinder: lens.leftCylinder, axis: lens.leftAxis, priceId: leftMatches[0].id, referencePrice: leftReference } },
    });
    prescription = { ...lens, lensTypeName: typeResult.data.name, lensCompany: company.name, rightReferencePrice: rightReference, leftReferencePrice: leftReference };
  }
  if (["medical_glasses", "lenses_only"].includes(input.saleType) && !input.lensSelection) return Response.json({ error: "أضف بيانات العدسات الطبية وتسعير العينين قبل حفظ الفاتورة" }, { status: 400 });
  if (items.length === 0 || items.length > 20) return Response.json({ error: "أضف بندًا واحدًا على الأقل" }, { status: 400 });
  if (input.saleType === "medical_glasses" && !items.some((item) => item.itemKind === "product" && item.productId && productById.get(item.productId)?.category === "frame")) return Response.json({ error: "اختر شنبرًا طبيًا من مخزون الفرع" }, { status: 400 });
  if (["sunglasses", "contact_lenses", "sports_glasses", "frame_only"].includes(input.saleType) && !items.some((item) => item.itemKind === "product")) return Response.json({ error: "اختر صنفًا من مخزون الفرع" }, { status: 400 });
  const referenceTotal = Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100;
  if (finalTotal > referenceTotal) {
    return Response.json({ error: "الإجمالي النهائي لا يمكن أن يتجاوز إجمالي البنود المرجعي. راجع الأسعار والخصم." }, { status: 400 });
  }
  const operationId = input.operationId ?? crypto.randomUUID();
  const { data, error } = await admin.rpc("create_optics_sale_idempotent", {
    p_operation_id: operationId, p_actor_id: user!.id,
    p_branch_id: input.branchId, p_customer_id: input.customerId,
    p_sale_type: input.saleType, p_items: items, p_prescription: prescription,
    p_final_total: finalTotal, p_initial_payment: initialPayment,
    p_payment_method: input.paymentMethod, p_notes: input.notes,
  });
  if (error?.message.includes("insufficient product stock")) return Response.json({ error: "الكمية المطلوبة غير متاحة في مخزون الفرع؛ راجع تعارض المخزون قبل إعادة المحاولة." }, { status: 409 });
  if (error?.message.includes("seller shift required")) return Response.json({ error: "افتح وردية أولاً من تبويب نظرة عامة قبل تسجيل الفواتير" }, { status: 409 });
  if (error?.message.includes("idempotency key reused")) return Response.json({ error: "معرّف العملية مستخدم لبيانات مختلفة؛ لا تعِد إرسال الفاتورة بهذا المعرّف." }, { status: 409 });
  if (error) return Response.json({ error: "تعذر إنشاء الفاتورة. راجع المبالغ والبنود." }, { status: 400 });
  const created = (Array.isArray(data) ? data[0] : data) as { saleId?: string; invoiceNumber?: number; sale_id?: string; invoice_number?: number } | null;
  const saleId = created?.saleId ?? created?.sale_id;
  const invoiceNumber = created?.invoiceNumber ?? created?.invoice_number;
  if (!saleId || invoiceNumber === undefined) throw new Error("لم ترجع قاعدة البيانات رقم الفاتورة");
  await audit(user!.id, "sale.create", "sale", saleId, { operationId, branchId: input.branchId, invoiceNumber, saleType: input.saleType, referenceTotal, finalTotal });
  try {
    const soldProductIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
    if (soldProductIds.length) {
      const { data: lowRows, error: stockError } = await admin.from("branch_products")
        .select("branch_id,product_id,quantity,low_stock_threshold,products(name),branches(name)")
        .eq("branch_id", input.branchId).in("product_id", soldProductIds);
      if (!stockError) {
        const role = await admin.from("roles").select("id").eq("key", "super_admin").maybeSingle();
        const ownerRows = role.data ? await admin.from("user_roles").select("user_id").eq("role_id", role.data.id) : { data: [] };
        const owners = (ownerRows.data ?? []).map((row: any) => row.user_id as string);
        for (const stock of lowRows ?? []) {
          if (Number(stock.quantity) <= Number(stock.low_stock_threshold ?? 5)) {
            await notifyUsers(owners, user!.id, {
              eventKey: "low_stock:" + stock.branch_id + ":" + stock.product_id,
              title: "تنبيه نقص مخزون",
              body: (stock.products?.name ?? "صنف") + " · " + (stock.branches?.name ?? "الفرع") + " · المتبقي " + Number(stock.quantity),
              href: "/dashboard", entityType: "branch_product", entityId: stock.product_id,
            });
          }
        }
      }
    }
  } catch (notificationError) {
    console.error("low-stock notification failed", notificationError instanceof Error ? notificationError.message : "unknown");
  }
  return Response.json({ saleId, invoiceNumber, operationId }, { status: 201 });
}
