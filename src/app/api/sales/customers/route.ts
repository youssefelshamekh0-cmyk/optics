import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth";
import { normalizeEgyptianPhone } from "@/lib/phone";

export async function GET(request: Request) {
  const { response } = await requirePermission("sales.create");
  if (response) return response;
  const search = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (search.length < 2) return Response.json({ customers: [] });
  const admin = getSupabaseAdmin();
  const safeName = search.replace(/[%,()]/g, " ").trim().slice(0, 80);
  const nameResult = safeName ? await admin.from("customers").select("id,full_name,phone,email").ilike("full_name", `%${safeName}%`).order("full_name").limit(20) : { data: [], error: null };
  const normalizedPhone = normalizeEgyptianPhone(search);
  const digits = search.replace(/\D/g, "");
  const phoneResult = normalizedPhone
    ? await admin.from("customers").select("id,full_name,phone,email").eq("phone", normalizedPhone.phone).limit(20)
    : digits.length >= 4 ? await admin.from("customers").select("id,full_name,phone,email").ilike("phone", `%${digits}%`).limit(20) : { data: [], error: null };
  if (nameResult.error || phoneResult.error) throw nameResult.error ?? phoneResult.error;
  const unique = new Map([...(nameResult.data ?? []), ...(phoneResult.data ?? [])].map((row) => [row.id, row]));
  return Response.json({ customers: [...unique.values()].slice(0, 20) });
}
