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
  operationId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  const { user, response } = await requirePermission("customers.read");
  if (response) return response;
  const admin = getSupabaseAdmin();
  let allowedCustomerIds: string[] | null = null;
  if (!user!.roles.includes("super_admin")) {
    const [sales, createdCustomers] = await Promise.all([
      user!.branchIds.length ? admin.from("sales").select("customer_id").in("branch_id", user!.branchIds).limit(10000) : Promise.resolve({ data: [], error: null }),
      admin.from("customers").select("id").eq("created_by", user!.id).limit(10000),
    ]);
    if (sales.error || createdCustomers.error) throw sales.error ?? createdCustomers.error;
    allowedCustomerIds = [...new Set([...(sales.data ?? []).map((row: any) => row.customer_id), ...(createdCustomers.data ?? []).map((row: any) => row.id)].filter(Boolean))];
    if (!allowedCustomerIds.length) return Response.json({ customers: [], customer: null });
  }
  const phoneQuery = new URL(request.url).searchParams.get("phone");
  if (phoneQuery) {
    const normalized = normalizeEgyptianPhone(phoneQuery);
    if (!normalized) return Response.json({ customer: null });
    let phoneSearch: any = admin.from("customers").select("id,full_name,phone,email,notes").eq("phone", normalized.phone);
    if (allowedCustomerIds) phoneSearch = phoneSearch.in("id", allowedCustomerIds);
    const { data, error } = await phoneSearch.maybeSingle();
    if (error) throw error;
    return Response.json({ customer: data });
  }
  let query = admin.from("customers")
    .select("id,full_name,phone,email,notes,created_at,updated_at")
    .order("created_at", { ascending: false }).limit(100);
  if (allowedCustomerIds) query = query.in("id", allowedCustomerIds);
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
  const operationId = input.operationId ?? crypto.randomUUID();
  const { data: customerData, error } = await admin.rpc("create_customer_idempotent", {
    p_operation_id: operationId, p_actor_id: user!.id!, p_full_name: input.name,
    p_phone: phone ?? null, p_email: input.email || null, p_notes: input.notes || null,
  });
  if (error?.message.includes("customer phone already exists")) return Response.json({ error: "رقم الموبايل مسجل لعميل بالفعل" }, { status: 409 });
  if (error?.message.includes("idempotency key reused")) return Response.json({ error: "معرّف العملية مستخدم لبيانات عميل مختلفة" }, { status: 409 });
  if (error) throw error;
  const data = customerData as unknown as { id: string; full_name: string; phone: string | null; email: string | null; notes: string | null; created_at: string; updated_at: string };
  await audit(user!.id, "customer.create", "customer", data.id, { operationId });
  return Response.json({ customer: data, operationId }, { status: 201 });
}
