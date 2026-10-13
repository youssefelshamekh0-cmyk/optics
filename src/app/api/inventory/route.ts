import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const productSchema = z.object({
  branchId: z.string().uuid(), sku: z.string().trim().max(80).default(""),
  name: z.string().trim().min(2).max(160), category: z.enum(["frame", "lens", "accessory", "other"]),
  brand: z.string().trim().max(100).default(""), model: z.string().trim().max(100).default(""),
  color: z.string().trim().max(60).default(""), size: z.string().trim().max(60).default(""),
  quantity: z.number().int().min(0).max(100000), costPrice: z.number().finite().min(0), referencePrice: z.number().finite().min(0),
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
  if (!branchId) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  const admin = getSupabaseAdmin();
  const [products, branchProducts] = await Promise.all([
    admin.from("products").select("id,sku,name,category,brand,model,color,size,active,created_at").eq("active", true).order("name"),
    admin.from("branch_products").select("product_id,cost_price,reference_price,quantity,updated_at").eq("branch_id", branchId),
  ]);
  if (products.error || branchProducts.error) throw products.error ?? branchProducts.error;
  const stock = new Map((branchProducts.data ?? []).map((row) => [row.product_id, row]));
  return Response.json({ products: (products.data ?? []).map((product) => ({ ...product, stock: stock.get(product.id) ?? { quantity: 0, cost_price: 0, reference_price: 0 } })) });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = productSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الصنف والفرع والأسعار" }, { status: 400 });
  const input = parsed.data;
  const { data, error } = await getSupabaseAdmin().rpc("create_optics_product", {
    p_sku: input.sku, p_name: input.name, p_category: input.category, p_brand: input.brand, p_model: input.model,
    p_color: input.color, p_size: input.size, p_branch_id: input.branchId, p_quantity: input.quantity,
    p_cost_price: input.costPrice, p_reference_price: input.referencePrice, p_created_by: user!.id,
  });
  if (error?.code === "23505") return Response.json({ error: "كود الصنف مستخدم من قبل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "product.create", "product", data, { branchId: input.branchId, category: input.category });
  return Response.json({ productId: data }, { status: 201 });
}
