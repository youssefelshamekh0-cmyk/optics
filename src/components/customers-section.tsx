"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { normalizeEgyptianPhone } from "@/lib/phone";
import { cachedRequestJson } from "@/lib/offline-sync";
import CustomerCarePanel from "@/components/customer-care-panel";
import CustomerCsvTools from "@/components/customer-csv-tools";

type Customer = {
  id: string; full_name: string; phone: string | null; email: string | null;
  notes: string | null; created_at: string;
};
type Draft = { name: string; phone: string; email: string; notes: string };
const emptyDraft: Draft = { name: "", phone: "", email: "", notes: "" };

async function requestJson(url: string, init?: RequestInit) {
  return cachedRequestJson<any>(url, init);
}

export default function CustomersSection({ canManage, branches, branchIds, isOwner }: { canManage: boolean; branches: { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" }[]; branchIds: string[]; isOwner: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phoneLookup, setPhoneLookup] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const result = await requestJson("/api/customers");
      setCustomers(result.customers);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل العملاء"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (editingId || !draft.phone || !normalizeEgyptianPhone(draft.phone)) { setPhoneLookup(""); return; }
    const timer = window.setTimeout(async () => {
      try {
        const result = await requestJson(`/api/customers?phone=${encodeURIComponent(draft.phone)}`);
        if (!result.customer) { setPhoneLookup(""); return; }
        const match = result.customer as Customer;
        setDraft({ name: match.full_name, phone: match.phone ?? "", email: match.email ?? "", notes: match.notes ?? "" });
        setEditingId(match.id);
        setPhoneLookup("الرقم مسجل بالفعل؛ ظهرت بيانات العميل لتحديثها بدل إنشاء سجل مكرر.");
      } catch { setPhoneLookup(""); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft.phone, editingId]);

  const visibleCustomers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("ar-EG");
    if (!term) return customers;
    return customers.filter((customer) => [customer.full_name, customer.phone ?? "", customer.email ?? "", customer.notes ?? ""].some((value) => value.toLocaleLowerCase("ar-EG").includes(term)));
  }, [customers, search]);

  function beginEdit(customer: Customer) {
    setEditingId(customer.id);
    setDraft({ name: customer.full_name, phone: customer.phone ?? "", email: customer.email ?? "", notes: customer.notes ?? "" });
    setNotice(""); setError(""); setPhoneLookup("");
    document.getElementById("customer-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (editingId) await requestJson(`/api/customers/${editingId}`, { method: "PATCH", body: JSON.stringify(draft) });
      else {
        const result = await requestJson("/api/customers", { method: "POST", body: JSON.stringify(draft) });
        setNotice(result.queued ? "تم حفظ العميل محليًا؛ سيُرسل للخادم عند عودة الإنترنت." : "تمت إضافة العميل");
      }
      setDraft(emptyDraft); setEditingId(null); setPhoneLookup("");
      if (editingId) setNotice("تم تحديث بيانات العميل");
      window.dispatchEvent(new Event("customers:changed"));
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ العميل"); }
    finally { setBusy(false); }
  }

  return <section className="panel customers-panel">
    <div className="section-heading"><div><p className="eyebrow">سجل مشترك بين الفروع</p><h2>العملاء</h2></div><span className="count-badge">{customers.length}{customers.length === 100 ? "+" : ""} عميل</span></div>
    <div className="customer-toolbar">
      <label className="customer-search">بحث<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم العميل أو رقم الموبايل" /></label>
    </div>
    <CustomerCsvTools customers={customers} canManage={canManage} onImported={refresh} />
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    <>
      <div className="table-wrap"><table className="customers-table"><thead><tr><th>العميل</th><th>رقم الموبايل</th><th>البريد</th><th>ملاحظات</th>{canManage && <th>إجراء</th>}</tr></thead><tbody>
        {visibleCustomers.map((customer) => <tr key={customer.id}><td><strong>{customer.full_name}</strong><small>{new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(customer.created_at))}</small></td><td>{customer.phone || "—"}</td><td>{customer.email || "—"}</td><td className="customer-notes">{customer.notes || "—"}</td>{canManage && <td><button className="row-action" disabled={busy} onClick={() => beginEdit(customer)}>تعديل</button></td>}</tr>)}
        {visibleCustomers.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="table-empty">{search ? "لا توجد نتائج مطابقة للبحث." : "لا يوجد عملاء في هذا الفرع بعد."}</td></tr>}
      </tbody></table></div>
      {canManage && <form id="customer-form" className="customer-form" onSubmit={saveCustomer}>
        <div className="section-heading"><div><p className="eyebrow">{editingId ? "تعديل السجل" : "تسجيل جديد"}</p><h3>{editingId ? "تعديل بيانات العميل" : "إضافة عميل"}</h3></div>{editingId && <button type="button" className="quiet" onClick={() => { setEditingId(null); setDraft(emptyDraft); setPhoneLookup(""); }}>إلغاء التعديل</button>}</div>
        <div className="customer-fields">
          <label>اسم العميل<input required minLength={2} maxLength={160} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>رقم الموبايل<input type="tel" inputMode="tel" maxLength={40} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />{phoneLookup && <small className="field-hint">{phoneLookup}</small>}</label>
          <label>البريد الإلكتروني<input type="email" maxLength={254} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
          <label className="customer-notes-input">ملاحظات<textarea maxLength={1000} rows={2} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
          <button className="primary" disabled={busy}>{busy ? "جارٍ الحفظ…" : editingId ? "حفظ التعديلات" : "إضافة العميل"}</button>
        </div>
      </form>}
      <p className="footnote">سجل العملاء مشترك بين جميع الفروع، ويظهر أول 100 سجل. تُتاح البيانات لمن لديه صلاحية عرض العملاء.</p>
      {canManage && <CustomerCarePanel customers={customers} branches={branches} branchIds={branchIds} isOwner={isOwner} canManage={canManage} />}
    </>
  </section>;
}
