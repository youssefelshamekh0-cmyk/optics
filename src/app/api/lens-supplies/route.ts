import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100), supplierName: z.string().trim().min(2).max(160),
  supplierPhone: z.string().trim().max(40).default(""), branchId: z.string().uuid(),
  receivedAt: z.string().datetime(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100000), unitCost: z.number().finite().min(0) })).min(1).max(100),
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
  if (!branchId) return Response.json({ supplies: [] });
  const admin = getSupabaseAdmin();
  const { data: supplies, error } = await admin.from("lens_supplies")
    .select("id,invoice_number,supplier_id,branch_id,received_at,total_cost,status,created_at")
    .eq("branch_id", branchId).order("received_at", { ascending: false }).limit(100);
  if (error) throw error;
  if (!supplies?.length) return Response.json({ supplies: [] });
  const [supplierRows, itemRows, branchProducts, products] = await Promise.all([
    admin.from("suppliers").select("id,name,phone").in("id", [...new Set(supplies.map((row) => row.supplier_id))]),
    admin.from("lens_supply_items").select("id,supply_id,product_id,quantity,unit_cost,line_total").in("supply_id", supplies.map((row) => row.id)),
    admin.from("branch_products").select("product_id,quantity,cost_price").eq("branch_id", branchId),
    admin.from("products").select("id,name,sku,category").eq("active", true).order("name"),
  ]);
  if (supplierRows.error || itemRows.error || branchProducts.error || products.error) throw supplierRows.error ?? itemRows.error ?? branchProducts.error ?? products.error;
  const supplierMap = new Map((supplierRows.data ?? []).map((row) => [row.id, row]));
  const productMap = new Map((products.data ?? []).map((row) => [row.id, row]));
  const stockMap = new Map((branchProducts.data ?? []).map((row) => [row.product_id, row]));
  const itemsBySupply = new Map<string, Array<NonNullable<typeof itemRows.data>[number]>>();
  for (const item of itemRows.data ?? []) itemsBySupply.set(item.supply_id, [...(itemsBySupply.get(item.supply_id) ?? []), item]);
  return Response.json({ supplies: supplies.map((supply) => ({ ...supply, supplier: supplierMap.get(supply.supplier_id) ?? null, items: (itemsBySupply.get(supply.id) ?? []).map((item) => ({ ...item, product: productMap.get(item.product_id) ?? null })) })), products: products.data ?? [], stock: Object.fromEntries(stockMap) });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المورد والفاتورة والأصناف المستلمة" }, { status: 400 });
  const input = parsed.data;
  const admin = getSupabaseAdmin();
  const [branch, productRows] = await Promise.all([
    admin.from("branches").select("id").eq("id", input.branchId).eq("status", "active").maybeSingle(),
    admin.from("products").select("id,category,active").in("id", [...new Set(input.items.map((item) => item.productId))]),
  ]);
  if (branch.error || productRows.error) throw branch.error ?? productRows.error;
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });
  if (productRows.data?.length !== new Set(input.items.map((item) => item.productId)).size || productRows.data.some((p) => !p.active || !["lens", "contact_lens"].includes(p.category))) return Response.json({ error: "التوريد يقبل العدسات الطبية واللاصقة النشطة فقط" }, { status: 400 });
  const { data, error } = await admin.rpc("receive_lens_supply", {
    p_invoice_number: input.invoiceNumber, p_supplier_name: input.supplierName, p_supplier_phone: input.supplierPhone,
    p_branch_id: input.branchId, p_received_at: input.receivedAt,
    p_items: input.items.map((item) => ({ productId: item.productId, quantity: item.quantity, unitCost: item.unitCost })),
    p_created_by: user!.id,
  });
  if (error?.code === "23505") return Response.json({ error: "رقم فاتورة المورد مسجل من قبل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "lens_supply.receive", "lens_supply", data, { branchId: input.branchId, invoiceNumber: input.invoiceNumber });
  return Response.json({ supplyId: data }, { status: 201 });
}
