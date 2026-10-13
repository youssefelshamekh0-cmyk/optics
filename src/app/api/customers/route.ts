import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { normalizeEgyptianPhone } from "@/lib/phone";

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().max(40).optional().default(""),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export async function GET(request: Request) {
  const { user, response } = await requirePermission("customers.read");
  if (response) return response;
  const phoneQuery = new URL(request.url).searchParams.get("phone");
  if (phoneQuery) {
    const normalized = normalizeEgyptianPhone(phoneQuery);
    if (!normalized) return Response.json({ customer: null });
    const { data, error } = await getSupabaseAdmin().from("customers")
      .select("id,full_name,phone,email,notes").eq("phone", normalized.phone).maybeSingle();
    if (error) throw error;
    return Response.json({ customer: data });
  }
  let query = getSupabaseAdmin().from("customers")
    .select("id,full_name,phone,email,notes,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(100);
  const { data, error } = await query;
  if (error) throw error;
  return Response.json({ customers: data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("customers.manage");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = customerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع اسم العميل وبياناته" }, { status: 400 });
  const input = parsed.data;
  const phone = input.phone ? normalizeEgyptianPhone(input.phone)?.phone : null;
  if (input.phone && !phone) return Response.json({ error: "أدخل رقم موبايل مصري صحيح" }, { status: 400 });
  const admin = getSupabaseAdmin();
  if (phone) {
    const { data: existing, error: lookupError } = await admin.from("customers").select("id,full_name,phone,email,notes").eq("phone", phone).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return Response.json({ error: "رقم الموبايل مسجل لعميل بالفعل", customer: existing }, { status: 409 });
  }
  const { data, error } = await admin.from("customers").insert({
    full_name: input.name, phone,
    email: input.email || null, notes: input.notes || null, created_by: user!.id,
  }).select("id,full_name,phone,email,notes,created_at,updated_at").single();
  if (error?.code === "23505") return Response.json({ error: "رقم الموبايل مسجل لعميل بالفعل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "customer.create", "customer", data.id, {});
  return Response.json({ customer: data }, { status: 201 });
}
