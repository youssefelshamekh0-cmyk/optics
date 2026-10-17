"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Deposit = { id: string; amount: number; description: string | null; created_at: string; seller: string };
type NonCashAccount = { id: string; branch_id: string; name: string; payment_method: string; balance: number; branches?: { name: string } | null };
type Central = { id: string; name: string; balance: number; deposits: Deposit[]; nonCashAccounts: NonCashAccount[] } | null;
type TransferResult = { accountId: string; accountName: string; amount: number; referenceId: string | null; status: "transferred" | "no_positive_balance" };
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const when = (iso: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/** Owner-only central treasury and manually confirmed transfers from non-cash branch accounts. */
export default function CentralCash() {
  const [central, setCentral] = useState<Central>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [depositNotice, setDepositNotice] = useState("");
  const [depositError, setDepositError] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [lastTransfers, setLastTransfers] = useState<TransferResult[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/operations?module=central", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل الخزنة المركزية");
      setCentral(j.central ?? null); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل الخزنة المركزية"); } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { window.addEventListener("shift-changed", load); return () => window.removeEventListener("shift-changed", load); }, [load]);

  const accounts = central?.nonCashAccounts ?? [];
  const selectedAccounts = useMemo(
    () => selectedAccountId ? accounts.filter(a => a.id === selectedAccountId) : accounts,
    [accounts, selectedAccountId]
  );
  const previewTotal = selectedAccounts.reduce((sum, account) => sum + Math.max(0, Number(account.balance) || 0), 0);
  const previewLines = selectedAccounts.map(a => `• ${a.name} — الرصيد: ${money(Number(a.balance) || 0)}`).join("\n");

  async function deposit() {
    if (!central || depositBusy) return;
    const positive = selectedAccounts.filter(a => Number(a.balance) > 0);
    if (!positive.length) {
      setDepositError("لا توجد أرصدة موجبة متاحة للتوريد في الاختيار الحالي.");
      setDepositNotice("");
      return;
    }
    const scope = selectedAccountId ? "الحساب المحدد" : "كل الحسابات غير النقدية النشطة";
    const confirmed = window.confirm(
      `تأكيد التوريد اليدوي إلى الخزنة المركزية\n\nالنطاق: ${scope}\n${previewLines}\n\nالإجمالي المتوقع: ${money(previewTotal)}\n\nسيُعاد احتساب الأرصدة وقت التنفيذ. هل تريد المتابعة؟`
    );
    if (!confirmed) return;
    setDepositBusy(true); setDepositError(""); setDepositNotice(""); setLastTransfers([]);
    try {
      const r = await fetch("/api/operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "centralDeposit", cashAccountId: selectedAccountId || null })
      });
      const result = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(result.error ?? "تعذر تنفيذ التوريد");
      const transfers: TransferResult[] = result.depositResult?.transfers ?? [];
      setLastTransfers(transfers);
      const actualTotal = Number(result.depositResult?.totalAmount ?? 0);
      const count = Number(result.depositResult?.accountsTransferred ?? 0);
      setDepositNotice(count
        ? `تم التوريد بنجاح من ${count} حساب/حسابات بإجمالي ${money(actualTotal)}. تم تسجيل حركة مستقلة لكل حساب.`
        : "لم يتم نقل أي مبالغ؛ لا توجد أرصدة موجبة وقت التنفيذ.");
      await load();
    } catch (e) {
      setDepositError(e instanceof Error ? e.message : "تعذر تنفيذ التوريد");
    } finally {
      setDepositBusy(false);
    }
  }

  if (!loaded) return null;
  return <section className="panel operations-panel">
    <div className="section-heading"><div><p className="eyebrow">رصيد البراند النقدي</p><h2>الخزنة المركزية</h2></div>{central && <button type="button" className="row-action" onClick={() => void load()}>تحديث</button>}</div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!error && !central && <div className="notice error">لم يتم إنشاء الخزنة المركزية؛ طبّق migration الخزنة المركزية على قاعدة البيانات.</div>}
    {central && <>
      <div className="ops-account-grid"><article className="ops-account"><small>{central.name}</small><strong>الرصيد الحالي</strong><b>{money(central.balance)}</b></article></div>

      <div className="ops-form" style={{ marginTop: 18 }}>
        <h3>توريد يدوي من الحسابات غير النقدية</h3>
        <p className="footnote">اختر حسابًا بعينه أو كل الحسابات غير النقدية النشطة. الأرصدة المعروضة تشمل الرصيد المرحّل من الأيام السابقة، وسيُعاد حسابها عند التأكيد.</p>
        <label>نطاق التوريد
          <select value={selectedAccountId} onChange={e => { setSelectedAccountId(e.target.value); setDepositError(""); setDepositNotice(""); setLastTransfers([]); }}>
            <option value="">كل الحسابات غير النقدية النشطة</option>
            {accounts.map(a => <option value={a.id} key={a.id}>{a.name} — {a.branches?.name ?? "الفرع"} ({a.payment_method})</option>)}
          </select>
        </label>
        <div className="table-wrap"><table><thead><tr><th>الحساب</th><th>الفرع</th><th>طريقة الدفع</th><th>الرصيد المتاح</th></tr></thead><tbody>
          {selectedAccounts.map(a => <tr key={a.id}><td>{a.name}</td><td>{a.branches?.name ?? "—"}</td><td>{a.payment_method}</td><td><strong>{money(Number(a.balance) || 0)}</strong></td></tr>)}
          {!selectedAccounts.length && <tr><td colSpan={4} className="table-empty">لا توجد حسابات غير نقدية نشطة.</td></tr>}
          <tr><th colSpan={3}>إجمالي الرصيد الموجب المتوقع للتوريد</th><th>{money(previewTotal)}</th></tr>
        </tbody></table></div>
        {depositError && <div className="notice error" role="alert">{depositError}</div>}
        {depositNotice && <div className="notice success" role="status">{depositNotice}</div>}
        <button type="button" className="primary" disabled={depositBusy || previewTotal <= 0 || accounts.length === 0} onClick={() => void deposit()}>
          {depositBusy ? "جارٍ تسجيل التوريد..." : selectedAccountId ? "توريد الحساب المحدد" : "توريد كل الحسابات غير النقدية"}
        </button>
        {lastTransfers.length > 0 && <div className="table-wrap" style={{ marginTop: 12 }}><table><thead><tr><th>الحساب</th><th>النتيجة</th><th>المبلغ الفعلي</th></tr></thead><tbody>
          {lastTransfers.map(t => <tr key={t.accountId}><td>{t.accountName}</td><td>{t.status === "transferred" ? "تم التوريد" : "لا يوجد رصيد موجب"}</td><td>{money(t.amount)}</td></tr>)}
        </tbody></table></div>}
      </div>

      <h3 className="ops-subtitle">آخر حركات الخزنة المركزية</h3>
      <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المستخدم</th><th>المبلغ</th><th>البيان</th></tr></thead><tbody>
        {central.deposits.map((d) => <tr key={d.id}><td>{when(d.created_at)}</td><td>{d.seller}</td><td><strong>{money(d.amount)}</strong></td><td>{d.description ?? "—"}</td></tr>)}
        {central.deposits.length === 0 && <tr><td colSpan={4} className="table-empty">لا توجد حركات توريد بعد.</td></tr>}
      </tbody></table></div>
      <p className="footnote">كل توريد ينشئ حركة خصم من الحساب المصدر وحركة إضافة مقابلة للخزنة المركزية بنفس المرجع، مع تسجيل المستخدم والتوقيت. لا يوجد توريد مجدول تلقائيًا.</p>
    </>}
  </section>;
}
