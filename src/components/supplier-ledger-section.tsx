"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Supplier = { id: string; name: string; phone: string | null; balance: number };
type Branch = { id: string; name: string; code: string };
type Account = { id: string; name: string; branch_id: string | null; is_central: boolean; branches?: { name: string } | null };
type Entry = { id: string; supplier_id: string; branch_id: string | null; entry_type: string; source_type?: string; amount: number; direction: string; entry_date: string; description: string | null; suppliers?: { name: string }; branches?: { name: string } | null; cash_accounts?: { name: string } | null };
const money = (n: number) => new Intl.NumberFormat("ar-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 2 }).format(n);
const labels: Record<string,string> = { opening_debt: "رصيد افتتاحي", purchase: "مشتريات آجلة", lens_purchase: "مشتريات عدسات", payment: "سداد", adjustment: "تسوية" };
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "تعذر تنفيذ الطلب");
  return d;
}
export default function SupplierLedgerSection({ isOwner }: { isOwner: boolean }) {
  const [suppliers,setSuppliers] = useState<Supplier[]>([]);
  const [branches,setBranches] = useState<Branch[]>([]);
  const [accounts,setAccounts] = useState<Account[]>([]);
  const [entries,setEntries] = useState<Entry[]>([]);
  const [supplierId,setSupplierId] = useState("");
  const [branchId,setBranchId] = useState("");
  const [type,setType] = useState<"opening_debt"|"payment"|"adjustment">("opening_debt");
  const [amount,setAmount] = useState("");
  const [cashAccountId,setCashAccountId] = useState("");
  const [date,setDate] = useState(()=>new Date().toISOString().slice(0,10));
  const [description,setDescription] = useState("");
  const [search,setSearch] = useState("");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const load = useCallback(async()=> {
    try { const d = await api("/api/supplier-ledger"); setSuppliers(d.suppliers??[]); setBranches(d.branches??[]); setAccounts(d.accounts??[]); setEntries(d.entries??[]); }
    catch(e) { setError(e instanceof Error?e.message:"تعذر تحميل المديونيات"); }
  },[]);
  useEffect(()=>{void load()},[load]);
  const filtered = suppliers.filter(s=>!search||s.name.toLowerCase().includes(search.toLowerCase())||(s.phone??"").includes(search));
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api("/api/supplier-ledger",{method:"POST",body:JSON.stringify({supplierId,branchId:branchId||null,type,amount:Number(amount),cashAccountId:type==="payment"?cashAccountId||null:null,date,description})});
      setAmount(""); setDescription(""); setCashAccountId(""); setNotice(type==="payment"?"تم تسجيل السداد وحركة الخزنة":"تم تسجيل المديونية"); await load();
    } catch(e) { setError(e instanceof Error?e.message:"تعذر حفظ الحركة"); }
    finally { setBusy(false); }
  }
  const totalDue = suppliers.reduce((sum,s)=>sum+Math.max(0,Number(s.balance)),0);
  const totalCredit = suppliers.reduce((sum,s)=>sum+Math.max(0,-Number(s.balance)),0);
  return <section className="panel operations-panel">
    <div className="section-heading"><div><p className="eyebrow">حسابات الموردين</p><h2>المديونيات والمشتريات الآجلة</h2></div></div>
    {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
    <div className="account-kpis" style={{marginBottom:16}}><article><span>إجمالي المستحق للموردين</span><strong>{money(totalDue)}</strong></article><article><span>أرصدة دائنة لصالحنا</span><strong>{money(totalCredit)}</strong></article><article><span>عدد الموردين</span><strong>{suppliers.length}</strong></article></div>
    <form className="ops-form" onSubmit={submit}>
      <h3>تسجيل حركة مديونية</h3>
      <div className="ops-fields">
        <label>المورد<select required value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">اختر المورد</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>نوع الحركة<select value={type} onChange={e=>{setType(e.target.value as typeof type);setCashAccountId("")}}><option value="opening_debt">رصيد مديونية افتتاحي</option><option value="adjustment">تسوية مديونية</option><option value="payment">سداد للمورد</option></select></label>
        <label>الفرع<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">بدون تحديد فرع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>المبلغ بالجنيه<input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label>التاريخ<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
        {type==="payment"&&<label>خزنة السداد<select required value={cashAccountId} onChange={e=>setCashAccountId(e.target.value)}><option value="">اختر خزنة</option>{accounts.filter(a=>isOwner?true:!a.is_central&&a.branch_id===branchId).map(a=><option key={a.id} value={a.id}>{a.name}{a.is_central?" · الخزنة المركزية":a.branches?.name?" · "+a.branches.name:""}</option>)}</select></label>}
        <label className="wide">البيان<input maxLength={500} value={description} onChange={e=>setDescription(e.target.value)} placeholder="رقم فاتورة أو سبب الحركة"/></label>
      </div>
      <button className="primary" disabled={busy||!supplierId||!amount||(type==="payment"&&!cashAccountId)}>{busy?"جارٍ الحفظ…":type==="payment"?"تسجيل السداد وخصمه من الخزنة":"حفظ الحركة"}</button>
      <p className="footnote">المشتريات المسجلة عبر النظام تُضاف تلقائيًا إلى كشف المورد عند تفعيل الربط المحاسبي. لا تسجل فاتورة شراء مرة ثانية كمديونية يدويًا.</p>
    </form>
    <div className="section-heading" style={{marginTop:22}}><h3>أرصدة الموردين</h3><input aria-label="بحث الموردين" placeholder="بحث بالاسم أو الهاتف" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="table-wrap"><table><thead><tr><th>المورد</th><th>الهاتف</th><th>الرصيد المستحق</th></tr></thead><tbody>{filtered.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.phone||"—"}</td><td><strong>{money(Number(s.balance))}</strong></td></tr>)}{!filtered.length&&<tr><td colSpan={3} className="table-empty">لا توجد بيانات موردين مطابقة.</td></tr>}</tbody></table></div>
    <h3 className="ops-subtitle">كشف حركة المديونيات</h3>
    <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>المورد</th><th>نوع الحركة</th><th>الفرع</th><th>البيان</th><th>مدين</th><th>دائن</th></tr></thead><tbody>{entries.map(e=><tr key={e.id}><td>{e.entry_date}</td><td>{e.suppliers?.name??suppliers.find(s=>s.id===e.supplier_id)?.name??"—"}</td><td>{labels[e.source_type??e.entry_type]??labels[e.entry_type]??e.entry_type}</td><td>{e.branches?.name??"—"}</td><td>{e.description||"—"}{e.cash_accounts?.name?<small>{e.cash_accounts.name}</small>:null}</td><td>{e.direction==="debit"?money(Number(e.amount)):"—"}</td><td>{e.direction==="credit"?money(Number(e.amount)):"—"}</td></tr>)}{!entries.length&&<tr><td colSpan={7} className="table-empty">لا توجد حركات مديونية مسجلة بعد.</td></tr>}</tbody></table></div>
  </section>;
}
