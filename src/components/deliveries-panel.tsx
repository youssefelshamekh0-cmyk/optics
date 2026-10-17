"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Branch = { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" };
type Item = { item_name: string; quantity: number; unit_price: number; line_total: number };
type CashAccount = { id: string; branch_id: string; name: string; payment_method: string };
type Sale = {
  id: string; invoice_number: number; branch_id: string; total_amount: number; discount_amount: number; delivery_status: "pending" | "processing" | "ready" | "delivered"; grand_total: number; paid_amount: number; due_amount: number; notes: string | null; created_at: string;
  customers: { full_name: string; phone: string } | null; branches: { name: string } | null; sale_items?: Item[];
};
const STATUSES = ["pending", "processing", "ready", "delivered"] as const;
const statusLabel: Record<string, string> = { pending: "جديد", processing: "قيد التجهيز", ready: "جاهز", delivered: "تم التسليم" };
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("ar-EG");

const PRINT_CSS = `*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#24312e;margin:0 auto;padding:24px;max-width:1100px;font-size:12px;line-height:1.65;background:#fff}h1{font-size:23px;letter-spacing:-.3px;margin:0 0 5px;color:#174f48}h2{font-size:15px;margin:20px 0 8px;color:#174f48;border-bottom:1px solid #dce8e2;padding-bottom:6px}.meta{color:#65746e;font-size:11px;margin-bottom:16px}.print-brand{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 0 18px;margin-bottom:20px;border-bottom:3px solid #27685f}.print-brand img{max-width:170px;max-height:76px;object-fit:contain}.brand-fallback{font-size:18px;font-weight:bold;color:#27685f}.print-brand small{display:block;color:#65746e;font-size:10px;font-weight:normal}
table{width:100%;border-collapse:collapse;margin-top:8px;border:1px solid #dce5e0;border-radius:8px;overflow:hidden}th,td{border-bottom:1px solid #e4ebe7;padding:9px 10px;text-align:right;vertical-align:top}th{background:#edf4f0;color:#245b52;font-size:11px;font-weight:bold}tbody tr:nth-child(even){background:#fafcfb}tbody tr:last-child td{border-bottom:0}small{display:block;color:#697a74;font-size:10px}
.totals{margin-top:16px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.totals div{border:1px solid #dce5e0;border-radius:10px;padding:11px 13px;background:#f8fbf9}.totals b{display:block;font-size:16px;margin-top:3px;color:#174f48}.due b{color:#a34039}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:46px}.sign div{border-top:1px solid #1e292c;padding-top:6px;text-align:center;font-size:12px}.brand{font-size:12px;color:#27685f;font-weight:bold;margin-bottom:10px}
@page{size:A4;margin:12mm}@media print{body{padding:0;max-width:none;font-size:11px}.print-brand{break-inside:avoid}.totals div{break-inside:avoid}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid;break-after:auto}}`;

