import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth";
import { normalizeEgyptianPhone } from "@/lib/phone";

export async function GET(request: Request) {
  const { user, response } = await requirePermission("customers.read");
  if (response) return response;
  const search = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (search.length < 2) return Response.json({ customers: [] });
  const admin = getSupabaseAdmin();
  let allowedCustomerIds: string[] | null = null;
  if (!user!.roles.includes("super_admin")) {
    const [sales, createdCustomers] = await Promise.all([
      user!.branchIds.length ? admin.from("sales").select("customer_id").in("branch_id", user!.branchIds).limit(10000) : Promise.resolve({ data: [], error: null }),
      admin.from("customers").select("id").eq("created_by", user!.id).limit(10000),
    ]);
    if (sales.error || createdCustomers.error) throw sales.error ?? createdCustomers.error;
    allowedCustomerIds = [...new Set([...(sales.data ?? []).map((row: any) => row.customer_id), ...(createdCustomers.data ?? []).map((row: any) => row.id)].filter(Boolean))];
    if (!allowedCustomerIds.length) return Response.json({ customers: [] });
  }
  const safeName = search.replace(/[%,()]/g, " ").trim().slice(0, 80);
  let nameQuery: any = admin.from("customers").select("id,full_name,phone,email");
  let phoneExactQuery: any = admin.from("customers").select("id,full_name,phone,email");
  let phoneLikeQuery: any = admin.from("customers").select("id,full_name,phone,email");
  if (allowedCustomerIds) {
    nameQuery = nameQuery.in("id", allowedCustomerIds);
    phoneExactQuery = phoneExactQuery.in("id", allowedCustomerIds);
    phoneLikeQuery = phoneLikeQuery.in("id", allowedCustomerIds);
  }
  const nameResult = safeName ? await nameQuery.ilike("full_name", `%${safeName}%`).order("full_name").limit(20) : { data: [], error: null };
  const normalizedPhone = normalizeEgyptianPhone(search);
  const digits = search.replace(/\D/g, "");
  const phoneResult = normalizedPhone
    ? await phoneExactQuery.eq("phone", normalizedPhone.phone).limit(20)
    : digits.length >= 4 ? await phoneLikeQuery.ilike("phone", `%${digits}%`).limit(20) : { data: [], error: null };
  if (nameResult.error || phoneResult.error) throw nameResult.error ?? phoneResult.error;
  const unique = new Map([...(nameResult.data ?? []), ...(phoneResult.data ?? [])].map((row) => [row.id, row]));
  return Response.json({ customers: [...unique.values()].slice(0, 20) });
}
