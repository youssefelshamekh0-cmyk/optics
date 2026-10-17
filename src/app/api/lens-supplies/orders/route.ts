import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

async function ownerOnly() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin")) return { user, response: Response.json({ error: "هذه الشاشة متاحة لمالك البراند" }, { status: 403 }) };
  return { user, response: null };
}

const bodySchema = z.object({
  branchId: z.string().uuid(), company: z.string().trim().min(1).max(120),
  invoiceNumber: z.string().trim().min(1).max(100), supplierName: z.string().trim().min(2).max(160),
  supplierPhone: z.string().trim().max(40).default(""), receivedAt: z.string().datetime(),
  totalAmount: z.number().finite().min(0).max(100000000),
  saleItemIds: z.array(z.string().uuid()).min(1).max(200),
});

/** Ordered (not yet received) prescription lenses of a branch, grouped by lens company. */
export async function GET(request: Request) {
  const { response } = await ownerOnly();
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const branchId = z.string().uuid().safeParse(params.get("branchId") ?? "");
  if (!branchId.success) return Response.json({ error: "حدد الفرع" }, { status: 400 });
  const company = params.get("company")?.trim() ?? "";
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("sale_items")
    .select("id,sale_id,item_name,quantity,technical_details,sales!inner(invoice_number,branch_id,delivery_status,created_at,customers(full_name,phone))")
    .eq("item_kind", "prescription_lens").is("lens_received_at", null)
    .eq("sales.branch_id", branchId.data).neq("sales.delivery_status", "cancelled")
    .limit(1000);
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => {
    const d = row.technical_details ?? {};
    return {
      id: row.id, invoiceNumber: row.sales?.invoice_number, orderedAt: row.sales?.created_at, deliveryStatus: row.sales?.delivery_status,
      customer: row.sales?.customers?.full_name ?? "—", phone: row.sales?.customers?.phone ?? "",
      company: String(d.company ?? "غير محدد"), lensTypeName: String(d.lensTypeName ?? row.item_name), options: String(d.options ?? ""),
      right: d.right ? { sphere: d.right.sphere, cylinder: d.right.cylinder, axis: d.right.axis } : null,
      left: d.left ? { sphere: d.left.sphere, cylinder: d.left.cylinder, axis: d.left.axis } : null,
    };
  });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.company, (counts.get(r.company) ?? 0) + 1);
  const companies = [...counts.entries()].map(([name, pending]) => ({ name, pending })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const orders = company ? rows.filter((r: any) => r.company === company).sort((a: any, b: any) => String(a.orderedAt).localeCompare(String(b.orderedAt))) : [];
  return Response.json({ companies, orders });
}

/** Confirms which ordered lenses arrived and records the supplier invoice. */
export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الفاتورة والعدسات المستلمة" }, { status: 400 });
  const input = parsed.data;
  const ids = input.saleItemIds;
  if (new Set(ids).size !== ids.length) return Response.json({ error: "عدسة مكررة في الفاتورة" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;

  const { data: lines, error } = await admin.from("sale_items").select("id,item_name,technical_details").in("id", ids);
  if (error) throw error;
  if ((lines ?? []).length !== ids.length) return Response.json({ error: "إحدى العدسات غير موجودة" }, { status: 400 });
  if ((lines ?? []).some((l: any) => String(l.technical_details?.company ?? "") !== input.company)) return Response.json({ error: "كل العدسات في الفاتورة يجب أن تكون من نفس الشركة" }, { status: 400 });

  // The owner types the whole supplier invoice amount; it is split evenly per lens in cents (remainder goes to the first lenses).
  const totalCents = Math.round(input.totalAmount * 100);
  const baseCents = Math.floor(totalCents / ids.length), extraCents = totalCents - baseCents * ids.length;
  const costById = new Map(ids.map((id, i) => [id, (baseCents + (i < extraCents ? 1 : 0)) / 100]));
  // The supply invoice keeps a catalogue product per lens type (created once, reused afterwards).
  const productByName = new Map<string, string>();
  const rpcItems: { saleItemId: string; productId: string; unitCost: number }[] = [];
  for (const line of lines ?? []) {
    const d = line.technical_details ?? {};
    const name = `${input.company} ${d.lensTypeName ?? line.item_name}`.trim();
    let productId = productByName.get(name.toLowerCase());
    if (!productId) {
      const lookup = admin.from("products").select("id").eq("active", true).in("category", ["lens", "contact_lens"]);
      const existing = await (/[%_*\\]/.test(name) ? lookup.eq("name", name) : lookup.ilike("name", name)).limit(1).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) productId = existing.data.id;
      else {
        const created = await admin.from("products").insert({ name, category: "lens", created_by: user!.id }).select("id").single();
        if (created.error) throw created.error;
        productId = created.data.id as string;
      }
      productByName.set(name.toLowerCase(), productId!);
    }
    rpcItems.push({ saleItemId: line.id, productId: productId!, unitCost: Math.round((costById.get(line.id) ?? 0) * 100) / 100 });
  }

  const { data, error: rpcError } = await admin.rpc("receive_ordered_lenses", {
    p_invoice_number: input.invoiceNumber, p_supplier_name: input.supplierName, p_supplier_phone: input.supplierPhone,
    p_branch_id: input.branchId, p_received_at: input.receivedAt, p_items: rpcItems, p_created_by: user!.id,
  });
  if (rpcError?.code === "23505") return Response.json({ error: "رقم فاتورة المورد مسجل من قبل" }, { status: 409 });
  if (rpcError?.message?.includes("lens item unavailable")) return Response.json({ error: "إحدى العدسات تم استلامها بالفعل أو فاتورتها ملغاة. حدّث القائمة وحاول مرة أخرى." }, { status: 409 });
  if (rpcError) throw rpcError;
  await audit(user!.id, "lens_supply.receive_orders", "lens_supply", data, { branchId: input.branchId, company: input.company, invoiceNumber: input.invoiceNumber, lenses: rpcItems.length });
  return Response.json({ supplyId: data }, { status: 201 });
}