/** Print an HTML document through a hidden iframe (no pop-up window needed). */
function printHtml(title: string, body: string, logoDataUrl: string | null) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${PRINT_CSS}</style></head><body><header class="print-brand">${logoDataUrl ? `<img src="${esc(logoDataUrl)}" alt="شعار البراند">` : `<div class="brand-fallback">نظرة <small>إدارة الفروع</small></div>`}<div><small>مستند رسمي</small><strong>${esc(title)}</strong></div></header>${body}</body></html>`;
  frame.onload = () => { const w = frame.contentWindow; if (!w) return; w.focus(); w.print(); setTimeout(() => frame.remove(), 60000); };
  document.body.appendChild(frame);
}

function printList(rows: Sale[], branchName: string, filters: string) {
  const total = rows.reduce((s, r) => s + Number(r.grand_total), 0), paid = rows.reduce((s, r) => s + r.paid_amount, 0), due = rows.reduce((s, r) => s + r.due_amount, 0);
  printHtml("قائمة التسليمات", `<h1>قائمة التسليمات</h1><div class="meta">${esc(branchName)} — ${esc(filters)} — طُبعت ${esc(new Date().toLocaleString("ar-EG"))}</div>
  <table><thead><tr><th>#</th><th>الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الهاتف</th><th>الفرع</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>#${r.invoice_number}</td><td>${esc(dateOf(r.created_at))}</td><td>${esc(r.customers?.full_name)}</td><td>${esc(r.customers?.phone)}</td><td>${esc(r.branches?.name)}</td><td>${esc(money(Number(r.grand_total)))}</td><td>${r.due_amount > 0 ? esc(money(r.due_amount)) : "—"}</td><td>${esc(statusLabel[r.delivery_status])}</td></tr>`).join("") || `<tr><td colspan="9">لا توجد فواتير مطابقة</td></tr>`}</tbody></table>
  <div class="totals"><div>عدد الفواتير<b>${rows.length}</b></div><div>الإجمالي<b>${esc(money(total))}</b></div><div class="due">المتبقي<b>${esc(money(due))}</b></div></div><div class="meta" style="margin-top:8px">المدفوع: ${esc(money(paid))}</div>`, brandLogo);
}

function printSlip(s: Sale) {
  const items = s.sale_items ?? [];
  printHtml(`فاتورة ${s.invoice_number}`, `<h1>فاتورة #${s.invoice_number}</h1><div class="meta">${esc(s.branches?.name)} — ${esc(dateOf(s.created_at))} — الحالة: ${esc(statusLabel[s.delivery_status])}</div>
  <h2>العميل</h2><table><tbody><tr><th>الاسم</th><td>${esc(s.customers?.full_name)}</td><th>الهاتف</th><td>${esc(s.customers?.phone)}</td></tr></tbody></table>
  <h2>البنود</h2><table><thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${items.map((i) => `<tr><td>${esc(i.item_name)}</td><td>${esc(i.quantity)}</td><td>${esc(money(Number(i.unit_price)))}</td><td>${esc(money(Number(i.line_total)))}</td></tr>`).join("") || `<tr><td colspan="4">—</td></tr>`}</tbody></table>
  <div class="totals"><div>الإجمالي<b>${esc(money(Number(s.grand_total)))}</b></div><div>المدفوع<b>${esc(money(s.paid_amount))}</b></div><div class="due">المتبقي<b>${esc(money(s.due_amount))}</b></div></div>
  ${s.notes ? `<h2>ملاحظات</h2><p>${esc(s.notes)}</p>` : ""}<div class="sign"><div>توقيع المستلم</div><div>توقيع الموظف</div></div>`, brandLogo);
}

export default function DeliveriesPanel({ branches, branchIds, isOwner }: { branches: Branch[]; branchIds: string[]; isOwner: boolean }) {
  const available = useMemo(() => branches.filter((b) => b.status === "ACTIVE" && (isOwner || branchIds.includes(b.id))), [branches, branchIds, isOwner]);
  const [branchId, setBranchId] = useState("");
  const [sales, setSales] = useState<Sale[]>([]);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const [deliveryDialogSaleId, setDeliveryDialogSaleId] = useState<string | null>(null);
  const [discountDraft, setDiscountDraft] = useState("0");
  const [status, setStatus] = useState<"all" | (typeof STATUSES)[number]>("all");
  const [payment, setPayment] = useState<"all" | "due" | "paid">("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/operations?module=deliveries${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحميل التسليمات");
      setSales(j.sales ?? []); setCashAccounts(j.accounts ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل التسليمات"); }
  }, [branchId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { fetch("/api/brand-settings", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => { if (j?.logoDataUrl) setBrandLogo(j.logoDataUrl); }).catch(() => {}); }, []);

  async function deliverAndCollect(saleId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "deliverAndCollect", saleId, cashAccountId: selectedAccounts[saleId] ?? "", discountAmount: Number(discountDraft || 0) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تسليم الفاتورة وتسجيل المتبقي");
      setSelectedAccounts((current) => { const next = { ...current }; delete next[saleId]; return next; });
      setDeliveryDialogSaleId(null); setDiscountDraft("0");
      setNotice("تم تسليم الفاتورة وتسجيل الخصم والتحصيل في حساب الخزنة المختار"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسليم الفاتورة"); } finally { setBusy(false); }
  }

  async function updateStatus(saleId: string, next: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await fetch("/api/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delivery", saleId, status: next, notes: "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "تعذر تحديث الحالة");
      setNotice("تم تحديث حالة التسليم"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحديث الحالة"); } finally { setBusy(false); }
  }

  const q = search.trim().toLowerCase();
  const bySearchAndPayment = sales.filter((s) => (!q || [s.invoice_number, s.customers?.full_name, s.customers?.phone].some((x) => String(x ?? "").toLowerCase().includes(q))) && (payment === "all" || (payment === "due" ? s.due_amount > 0 : s.due_amount <= 0)));
  const counts = Object.fromEntries(STATUSES.map((k) => [k, bySearchAndPayment.filter((s) => s.delivery_status === k).length])) as Record<string, number>;
  const rows = bySearchAndPayment.filter((s) => status === "all" || s.delivery_status === status);
  const branchName = branchId ? (available.find((b) => b.id === branchId)?.name ?? "") : "كل الفروع";
  const filterText = [status === "all" ? "كل الحالات" : statusLabel[status], payment === "all" ? "" : payment === "due" ? "عليها متبقي" : "مسددة بالكامل", q ? `بحث: ${search.trim()}` : ""].filter(Boolean).join(" · ");

  return (
    <section className="panel operations-panel deliveries-panel">
      <div className="section-heading"><div><p className="eyebrow">دورة الطلب</p><h2>التسليمات</h2></div>
        <button type="button" className="row-action" onClick={() => printList(rows, branchName, filterText)} disabled={!rows.length}>🖨 طباعة القائمة ({rows.length})</button></div>
      {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
      <div className="ops-toolbar">
        <label className="ops-branch">الفرع<select value={branchId} onChange={(e) => setBranchId(e.target.value)}><option value="">كل الفروع</option>{available.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
        <label>بحث برقم الفاتورة أو اسم/رقم العميل<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث دون اختيار مسبق" /></label>
        <label>حالة الدفع<select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)}><option value="all">الكل</option><option value="due">عليها متبقي</option><option value="paid">مسددة بالكامل</option></select></label>
      </div>
      <div className="status-filters" role="group" aria-label="حالة الفاتورة">
        <button type="button" className={`status-chip ${status === "all" ? "on" : ""}`} aria-pressed={status === "all"} onClick={() => setStatus("all")}>الكل <b>{bySearchAndPayment.length}</b></button>
        {STATUSES.map((k) => <button type="button" key={k} className={`status-chip s-${k} ${status === k ? "on" : ""}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{statusLabel[k]} <b>{counts[k]}</b></button>)}
      </div>
      <div className="table-wrap"><table><thead><tr><th>الفاتورة</th><th>العميل</th><th>الفرع</th><th>الإجمالي</th><th>المتبقي</th><th>الحالة</th><th>تحديث التسليم</th><th>تسليم</th><th>طباعة</th></tr></thead><tbody>
        {rows.map((s) => <tr key={s.id}><td>#{s.invoice_number}<small>{dateOf(s.created_at)}</small></td><td>{s.customers?.full_name}<small>{s.customers?.phone}</small></td><td>{s.branches?.name}</td><td>{money(Number(s.grand_total))}</td><td>{s.due_amount > 0 ? <strong className="due">{money(s.due_amount)}</strong> : "—"}</td>
          <td><span className={`status-pill s-${s.delivery_status}`}>{statusLabel[s.delivery_status]}</span></td>
          <td><select className="status-select" aria-label={`حالة الفاتورة ${s.invoice_number}`} value={s.delivery_status} disabled={busy || s.delivery_status === "delivered"} onChange={(e) => void updateStatus(s.id, e.target.value)}>{STATUSES.map((x) => <option value={x} key={x}>{statusLabel[x]}</option>)}</select></td>
          <td><button type="button" className="row-action" disabled={busy || s.delivery_status === "delivered"} onClick={() => { setDeliveryDialogSaleId(s.id); setDiscountDraft("0"); }}>تسليم</button></td><td><button type="button" className="row-action" onClick={() => printSlip(s)} aria-label={`طباعة الفاتورة ${s.invoice_number}`}>🖨</button></td></tr>)}
        {rows.length === 0 && <tr><td colSpan={9} className="table-empty">لا توجد طلبات مطابقة.</td></tr>}
      </tbody></table></div>
      <p className="footnote">كل تغيير حالة يُحفظ في سجل تسليم الفاتورة. القائمة تعرض آخر 200 فاتورة غير ملغاة.</p>
      {deliveryDialogSaleId && (() => {
        const sale = sales.find((row) => row.id === deliveryDialogSaleId);
        if (!sale) return null;
        const discount = Number(discountDraft || 0);
        const newTotal = Number(sale.total_amount) - discount;
        const newDue = newTotal - Number(sale.paid_amount);
        const accountsForSale = cashAccounts.filter((account) => account.branch_id === sale.branch_id);
        return <div className="modal-backdrop" role="presentation" style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 12px", overflowY: "auto", background: "rgba(12, 28, 25, 0.58)", backdropFilter: "blur(3px)" }} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeliveryDialogSaleId(null); }}>
          <section className="panel" role="dialog" aria-modal="true" aria-labelledby="delivery-confirm-title" style={{ width: "min(900px, 96vw)", maxHeight: "calc(100dvh - 48px)", overflowY: "auto", margin: "auto", padding: "clamp(18px, 3vw, 30px)", boxShadow: "0 24px 80px rgba(0,0,0,.28)", border: "1px solid var(--line, #dce6e1)" }}>
            <div className="section-heading"><div><p className="eyebrow">مراجعة قبل التسليم</p><h2 id="delivery-confirm-title">تسليم الفاتورة #{sale.invoice_number}</h2></div><button type="button" className="row-action" disabled={busy} onClick={() => setDeliveryDialogSaleId(null)}>إغلاق</button></div>
            <div className="ops-toolbar">
              <div><small>العميل</small><strong>{sale.customers?.full_name ?? "—"}</strong></div>
              <div><small>الفرع</small><strong>{sale.branches?.name ?? "—"}</strong></div>
              <div><small>رقم الهاتف</small><strong>{sale.customers?.phone ?? "—"}</strong></div>
            </div>
            <div className="table-wrap"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
              {(sale.sale_items ?? []).map((item, index) => <tr key={`${item.item_name}-${index}`}><td>{item.item_name}</td><td>{item.quantity}</td><td>{money(Number(item.unit_price))}</td><td>{money(Number(item.line_total))}</td></tr>)}
              {!(sale.sale_items ?? []).length && <tr><td colSpan={4}>لا توجد تفاصيل أصناف متاحة.</td></tr>}
            </tbody></table></div>
            <div className="ops-toolbar">
              <div><small>إجمالي الأصناف قبل الخصم</small><strong>{money(Number(sale.total_amount))}</strong></div>
              <label>الخصم على الفاتورة<input type="number" min="0" max={Math.max(0, Number(sale.total_amount) - Number(sale.paid_amount))} step="0.01" value={discountDraft} onChange={(event) => setDiscountDraft(event.target.value)} /></label>
              <div><small>الإجمالي بعد الخصم</small><strong>{money(newTotal)}</strong></div>
              <div><small>المدفوع سابقًا</small><strong>{money(Number(sale.paid_amount))}</strong></div>
              <div><small>المتبقي المطلوب تحصيله</small><strong>{money(newDue)}</strong></div>
            </div>
            {newDue > 0.009 ? <label>حساب الخزنة / وسيلة الدفع
              <select value={selectedAccounts[sale.id] ?? ""} onChange={(event) => setSelectedAccounts((current) => ({ ...current, [sale.id]: event.target.value }))}>
                <option value="">اختر حساب الخزنة</option>
                {accountsForSale.map((account) => <option key={account.id} value={account.id}>{account.name} — {({cash:"نقدي",card:"بطاقة",instapay:"إنستاباي",other:"أخرى"} as Record<string,string>)[account.payment_method] ?? account.payment_method}</option>)}
              </select>
            </label> : <p>لا يوجد مبلغ متبقٍ للتحصيل بعد الخصم.</p>}
            {discount < 0 || !Number.isFinite(discount) || discount > Number(sale.total_amount) - Number(sale.paid_amount) ? <div className="notice error">قيمة الخصم غير صحيحة.</div> : null}
            <div className="section-heading"><span>سيتم تسجيل الخصم والتحصيل وتحديث حالة الفاتورة معًا.</span><button type="button" className="primary-button" disabled={busy || discount < 0 || !Number.isFinite(discount) || discount > Number(sale.total_amount) || (newDue > 0.009 && !selectedAccounts[sale.id])} onClick={() => void deliverAndCollect(sale.id)}>{busy ? "جارٍ الحفظ…" : "تأكيد التسليم"}</button></div>
          </section>
        </div>;
      })()}
    </section>
  );
}
