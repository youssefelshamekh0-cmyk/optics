import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const monthStart=(date:Date)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1));
const monthKey=(date:Date)=>date.toISOString().slice(0,7);
const months=(count:number)=>{const now=new Date();return Array.from({length:count},(_,i)=>{const d=monthStart(now);d.setUTCMonth(d.getUTCMonth()-(count-1-i));return {key:monthKey(d),label:new Intl.DateTimeFormat("ar-EG",{month:"short"}).format(d)}})};
async function fetchAll(query:any){const rows:any[]=[];for(let from=0;from<200000;from+=1000){const {data,error}=await query.range(from,from+999);if(error)throw error;rows.push(...(data??[]));if(!data||data.length<1000)break;}return rows;}
export async function GET(){
 const user=await getCurrentUser();if(!user)return Response.json({error:"يلزم تسجيل الدخول"},{status:401});if(!user.roles.includes("super_admin")&&user.branchIds.length===0)return Response.json({error:"الحساب غير مرتبط بفرع نشط"},{status:403});
 const admin=getSupabaseAdmin() as any;const isOwner=user.roles.includes("super_admin");const now=new Date();const periodStart=monthStart(now).toISOString();const chartStart=months(6)[0].key+"-01T00:00:00.000Z";
 const branchQuery=admin.from("branches").select("id,name,code,status").order("name");if(!isOwner)branchQuery.in("id",user.branchIds);
 const {data:branches,error:branchError}=await branchQuery;if(branchError)throw branchError;
 const branchIds=(branches??[]).map((b:any)=>b.id);
 if(isOwner){
  const [sales,expenses,purchases,payroll,cashAccounts,auditRows,shiftRows]=await Promise.all([
   fetchAll(admin.from("sales").select("id,branch_id,created_by,grand_total,delivery_status,created_at").gte("created_at",chartStart).order("created_at")),
   fetchAll(admin.from("expenses").select("id,branch_id,amount,expense_date,created_at").gte("expense_date",chartStart.slice(0,10)).eq("status","paid").order("created_at")),
   fetchAll(admin.from("purchases").select("id,branch_id,total_cost,amount_paid,purchased_at").gte("purchased_at",chartStart).order("purchased_at")),
   fetchAll(admin.from("payroll_entries").select("id,employee_id,base_salary,commission_amount,deductions,amount_paid,status,paid_at,created_at").gte("created_at",chartStart).order("created_at")),
   fetchAll(admin.from("cash_accounts").select("id,branch_id,name,payment_method,opening_balance,active").eq("active",true)),
   admin.from("audit_logs").select("id,actor_id,action,entity_type,entity_id,created_at").order("created_at",{ascending:false}).limit(20),
   admin.from("seller_shifts").select("id,user_id,branch_id,opening_cash,closing_cash,expected_cash,variance,status,opened_at,closed_at,user_profiles(full_name,phone),branches(name)").order("opened_at",{ascending:false}).limit(20),
  ]);if(auditRows.error||shiftRows.error)throw auditRows.error??shiftRows.error;
  const transactions=cashAccounts.length?await fetchAll(admin.from("cash_transactions").select("cash_account_id,direction,amount,description").in("cash_account_id",cashAccounts.map((a:any)=>a.id))):[];
  const currentMonth=monthKey(now);const series=months(6).map(m=>{const inMonth=(x:any,d:string)=>d.slice(0,7)===m.key;const revenue=sales.filter((x:any)=>inMonth(x,x.created_at)&&x.delivery_status!=="cancelled").reduce((s:number,x:any)=>s+Number(x.grand_total),0);const cost=purchases.filter((x:any)=>inMonth(x,x.purchased_at)).reduce((s:number,x:any)=>s+Number(x.total_cost),0);const expense=expenses.filter((x:any)=>inMonth(x,x.expense_date)).reduce((s:number,x:any)=>s+Number(x.amount),0);const salary=payroll.filter((x:any)=>x.paid_at&&inMonth(x,x.paid_at)).reduce((s:number,x:any)=>s+Number(x.amount_paid),0);return {...m,revenue,expenses:expense,purchases:cost,payroll:salary};});
  const currentSales=sales.filter((x:any)=>x.created_at.slice(0,7)===currentMonth&&x.delivery_status!=="cancelled");const dueTotal=await (async()=>{const ids=currentSales.map((x:any)=>x.id);if(!ids.length)return 0;const paid=await fetchAll(admin.from("sale_payments").select("sale_id,amount").in("sale_id",ids));return currentSales.reduce((sum:number,x:any)=>sum+Number(x.grand_total),0)-paid.reduce((sum:number,x:any)=>sum+Number(x.amount),0)})();
  const accountRows=(cashAccounts??[]).map((a:any)=>({...a,balance:Number(a.opening_balance)+transactions.filter((t:any)=>t.cash_account_id===a.id&&t.description!=="رصيد افتتاحي").reduce((s:number,t:any)=>s+(t.direction==="in"?1:-1)*Number(t.amount),0)}));
  const currentExpenses=expenses.filter((x:any)=>x.expense_date.slice(0,7)===currentMonth).reduce((s:number,x:any)=>s+Number(x.amount),0);const currentPurchases=purchases.filter((x:any)=>x.purchased_at.slice(0,7)===currentMonth);const pendingPayroll=payroll.filter((x:any)=>x.status==="pending").reduce((s:number,x:any)=>s+Number(x.base_salary)+Number(x.commission_amount)-Number(x.deductions)-Number(x.amount_paid),0);
  const byBranch=branches.map((b:any)=>({id:b.id,name:b.name,code:b.code,sales:currentSales.filter((s:any)=>s.branch_id===b.id).reduce((sum:number,s:any)=>sum+Number(s.grand_total),0),orders:currentSales.filter((s:any)=>s.branch_id===b.id).length}));
  const actors=[...new Set((auditRows.data??[]).map((x:any)=>x.actor_id).filter(Boolean))];const profiles=actors.length?await admin.from("user_profiles").select("id,full_name").in("id",actors):{data:[],error:null};if(profiles.error)throw profiles.error;const profileMap=new Map((profiles.data??[]).map((x:any)=>[x.id,x.full_name]));
  return Response.json({role:"owner",branches,metrics:{sales:currentSales.reduce((s:number,x:any)=>s+Number(x.grand_total),0),orders:currentSales.length,due:Math.max(0,dueTotal),expenses:currentExpenses,purchases:currentPurchases.reduce((s:number,x:any)=>s+Number(x.total_cost),0),supplierDue:currentPurchases.reduce((s:number,x:any)=>s+Number(x.total_cost)-Number(x.amount_paid),0),cash:accountRows.reduce((s:number,x:any)=>s+Number(x.balance),0),pendingPayroll,branchCount:branches.length},accounts:accountRows,series,byBranch,shifts:shiftRows.data??[],recentOperations:(auditRows.data??[]).map((x:any)=>({...x,actor_name:profileMap.get(x.actor_id)??"النظام"}))});
 }
 const [{data:employee,error:employeeError},{data:ownSales,error:salesError},{data:requests,error:requestsError},{data:ownExpenses,error:expensesError}]=await Promise.all([
  admin.from("employees").select("id,branch_id,full_name,job_title,base_salary,commission_rate,status").eq("user_id",user.id).maybeSingle(),
  admin.from("sales").select("id,branch_id,grand_total,delivery_status,created_at").eq("created_by",user.id).gte("created_at",chartStart).order("created_at",{ascending:false}),
  admin.from("payroll_advance_requests").select("id,amount,notes,status,created_at,decided_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50),
  admin.from("expenses").select("id,amount,description,category,expense_date").eq("created_by",user.id).in("branch_id",branchIds).gte("expense_date",chartStart.slice(0,10)).order("expense_date",{ascending:false}),
 ]);if(employeeError||salesError||requestsError||expensesError)throw employeeError??salesError??requestsError??expensesError;
 const salesRows=ownSales??[];
 const ownedSales=salesRows.filter((x:any)=>x.delivery_status!=="cancelled");const monthSales=ownedSales.filter((x:any)=>x.created_at.slice(0,7)===monthKey(now));const advances=requests??[];const branchMap=new Map((branches??[]).map((b:any)=>[b.id,b]));
 const sellerSeries=months(6).map(m=>({...m,sales:ownedSales.filter((x:any)=>x.created_at.slice(0,7)===m.key).reduce((s:number,x:any)=>s+Number(x.grand_total),0)}));
 return Response.json({role:"seller",branches,employee,metrics:{sales:monthSales.reduce((s:number,x:any)=>s+Number(x.grand_total),0),orders:monthSales.length,commission:monthSales.reduce((s:number,x:any)=>s+Number(x.grand_total),0)*Number(employee?.commission_rate??0)/100,expenses:(ownExpenses??[]).filter((x:any)=>x.expense_date.slice(0,7)===monthKey(now)).reduce((s:number,x:any)=>s+Number(x.amount),0),paidAdvances:advances.filter((x:any)=>x.status==="paid"&&x.created_at.slice(0,7)===monthKey(now)).reduce((s:number,x:any)=>s+Number(x.amount),0),pendingAdvances:advances.filter((x:any)=>x.status==="pending").reduce((s:number,x:any)=>s+Number(x.amount),0)},sales:ownedSales.slice(0,10).map((x:any)=>({...x,branch:branchMap.get(x.branch_id)})),requests:advances,expenses:ownExpenses??[],series:sellerSeries});
}
