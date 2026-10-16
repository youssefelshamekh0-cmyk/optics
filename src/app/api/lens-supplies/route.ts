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

const schema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100), supplierName: z.string().trim().min(2).max(160),
  supplierPhone: z.string().trim().max(40).default(""), branchId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  items: z.array(itemSchema).min(1).max(100),
});

async function ownerOnly() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin")) return { user, response: Response.json({ error: "هذه الشاشة متاحة لمالك البراند" }, { status: 403 }) };
  return { user, response: null };
}

export async function GET(request: Request) {
  const { response } = await ownerOnly();
  if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  const admin = getSupabaseAdmin();
  // The lens catalogue must always be returned, even for a branch with no supplies yet,
  // otherwise the receiving form can never be shown for the first supply.
  const products = await admin.from("products").select("id,name,sku,category,brand,model").in("category", ["lens", "contact_lens"]).eq("active", true).order("name");
  if (products.error) throw products.error;
  if (!branchId) return Response.json({ supplies: [], products: products.data ?? [] });
  const { data: supplies, error } = await admin.from("lens_supplies")
    .select("id,invoice_number,supplier_id,branch_id,received_at,total_cost,status,created_at")
    .eq("branch_id", branchId).order("received_at", { ascending: false }).limit(100);
  if (error) throw error;
  if (!supplies?.length) return Response.json({ supplies: [], products: products.data ?? [] });
  const [supplierRows, itemRows] = await Promise.all([
    admin.from("suppliers").select("id,name,phone").in("id", [...new Set(supplies.map((row) => row.supplier_id))]),
    admin.from("lens_supply_items").select("id,supply_id,product_id,quantity,unit_cost,line_total").in("supply_id", supplies.map((row) => row.id)),
  ]);
  if (supplierRows.error || itemRows.error) throw supplierRows.error ?? itemRows.error;
  const supplierMap = new Map((supplierRows.data ?? []).map((row) => [row.id, row]));
  const productMap = new Map((products.data ?? []).map((row) => [row.id, row]));
  const itemsBySupply = new Map<string, Array<NonNullable<typeof itemRows.data>[number]>>();
  for (const item of itemRows.data ?? []) itemsBySupply.set(item.supply_id, [...(itemsBySupply.get(item.supply_id) ?? []), item]);
  return Response.json({
    supplies: supplies.map((supply) => ({ ...supply, supplier: supplierMap.get(supply.supplier_id) ?? null, items: (itemsBySupply.get(supply.id) ?? []).map((item) => ({ ...item, product: productMap.get(item.product_id) ?? null })) })),
    products: products.data ?? [],
  });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المورد والفاتورة والأصناف المستلمة" }, { status: 400 });
  const input = parsed.data;
  const admin = getSupabaseAdmin();
  const branch = await admin.from("branches").select("id").eq("id", input.branchId).eq("status", "active").maybeSingle();
  if (branch.error) throw branch.error;
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });

  // Resolve every line to a catalogue product. New lens types typed by the owner are created on the fly,
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
  const productRows = await admin.from("products").select("id,category,active").in("id", ids);
  if (productRows.error) throw productRows.error;
  if (productRows.data?.length !== ids.length || productRows.data.some((p) => !p.active || !["lens", "contact_lens"].includes(p.category))) return Response.json({ error: "التوريد يقبل العدسات الطبية واللاصقة النشطة فقط" }, { status: 400 });

  const { data, error } = await admin.rpc("receive_lens_supply", {
    p_invoice_number: input.invoiceNumber, p_supplier_name: input.supplierName, p_supplier_phone: input.supplierPhone,
    p_branch_id: input.branchId, p_received_at: input.receivedAt,
    p_items: resolved, p_created_by: user!.id,
  });
  if (error?.code === "23505") return Response.json({ error: "رقم فاتورة المورد مسجل من قبل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "lens_supply.receive", "lens_supply", data, { branchId: input.branchId, invoiceNumber: input.invoiceNumber, lines: resolved.length });
  return Response.json({ supplyId: data }, { status: 201 });
}
