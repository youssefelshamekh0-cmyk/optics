"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
type Branch={id:string;name:string;code:string;status:"ACTIVE"|"INACTIVE"};
type Order={id:string;branch_id:string;supplier_name:string;customer_name:string|null;lens_description:string;quantity:number;status:string;notes:string|null;created_at:string;branches?:{name:string;code:string}|null};
const labels:Record<string,string>={pending:"جديدة",ordered:"تم الطلب",received:"تم الاستلام",cancelled:"ملغاة"};
const moneyDate=(d:string)=>new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short"}).format(new Date(d));
async function api(url:string,init?:RequestInit){const r=await fetch(url,{...init,headers:{"content-type":"application/json",...init?.headers},cache:"no-store"});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"تعذر تنفيذ الطلب");return d}
export default function LensOrders({branches,branchIds,isOwner}:{branches:Branch[];branchIds:string[];isOwner:boolean}){
 const available=branches.filter(b=>b.status==="ACTIVE"&&(isOwner||branchIds.includes(b.id)));
 const [branchId,setBranchId]=useState("");
 const [orders,setOrders]=useState<Order[]>([]);
 const [form,setForm]=useState({supplierName:"",customerName:"",lensDescription:"",quantity:"1",notes:""});
 const [search,setSearch]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 useEffect(()=>{if(!branchId&&available.length)setBranchId(available[0].id)},[branchId,available]);
 const refresh=useCallback(async()=>{try{const q=branchId?"?branchId="+encodeURIComponent(branchId):"";const d=await api("/api/lens-orders"+q);setOrders(d.orders??[]);setError("")}catch(e){setError(e instanceof Error?e.message:"تعذر تحميل الطلبيات")}},[branchId]);
 useEffect(()=>{if(branchId||isOwner)void refresh()},[refresh,branchId,isOwner]);
 async function create(e:FormEvent){e.preventDefault();setBusy(true);setError("");setNotice("");try{await api("/api/lens-orders",{method:"POST",body:JSON.stringify({branchId,...form,quantity:Number(form.quantity)})});setForm({supplierName:"",customerName:"",lensDescription:"",quantity:"1",notes:""});setNotice("تم تسجيل طلبية العدسات");await refresh()}catch(e){setError(e instanceof Error?e.message:"تعذر حفظ الطلبية")}finally{setBusy(false)}}
 async function setStatus(order:Order,status:string){setBusy(true);setError("");try{await api("/api/lens-orders",{method:"PATCH",body:JSON.stringify({id:order.id,status})});setNotice("تم تحديث حالة الطلبية");await refresh()}catch(e){setError(e instanceof Error?e.message:"تعذر تحديث الحالة")}finally{setBusy(false)}}
 const visible=orders.filter(o=>[o.supplier_name,o.customer_name??"",o.lens_description,o.notes??"",o.branches?.name??""].some(v=>v.toLocaleLowerCase("ar-EG").includes(search.trim().toLocaleLowerCase("ar-EG"))));
 return <section className="panel">
  <div className="section-heading"><div><p className="eyebrow">متابعة المورد والفرع</p><h2>طلبيات العدسات</h2></div><span className="count-badge">{orders.length} طلبية</span></div>
  <div className="ops-toolbar"><label>الفرع<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{available.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>بحث<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="المورد أو العميل أو وصف العدسة"/></label></div>
  {error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
  <form className="ops-forms" onSubmit={create}><div className="ops-form"><h3>تسجيل طلبية جديدة</h3>
   <label>المورد<input required minLength={2} maxLength={160} value={form.supplierName} onChange={e=>setForm({...form,supplierName:e.target.value})}/></label>
   <label>اسم العميل (اختياري)<input maxLength={160} value={form.customerName} onChange={e=>setForm({...form,customerName:e.target.value})}/></label>
   <label>تفاصيل العدسة / المقاس<input required minLength={2} maxLength={500} value={form.lensDescription} onChange={e=>setForm({...form,lensDescription:e.target.value})} placeholder="النوع، الخامة، المقاس، المعالجة…"/></label>
   <label>الكمية<input type="number" min="1" max="1000" required value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>
   <label>ملاحظات<textarea maxLength={1000} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
   <button className="primary" disabled={busy||!branchId}>{busy?"جارٍ الحفظ…":"حفظ الطلبية"}</button>
  </div></form>
  <h3 className="ops-subtitle">سجل الطلبيات</h3><div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الفرع</th><th>المورد / العميل</th><th>تفاصيل العدسة</th><th>الكمية</th><th>الحالة</th><th>تحديث الحالة</th></tr></thead><tbody>
  {visible.map(o=><tr key={o.id}><td>{moneyDate(o.created_at)}</td><td>{o.branches?.name??available.find(b=>b.id===o.branch_id)?.name??"—"}</td><td>{o.supplier_name}<small>{o.customer_name||"—"}</small></td><td>{o.lens_description}<small>{o.notes||""}</small></td><td>{o.quantity}</td><td>{labels[o.status]??o.status}</td><td><select aria-label="حالة الطلبية" disabled={busy||(!isOwner&&!available.some(b=>b.id===o.branch_id))} value={o.status} onChange={e=>void setStatus(o,e.target.value)}><option value="pending">جديدة</option><option value="ordered">تم الطلب</option><option value="received">تم الاستلام</option><option value="cancelled">ملغاة</option></select></td></tr>)}
  {!visible.length&&<tr><td colSpan={7} className="table-empty">لا توجد طلبيات مطابقة.</td></tr>}
  </tbody></table></div><p className="footnote">تُحفظ الطلبيات في سجل مستقل لكل فرع. استلام الطلبية هنا يحدّث حالتها فقط ولا يضيف مخزونًا تلقائيًا؛ سجّل التوريد من قسم توريد العدسات عند وصولها.</p>
 </section>
}
