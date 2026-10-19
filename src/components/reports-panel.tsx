"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Branch={id:string;name:string;code?:string;status?:string};
type Employee={id:string;full_name:string;branch_id:string;branches?:{name:string}|null};
type Payroll={id:string;employee_id:string;period_start:string;period_end:string;base_salary:number;commission_amount:number;deductions:number;amount_paid:number;status:string;notes?:string|null};
type Expense={id:string;branch_id:string;description:string;category:string;amount:number;expense_date:string;branches?:{name:string}|null};
type Account={id:string;branch_id:string|null;name:string;balance:number;branches?:{name:string}|null};
type Transaction={id:string;cash_account_id:string;direction:string;amount:number;transaction_type:string;description:string;created_at:string};
const money=(n:number)=>new Intl.NumberFormat("ar-EG",{style:"currency",currency:"EGP",maximumFractionDigits:2}).format(n);
const day=(d:Date)=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const startMonth=()=>day(new Date(new Date().getFullYear(),new Date().getMonth(),1));
function downloadCsv(name:string,rows:(string|number)[][]){const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\r\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
export default function ReportsPanel({branches}:{branches:Branch[]}){
 const [kind,setKind]=useState<"staff"|"finance">("staff");
 const [from,setFrom]=useState(startMonth);const [to,setTo]=useState(()=>day(new Date()));
 const [branchId,setBranchId]=useState("");const [employeeId,setEmployeeId]=useState("");
 const [employees,setEmployees]=useState<Employee[]>([]);const [payroll,setPayroll]=useState<Payroll[]>([]);
 const [expenses,setExpenses]=useState<Expense[]>([]);const [accounts,setAccounts]=useState<Account[]>([]);const [transactions,setTransactions]=useState<Transaction[]>([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const load=useCallback(async()=>{setBusy(true);setError("");try{
   const [s,f]=await Promise.all([fetch("/api/operations?module=staff",{cache:"no-store"}),fetch("/api/operations?module=finance",{cache:"no-store"})]);
   const sj=await s.json();const fj=await f.json();if(!s.ok)throw new Error(sj.error||"تعذر تحميل تقارير الموظفين");if(!f.ok)throw new Error(fj.error||"تعذر تحميل التقارير المالية");
   setEmployees(sj.employees??[]);setPayroll(sj.payroll??[]);setExpenses(fj.expenses??[]);setAccounts(fj.accounts??[]);setTransactions(fj.transactions??[]);
 }catch(e){setError(e instanceof Error?e.message:"تعذر تحميل التقارير")}finally{setBusy(false)}},[]);
 useEffect(()=>{void load()},[load]);
 const staffRows=useMemo(()=>payroll.filter(p=>p.period_start>=from&&p.period_end<=to&&(!employeeId||p.employee_id===employeeId)&&(!branchId||employees.find(e=>e.id===p.employee_id)?.branch_id===branchId)).map(p=>({...p,employee:employees.find(e=>e.id===p.employee_id)})),[payroll,from,to,employeeId,branchId,employees]);
 const financeExpenses=useMemo(()=>expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to&&(!branchId||e.branch_id===branchId)),[expenses,from,to,branchId]);
 const branchAccounts=useMemo(()=>accounts.filter(a=>!branchId||a.branch_id===branchId),[accounts,branchId]);
 const accountIds=new Set(branchAccounts.map(a=>a.id));
 const financeTransactions=useMemo(()=>transactions.filter(t=>t.created_at.slice(0,10)>=from&&t.created_at.slice(0,10)<=to&&accountIds.has(t.cash_account_id)),[transactions,from,to,accountIds]);
 const totalPayroll=staffRows.reduce((s,p)=>s+Number(p.base_salary)+Number(p.commission_amount)-Number(p.deductions),0);
 const totalExpenses=financeExpenses.reduce((s,e)=>s+Number(e.amount),0);
 return <section className="panel operations-panel">
  <div className="section-heading"><div><p className="eyebrow">تقارير الإدارة</p><h2>التقارير المالية للبراند والفروع</h2><p className="muted">تقارير الموظفين وكشوف الحساب، مع فلترة بالتاريخ والفرع.</p></div></div>
  <div className="ops-toolbar">
   <label>نوع التقرير<select value={kind} onChange={e=>setKind(e.target.value as "staff"|"finance")}><option value="staff">تقارير الموظفين وكشوف الحساب</option><option value="finance">التقارير المالية للبراند والفروع</option></select></label>
   <label>من تاريخ<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>إلى تاريخ<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label>
   <label>النطاق<select value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">البراند بالكامل · كل الفروع</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   {kind==="staff"&&<label>الموظف<select value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">كل الموظفين</option>{employees.filter(e=>!branchId||e.branch_id===branchId).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>}
   <button type="button" className="row-action" onClick={()=>void load()} disabled={busy}>{busy?"جارٍ التحديث…":"تحديث"}</button>
   <button type="button" className="row-action" onClick={()=>kind==="staff"?downloadCsv("employee-reports.csv",[["الموظف","من","إلى","الراتب الأساسي","العمولة","الخصومات","الصافي","الحالة"],...staffRows.map(p=>[p.employee?.full_name??"",p.period_start,p.period_end,p.base_salary,p.commission_amount,p.deductions,Number(p.base_salary)+Number(p.commission_amount)-Number(p.deductions),p.status])]):downloadCsv("brand-financial-report.csv",[["التاريخ","الفرع","البند","التصنيف","القيمة"],...financeExpenses.map(e=>[e.expense_date,e.branches?.name??"",e.description,e.category,e.amount]),...financeTransactions.map(t=>[t.created_at.slice(0,10),branchAccounts.find(a=>a.id===t.cash_account_id)?.branches?.name??"الخزنة المركزية",t.description,t.transaction_type,(t.direction==="in"?1:-1)*Number(t.amount)])])}>استخراج التقرير</button>
  </div>
  {error&&<div className="notice error" role="alert">{error}</div>}
  {kind==="staff"?<>
   <div className="stats"><div className="stat-card"><span>عدد كشوف الرواتب</span><strong>{staffRows.length}</strong></div><div className="stat-card"><span>إجمالي صافي الرواتب</span><strong>{money(totalPayroll)}</strong></div></div>
   <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>من</th><th>إلى</th><th>الأساسي</th><th>العمولة</th><th>الخصومات</th><th>الصافي</th><th>الحالة</th></tr></thead><tbody>{staffRows.map(p=><tr key={p.id}><td>{p.employee?.full_name??"—"}</td><td>{p.period_start}</td><td>{p.period_end}</td><td>{money(Number(p.base_salary))}</td><td>{money(Number(p.commission_amount))}</td><td>{money(Number(p.deductions))}</td><td><strong>{money(Number(p.base_salary)+Number(p.commission_amount)-Number(p.deductions))}</strong></td><td>{p.status}</td></tr>)}{!staffRows.length&&<tr><td colSpan={8} className="table-empty">لا توجد كشوف رواتب في الفترة المحددة.</td></tr>}</tbody></table></div>
  </>:<>
   <div className="stats"><div className="stat-card"><span>إجمالي المصروفات المسجلة</span><strong>{money(totalExpenses)}</strong></div><div className="stat-card"><span>حركات الخزائن</span><strong>{financeTransactions.length}</strong></div></div>
   <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الفرع</th><th>البند</th><th>التصنيف</th><th>القيمة</th></tr></thead><tbody>{financeExpenses.map(e=><tr key={e.id}><td>{e.expense_date}</td><td>{e.branches?.name??"—"}</td><td>{e.description}</td><td>{e.category}</td><td>{money(Number(e.amount))}</td></tr>)}{!financeExpenses.length&&<tr><td colSpan={5} className="table-empty">لا توجد مصروفات في الفترة المحددة.</td></tr>}</tbody></table></div>
   <h3 className="ops-subtitle">أرصدة الخزائن</h3><div className="table-wrap"><table><thead><tr><th>الخزنة</th><th>الفرع</th><th>الرصيد الحالي</th></tr></thead><tbody>{branchAccounts.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.branches?.name??(a.branch_id?"—":"البراند")}</td><td><strong>{money(Number(a.balance??0))}</strong></td></tr>)}</tbody></table></div>
  </>}
  <p className="footnote">التقرير يعرض البيانات المسجلة والمتاحة في النظام للفترة المحددة. تصدير CSV يفتح في Excel.</p>
 </section>
}