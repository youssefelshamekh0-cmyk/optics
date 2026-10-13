import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth";

export async function GET(request: Request) {
  const { user, response } = await requirePermission("sales.create");
  if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (!branchId) return Response.json({ products: [] });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const admin = getSupabaseAdmin();
  const [products, stock] = await Promise.all([
    admin.from("products").select("id,sku,name,category,brand,model,color,size").eq("active", true).order("name"),
    admin.from("branch_products").select("product_id,quantity,reference_price,cost_price").eq("branch_id", branchId),
  ]);
  if (products.error || stock.error) throw products.error ?? stock.error;
  const stockByProduct = new Map((stock.data ?? []).map((row) => [row.product_id, row]));
  return Response.json({ products: (products.data ?? []).map((product) => ({ ...product, stock: stockByProduct.get(product.id) ?? { quantity: 0, reference_price: 0, cost_price: 0 } })) });
}
