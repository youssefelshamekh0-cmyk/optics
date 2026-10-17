import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const openSchema = z.object({ action: z.literal("open"), branchId: z.string().uuid(), cashAccountId: z.string().uuid(), openingCash: z.number().min(0).max(10000000) });
const closeSchema = z.object({ action: z.literal("close"), shiftId: z.string().uuid(), closingCash: z.number().min(0).max(10000000), notes: z.string().max(500).default("") });
const depositSchema = z.object({ action: z.literal("deposit"), shiftId: z.string().uuid(), amount: z.number().positive().max(10000000), notes: z.string().trim().max(200).default("") });
// Range bounds are ISO instants built by the browser from the owner's local dates (Egypt DST safe).
const isoInstant = z.string().datetime({ offset: true });

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;

  if (user.roles.includes("super_admin")) {
    // Owner view: every seller's shifts, optionally narrowed by date range and branch, for the working-hours report.
    const params = new URL(request.url).searchParams;
    const from = isoInstant.safeParse(params.get("from") ?? "");
    const to = isoInstant.safeParse(params.get("to") ?? "");
    const branchId = z.string().uuid().safeParse(params.get("branchId") ?? "");
    let query = admin.from("seller_shifts")
      .select("id,user_id,branch_id,cash_account_id,opening_cash,closing_cash,expected_cash,variance,status,opened_at,closed_at,closing_notes,user_profiles(full_name,phone),branches(name,code),cash_accounts(name)")
      .order("opened_at", { ascending: false }).limit(2000);
    if (from.success) query = query.gte("opened_at", from.data);
    if (to.success) query = query.lte("opened_at", to.data);
    if (branchId.success) query = query.eq("branch_id", branchId.data);
    const { data, error } = await query;
    if (error) throw error;
    return Response.json({ owner: true, shifts: data ?? [] });
  }

  const { data: shift, error } = await admin.from("seller_shifts")
    .select("id,branch_id,cash_account_id,opening_cash,closing_cash,status,opened_at,closed_at,branches(name,code),cash_accounts(name)")
    .eq("user_id", user.id).order("opened_at", { ascending: false }).limit(20);
  if (error) throw error;
  const { data: accounts, error: accountError } = await admin.from("cash_accounts")
    .select("id,branch_id,name,payment_method").in("branch_id", user.branchIds).eq("payment_method", "cash").eq("active", true);
  if (accountError) throw accountError;
  // The seller's own central-box deposits (drawer side of the ledger).
  const { data: deposits, error: depositError } = await admin.from("cash_transactions")
    .select("id,amount,description,created_at")
    .eq("created_by", user.id).eq("transaction_type", "central_deposit").eq("direction", "out")
    .order("created_at", { ascending: false }).limit(20);
  if (depositError) throw depositError;
  return Response.json({ owner: false, shifts: shift ?? [], accounts: accounts ?? [], deposits: deposits ?? [] });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  if (user.roles.includes("super_admin")) return Response.json({ error: "الوردية مطلوبة لحسابات البائعين فقط" }, { status: 400 });
  const parsed = z.discriminatedUnion("action", [openSchema, closeSchema, depositSchema]).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الوردية" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;

  if (parsed.data.action === "open") {
    const { data, error } = await admin.rpc("open_seller_shift", { p_user: user.id, p_branch: parsed.data.branchId, p_cash_account: parsed.data.cashAccountId, p_opening_cash: parsed.data.openingCash });
    if (error) return Response.json({ error: error.message.includes("duplicate") ? "لديك وردية مفتوحة بالفعل" : "تعذر فتح الوردية؛ تأكد من الفرع والخزنة" }, { status: 400 });
    await audit(user.id, "shift.open", "seller_shift", data, { branchId: parsed.data.branchId });
    return Response.json({ success: true, shiftId: data });
  }

  if (parsed.data.action === "deposit") {
    const amount = Math.round(parsed.data.amount * 100) / 100;
    const { data, error } = await admin.rpc("deposit_to_central", { p_shift: parsed.data.shiftId, p_user: user.id, p_amount: amount, p_notes: parsed.data.notes });
    // Deliberately generic: do not reveal the drawer's expected balance to the seller.
    if (error) return Response.json({ error: "تعذر تسجيل التوريد؛ راجع المبلغ وتأكد أن الوردية مفتوحة" }, { status: 400 });
    await audit(user.id, "shift.central_deposit", "cash_deposit", data, { shiftId: parsed.data.shiftId, amount });
    return Response.json({ success: true, message: "تم تسجيل التوريد للخزنة المركزية" });
  }

  const { data, error } = await admin.rpc("close_seller_shift", { p_shift: parsed.data.shiftId, p_user: user.id, p_count: parsed.data.closingCash, p_notes: parsed.data.notes });
  if (error) return Response.json({ error: "تعذر إغلاق الوردية؛ تحقق من أنها مفتوحة" }, { status: 400 });
  void data;
  await audit(user.id, "shift.close", "seller_shift", parsed.data.shiftId, {});
  // Deliberately discard expected cash and variance: those are owner-only reconciliation data.
  return Response.json({ success: true, message: "تم إغلاق الوردية وتسجيل العد" });
}
