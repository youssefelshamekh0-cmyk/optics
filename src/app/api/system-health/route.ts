import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Check = { key: string; label: string; status: "ok" | "warning" | "error"; detail: string; count?: number };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "مركز صحة النظام متاح لمالك البراند فقط" }, { status: 403 });

  const admin = getSupabaseAdmin() as any;
  const checks: Check[] = [];
  const tableChecks = [
    ["sales", "الفواتير"], ["sale_items", "بنود الفواتير"],
    ["sale_payments", "دفعات العملاء"], ["sale_returns", "المرتجعات"],
    ["cash_transactions", "حركة الخزائن"], ["audit_logs", "سجل التدقيق"],
    ["customers", "العملاء"], ["brand_settings", "إعدادات البراند"],
  ] as const;

  try {
    const tableResults = await Promise.all(tableChecks.map(async ([table, label]) => {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
      return { table, label, count: count ?? 0, error };
    }));
    for (const result of tableResults) checks.push({
      key: result.table, label: result.label, status: result.error ? "error" : "ok",
      detail: result.error ? "تعذر الوصول إلى الجدول؛ راجع مخطط قاعدة البيانات والصلاحيات." : "الجدول متاح",
      count: result.error ? undefined : result.count,
    });

    const olderThanThreeDays = new Date(Date.now() - 3 * 86400000).toISOString();
    const [pendingSales, pendingLenses, recentSales] = await Promise.all([
      admin.from("sales").select("id,invoice_number,created_at,delivery_status").in("delivery_status", ["pending", "processing", "ready"]).lt("created_at", olderThanThreeDays).order("created_at", { ascending: true }).limit(1000),
      admin.from("sale_items").select("id,sale_id,created_at").eq("item_kind", "prescription_lens").eq("supply_status", "pending").lt("created_at", olderThanThreeDays).limit(1000),
      admin.from("sales").select("id").order("created_at", { ascending: false }).limit(1000),
    ]);
    if (pendingSales.error) throw pendingSales.error;
    if (pendingLenses.error && !/created_at/i.test(pendingLenses.error.message ?? "")) throw pendingLenses.error;
    if (recentSales.error) throw recentSales.error;
    const recentSaleIds = [...new Set((recentSales.data ?? []).map((row: any) => row.id).filter(Boolean))];
    const [recentPayments, recentLedger] = recentSaleIds.length ? await Promise.all([
      admin.from("sale_payments").select("sale_id,amount,created_at").in("sale_id", recentSaleIds).limit(20000),
      admin.from("cash_transactions").select("reference_id,amount,created_at").eq("direction", "in").eq("transaction_type", "sale_payment").in("reference_id", recentSaleIds).limit(20000),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (recentPayments.error) throw recentPayments.error;
    if (recentLedger.error) throw recentLedger.error;

    checks.push({
      key: "stale-deliveries", label: "طلبات لم تُسلّم منذ أكثر من 3 أيام",
      status: (pendingSales.data ?? []).length ? "warning" : "ok", count: (pendingSales.data ?? []).length,
      detail: (pendingSales.data ?? []).length ? "راجع حالة التجهيز وتواصل مع العملاء؛ قد تكون هناك طلبات متأخرة." : "لا توجد طلبات قديمة ضمن الفحص.",
    });
    const pendingLensCount = pendingLenses.error ? null : (pendingLenses.data ?? []).length;
    checks.push({
      key: "stale-lenses", label: "طلبات عدسات متأخرة",
      status: pendingLenses.error ? "warning" : pendingLensCount ? "warning" : "ok",
      count: pendingLensCount ?? undefined,
      detail: pendingLenses.error ? "تعذر فحص عمر طلبات العدسات؛ تحقق من بنية الجدول." : pendingLensCount ? "توجد طلبات عدسات معلّقة أقدم من 3 أيام." : "لا توجد طلبات عدسات متأخرة ضمن الفحص.",
    });

    const paymentTotals = new Map<string, number>();
    const ledgerTotals = new Map<string, number>();
    for (const row of recentPayments.data ?? []) paymentTotals.set(row.sale_id, (paymentTotals.get(row.sale_id) ?? 0) + Number(row.amount));
    for (const row of recentLedger.data ?? []) if (row.reference_id) ledgerTotals.set(row.reference_id, (ledgerTotals.get(row.reference_id) ?? 0) + Number(row.amount));
    const ids = new Set([...paymentTotals.keys(), ...ledgerTotals.keys()]);
    let mismatchCount = 0;
    for (const id of ids) if (Math.abs((paymentTotals.get(id) ?? 0) - (ledgerTotals.get(id) ?? 0)) > 0.009) mismatchCount += 1;
    checks.push({
      key: "payment-ledger", label: "تطابق دفعات العملاء مع حركة الخزائن",
      status: mismatchCount ? "warning" : "ok", count: mismatchCount,
      detail: mismatchCount ? "ظهرت فروق في أحدث 5,000 سجل من كل مصدر؛ يلزم فحص المطابقة قبل أي تسوية." : "لا توجد فروق في العينة الأخيرة. هذا فحص أولي وليس تدقيقًا محاسبيًا كاملًا.",
    });
    checks.push({
      key: "backups", label: "النسخ الاحتياطي والاستعادة", status: "warning",
      detail: "لا يمكن تأكيد وجود نسخة قابلة للاستعادة من داخل التطبيق. راجع النسخ الاحتياطي في لوحة Supabase ونفّذ اختبار استعادة دوريًا.",
    });

    const status = checks.some((item) => item.status === "error") ? "error" : checks.some((item) => item.status === "warning") ? "warning" : "ok";
    return Response.json({
      checkedAt: new Date().toISOString(), status, checks,
      scopeNote: "الفحوصات محدودة بآخر 5,000 دفعة وحركة خزينة وبالطلبات القديمة الظاهرة في الاستعلام. لا تُعد بديلًا عن مراجعة محاسبية أو اختبار استعادة.",
    });
  } catch {
    return Response.json({ error: "تعذر إكمال فحوصات صحة النظام؛ راجع سجل الأخطاء والصلاحيات." }, { status: 500 });
  }
}
