import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const lensCategory = z.enum(["lens", "contact_lens"]);
const itemSchema = z.object({
  productId: z.string().uuid().optional(),
  newName: z.string().trim().min(2).max(160).optional(),
  category: lensCategory.default("lens"),
  quantity: z.number().int().min(1).max(100000),
  unitCost: z.number().finite().min(0),
}).refine((item) => Boolean(item.productId) !== Boolean(item.newName), { message: "حدد صنفًا موجودًا أو اسم نوع جديد" });
const requirementSchema = z.object({ saleItemId: z.string().uuid(), unitCost: z.number().finite().min(0).max(1_000_000) });

const schema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100), supplierName: z.string().trim().min(2).max(160),
  supplierPhone: z.string().trim().max(40).default(""), branchId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  items: z.array(itemSchema).max(100).default([]),
  requirements: z.array(requirementSchema).max(200).default([]),
}).refine((value) => value.items.length + value.requirements.length > 0, { message: "حدد عدسة واحدة على الأقل" });

async function ownerOnly() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin")) return { user, response: Response.json({ error: "هذه الشاشة متاحة لمالك البراند" }, { status: 403 }) };
  return { user, response: null };
}

type Side = { sphere?: number | string; cylinder?: number | string; axis?: number | string; priceId?: string };

