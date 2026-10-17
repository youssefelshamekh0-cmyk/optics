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
  const takes = await admin.from("stock_takes")
    .select("id,operation_id,branch_id,notes,created_by,created_at,branches(name),stock_take_items(product_id,expected_quantity,counted_quantity,quantity_delta,products(name,sku))")
    .eq("branch_id", branchId).order("created_at", { ascending: false }).limit(30);
  if (takes.error) throw takes.error;
  return Response.json({ stockTakes: takes.data ?? [] });
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
  const { data, error } = await admin.rpc("commit_stock_take", {
    p_operation_id: parsed.data.operationId, p_branch_id: parsed.data.branchId,
    p_actor: user!.id, p_counts: parsed.data.counts, p_notes: parsed.data.notes,
  });
  if (error?.message.includes("stock row missing")) return Response.json({ error: "أحد الأصناف لا يحتوي على سجل مخزون في هذا الفرع؛ حدّث القائمة وأعد الجرد." }, { status: 409 });
  if (error?.message.includes("stock take branch inactive")) return Response.json({ error: "لا يمكن إجراء جرد لفرع غير نشط" }, { status: 409 });
  if (error?.message.includes("operation id conflict")) return Response.json({ error: "معرّف عملية الجرد مستخدم لفرع أو مستخدم مختلف" }, { status: 409 });
  if (error?.message.includes("duplicate product")) return Response.json({ error: "يوجد صنف مكرر في قائمة الجرد" }, { status: 400 });
  if (error) throw error;
  const result = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
  const takeId = typeof result.stockTakeId === "string" ? result.stockTakeId : "";
  await audit(user!.id, "inventory.stock_take", "stock_take", takeId, {
    branchId: parsed.data.branchId, operationId: parsed.data.operationId,
    countedItems: result.countedItems, adjustedItems: result.adjustedItems, replayed: result.replayed,
  });
  return Response.json({ result }, { status: 201 });
}
