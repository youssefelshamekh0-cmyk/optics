import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const uuid = z.string().uuid();
const countSchema = z.object({ productId: uuid, countedQuantity: z.number().int().min(0).max(100000) });

async function ownerOnly() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin")) return { user, response: Response.json({ error: "الجرد متاح لمالك البراند فقط" }, { status: 403 }) };
  return { user, response: null };
}

export async function GET(request: Request) {
  const { response } = await ownerOnly();
  if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId") ?? "";
  if (!uuid.safeParse(branchId).success) return Response.json({ error: "حدد فرعًا صحيحًا" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  const takes = await admin.from("inventory_stock_counts")
    .select("id,operation_id,branch_id,notes,created_by,created_at,branches(name)")
    .eq("branch_id", branchId).order("created_at", { ascending: false }).limit(30);
  if (takes.error) throw takes.error;
  const ids = (takes.data ?? []).map((row: any) => row.id);
  const items = ids.length
    ? await admin.from("inventory_stock_count_items").select("count_id,product_id,expected_quantity,counted_quantity,quantity_delta,cost_price_snapshot,products(name,sku)").in("count_id", ids)
    : { data: [], error: null };
  if (items.error) throw items.error;
  const byCount = new Map<string, any[]>();
  for (const item of items.data ?? []) byCount.set(item.count_id, [...(byCount.get(item.count_id) ?? []), item]);
  return Response.json({ stockTakes: (takes.data ?? []).map((row: any) => ({ ...row, stock_take_items: byCount.get(row.id) ?? [] })) });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const schema = z.object({
    operationId: uuid, branchId: uuid, notes: z.string().trim().max(500).default(""),
    counts: z.array(countSchema).min(1).max(500),
  });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع الفرع والكميات المدخلة" }, { status: 400 });
  if (new Set(parsed.data.counts.map(x => x.productId)).size !== parsed.data.counts.length) {
    return Response.json({ error: "يوجد صنف مكرر في قائمة الجرد" }, { status: 400 });
  }
  const admin = getSupabaseAdmin() as any;
  const branch = await admin.from("branches").select("id").eq("id", parsed.data.branchId).eq("status", "active").maybeSingle();
  if (branch.error) throw branch.error;
  if (!branch.data) return Response.json({ error: "الفرع غير موجود أو متوقف" }, { status: 400 });
  const { data, error } = await admin.rpc("record_inventory_stock_count", {
    p_operation_id: parsed.data.operationId, p_branch_id: parsed.data.branchId,
    p_actor: user!.id, p_items: parsed.data.counts, p_notes: parsed.data.notes,
  });
  if (error?.message.includes("product not stocked")) return Response.json({ error: "أحد الأصناف لا يحتوي على سجل مخزون في هذا الفرع؛ حدّث القائمة وأعد الجرد." }, { status: 409 });
  if (error?.message.includes("operation id conflict")) return Response.json({ error: "معرّف عملية الجرد مستخدم لفرع أو مستخدم مختلف" }, { status: 409 });
  if (error?.message.includes("duplicate product")) return Response.json({ error: "يوجد صنف مكرر في قائمة الجرد" }, { status: 400 });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const result = { stockTakeId: row?.count_id, countedItems: row?.items_count, adjustedItems: row?.adjusted_items, replayed: false };
  await audit(user!.id, "inventory.stock_take", "inventory_stock_count", String(result.stockTakeId ?? ""), {
    branchId: parsed.data.branchId, operationId: parsed.data.operationId,
    countedItems: result.countedItems, adjustedItems: result.adjustedItems, replayed: result.replayed,
  });
  return Response.json({ result }, { status: 201 });
}
