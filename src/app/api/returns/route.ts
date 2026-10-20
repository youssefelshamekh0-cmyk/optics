import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth";

export async function GET(request: Request) {
  const { user, response } = await requirePermission("returns.manage");
  if (response) return response;
  const params = new URL(request.url).searchParams;
  const requestedBranchId = params.get("branchId");
  if (requestedBranchId && !user!.roles.includes("super_admin") && !user!.branchIds.includes(requestedBranchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  if (!user!.roles.includes("super_admin") && !user!.branchIds.length) return Response.json({ returns: [] });
  const admin = getSupabaseAdmin() as any;
  let query = admin.from("sale_returns").select("id,sale_id,branch_id,refund_amount,reason,created_at,sale:sales(invoice_number,customer:customers(full_name)),branch:branches(name)").order("created_at", { ascending: false }).limit(200);
  if (requestedBranchId) query = query.eq("branch_id", requestedBranchId);
  else if (!user!.roles.includes("super_admin")) query = query.in("branch_id", user!.branchIds);
  const { data, error } = await query;
  if (error) return Response.json({ error: "تعذر تحميل سجل المرتجعات" }, { status: 500 });
  return Response.json({ returns: (data ?? []).map((item: any) => ({ id: item.id, invoiceNumber: item.sale?.invoice_number ?? null, customerName: item.sale?.customer?.full_name ?? null, branchName: item.branch?.name ?? null, refundAmount: Number(item.refund_amount), reason: item.reason, createdAt: item.created_at })) });
}