export async function GET(request: Request) {
  const { response } = await ownerOnly();
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const branchId = params.get("branchId");
  const companyId = params.get("companyId");
  const admin = getSupabaseAdmin();
  const db = admin as any;
  // The lens catalogue must always be returned, even for a branch with no supplies yet,
  // otherwise the receiving form can never be shown for the first supply.
  const [products, companyRows] = await Promise.all([
    admin.from("products").select("id,name,sku,category,brand,model").in("category", ["lens", "contact_lens"]).eq("active", true).order("name"),
    db.from("lens_companies").select("id,name").eq("active", true).order("name"),
  ]);
  if (products.error || companyRows.error) throw products.error ?? companyRows.error;
  const companies = (companyRows.data ?? []) as { id: string; name: string }[];
  if (!branchId) return Response.json({ supplies: [], products: products.data ?? [], companies: companies.map((c) => ({ ...c, pending: 0 })), requirements: [] });

  // Lenses ordered on customer invoices that have not yet been received from the lens company.
  const pending = await db.from("sale_items")
    .select("id,item_name,technical_details,sales!inner(id,invoice_number,branch_id,delivery_status,created_at,customers(full_name,phone))")
    .eq("item_kind", "prescription_lens").eq("supply_status", "pending")
    .eq("sales.branch_id", branchId).neq("sales.delivery_status", "cancelled").limit(1000);
  if (pending.error) throw pending.error;
  const pendingRows = (pending.data ?? []) as any[];
  const countByCompany = new Map<string, number>();
  for (const row of pendingRows) { const name = String(row.technical_details?.company ?? ""); countByCompany.set(name, (countByCompany.get(name) ?? 0) + 1); }
  const selected = companies.find((c) => c.id === companyId) ?? null;

  let requirements: unknown[] = [];
  if (selected) {
    const rows = pendingRows.filter((row) => String(row.technical_details?.company ?? "") === selected.name)
      .sort((a, b) => String(a.sales.created_at).localeCompare(String(b.sales.created_at)));
    const priceIds = [...new Set(rows.flatMap((row) => [row.technical_details?.right?.priceId, row.technical_details?.left?.priceId]).filter((id): id is string => typeof id === "string"))];
    const costRows = priceIds.length ? await db.from("branch_lens_prices").select("id,cost_price").in("id", priceIds) : { data: [], error: null };
    if (costRows.error) throw costRows.error;
    const costById = new Map<string, number>((costRows.data ?? []).map((row: any) => [row.id, Number(row.cost_price)]));
    requirements = rows.map((row) => {
      const right: Side = row.technical_details?.right ?? {}, left: Side = row.technical_details?.left ?? {};
      return {
        id: row.id, invoiceNumber: row.sales.invoice_number, createdAt: row.sales.created_at, deliveryStatus: row.sales.delivery_status,
        customer: row.sales.customers?.full_name ?? "—", phone: row.sales.customers?.phone ?? "",
        lensName: row.technical_details?.lensTypeName ?? row.item_name, options: row.technical_details?.options ?? "",
        right: { sphere: right.sphere ?? null, cylinder: right.cylinder ?? null, axis: right.axis ?? null },
        left: { sphere: left.sphere ?? null, cylinder: left.cylinder ?? null, axis: left.axis ?? null },
        suggestedCost: (right.priceId ? costById.get(right.priceId) ?? 0 : 0) + (left.priceId ? costById.get(left.priceId) ?? 0 : 0),
      };
    });
  }
  const companyList = companies.map((c) => ({ ...c, pending: countByCompany.get(c.name) ?? 0 }));

  const { data: supplies, error } = await admin.from("lens_supplies")
    .select("id,invoice_number,supplier_id,branch_id,received_at,total_cost,status,created_at")
    .eq("branch_id", branchId).order("received_at", { ascending: false }).limit(100);
  if (error) throw error;
  if (!supplies?.length) return Response.json({ supplies: [], products: products.data ?? [], companies: companyList, requirements });
  const [supplierRows, itemRows] = await Promise.all([
    admin.from("suppliers").select("id,name,phone").in("id", [...new Set(supplies.map((row) => row.supplier_id))]),
    db.from("lens_supply_items").select("id,supply_id,product_id,sale_item_id,item_name,quantity,unit_cost,line_total").in("supply_id", supplies.map((row) => row.id)),
  ]);
  if (supplierRows.error || itemRows.error) throw supplierRows.error ?? itemRows.error;
  const supplierMap = new Map((supplierRows.data ?? []).map((row) => [row.id, row]));
  const productMap = new Map((products.data ?? []).map((row) => [row.id, row]));
  const itemsBySupply = new Map<string, any[]>();
  for (const item of (itemRows.data ?? []) as any[]) itemsBySupply.set(item.supply_id, [...(itemsBySupply.get(item.supply_id) ?? []), item]);
  return Response.json({
    supplies: supplies.map((supply) => ({ ...supply, supplier: supplierMap.get(supply.supplier_id) ?? null, items: (itemsBySupply.get(supply.id) ?? []).map((item) => ({ ...item, product: item.product_id ? productMap.get(item.product_id) ?? null : item.item_name ? { name: item.item_name } : null })) })),
    products: products.data ?? [], companies: companyList, requirements,
  });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المورد والفاتورة والعدسات المستلمة" }, { status: 400 });
  const input = parsed.data;
  const admin = getSupabaseAdmin();
  const branch = await admin.from("branches").select("id").eq("id", input.branchId).eq("status", "active").maybeSingle();
  if (branch.error) throw branch.error;
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });
  if (new Set(input.requirements.map((r) => r.saleItemId)).size !== input.requirements.length) return Response.json({ error: "عدسة مكررة في الفاتورة" }, { status: 400 });

  // Resolve every stock line to a catalogue product. New lens types typed by the owner are created on the fly,
  // reusing an existing active product with the same name instead of creating a duplicate.
  const resolved: { productId: string; quantity: number; unitCost: number }[] = [];
  for (const item of input.items) {
    if (item.productId) { resolved.push({ productId: item.productId, quantity: item.quantity, unitCost: item.unitCost }); continue; }
    const name = item.newName!;
    const lookup = admin.from("products").select("id,category,active").eq("active", true).in("category", ["lens", "contact_lens"]);
    const existing = await (/[%_*\\]/.test(name) ? lookup.eq("name", name) : lookup.ilike("name", name)).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) { resolved.push({ productId: existing.data.id, quantity: item.quantity, unitCost: item.unitCost }); continue; }
    const created = await admin.from("products").insert({ name, category: item.category, created_by: user!.id }).select("id").single();
    if (created.error) throw created.error;
    resolved.push({ productId: created.data.id, quantity: item.quantity, unitCost: item.unitCost });
  }
  const ids = resolved.map((item) => item.productId);
  if (new Set(ids).size !== ids.length) return Response.json({ error: "نوع العدسة مكرر في الفاتورة؛ اجمع كميته في سطر واحد" }, { status: 400 });
  if (ids.length) {
    const productRows = await admin.from("products").select("id,category,active").in("id", ids);
    if (productRows.error) throw productRows.error;
    if (productRows.data?.length !== ids.length || productRows.data.some((p) => !p.active || !["lens", "contact_lens"].includes(p.category))) return Response.json({ error: "التوريد يقبل العدسات الطبية واللاصقة النشطة فقط" }, { status: 400 });
  }

  const { data, error } = await (admin as any).rpc("receive_lens_order", {
    p_invoice_number: input.invoiceNumber, p_supplier_name: input.supplierName, p_supplier_phone: input.supplierPhone,
    p_branch_id: input.branchId, p_received_at: input.receivedAt,
    p_items: resolved, p_requirements: input.requirements, p_created_by: user!.id,
  });
  if (error?.code === "23505") return Response.json({ error: "رقم فاتورة المورد مسجل من قبل" }, { status: 409 });
  if (error?.message?.includes("lens requirement not available")) return Response.json({ error: "إحدى العدسات تم استلامها بالفعل أو لم تعد مطلوبة؛ حدّث الصفحة" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "lens_supply.receive", "lens_supply", data, { branchId: input.branchId, invoiceNumber: input.invoiceNumber, stockLines: resolved.length, requiredLenses: input.requirements.length });
  return Response.json({ supplyId: data }, { status: 201 });
}
