import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const uuid = z.string().uuid();
function branchAllowed(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, branchId: string) { return user.roles.includes("super_admin") || user.branchIds.includes(branchId); }
async function owner(request: Request) { const { user, response } = await requirePermission("finance.manage"); if (response) return { user, response }; if (!(await requireSameOrigin(request)) && request.method !== "GET") return { user, response: Response.json({ error: "الطلب غير صالح" }, { status: 403 }) }; return { user, response: null }; }

export async function GET(request: Request) {
  const module = new URL(request.url).searchParams.get("module") ?? "deliveries";
  if(module==="seller-finance"){
    const user=await getCurrentUser();if(!user)return Response.json({error:"يلزم تسجيل الدخول"},{status:401});
    if(!user.roles.includes("super_admin")&&!user.permissions.some(p=>["expenses.create","payroll.advance.request"].includes(p))&&!user.roles.includes("salesperson"))return Response.json({error:"ليست لديك صلاحية لعرض طلباتك"},{status:403});
    const branchId=new URL(request.url).searchParams.get("branchId");if(!branchId||!user!.branchIds.includes(branchId))return Response.json({error:"حدد فرعًا من الفروع المسموح بها"},{status:403});
    const admin=getSupabaseAdmin() as any;
    const [accounts,expenses,requests,timeOff]=await Promise.all([
      admin.from("cash_accounts").select("id,branch_id,name,payment_method,active").eq("branch_id",branchId).eq("active",true).order("name"),
      admin.from("expenses").select("id,description,category,amount,expense_date,status,cash_accounts(name)").eq("branch_id",branchId).eq("created_by",user.id).order("expense_date",{ascending:false}).limit(50),
      admin.from("payroll_advance_requests").select("id,amount,notes,status,created_at,decided_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50),
      admin.from("staff_time_off_requests").select("id,request_type,starts_at,ends_at,reason,status,reviewer_note,created_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50),
    ]);if(accounts.error||expenses.error||requests.error||timeOff.error)throw accounts.error??expenses.error??requests.error??timeOff.error;return Response.json({accounts:accounts.data??[],expenses:expenses.data??[],requests:requests.data??[],timeOffRequests:timeOff.data??[]});
  }
  if (module === "deliveries") {
    const { user, response } = await requirePermission("sales.read"); if (response) return response;
    const branchId = new URL(request.url).searchParams.get("branchId");
    if (branchId && !branchAllowed(user!, branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
    const admin=getSupabaseAdmin() as any;
    let q = admin.from("sales").select("id,invoice_number,branch_id,customer_id,total_amount,discount_amount,delivery_status,grand_total,notes,created_at,customers(full_name,phone),branches(name,code),sale_items(item_name,quantity,unit_price,line_total)").neq("delivery_status","cancelled").order("created_at",{ascending:false}).limit(200);
    if (branchId) q = q.eq("branch_id",branchId); else if (!user!.roles.includes("super_admin")) q = q.in("branch_id",user!.branchIds);
    const { data,error }=await q; if(error) throw error;
    const ids=(data??[]).map((s:any)=>s.id);
    const paid=new Map<string,number>();
    if(ids.length){const pay=await admin.from("sale_payments").select("sale_id,amount").in("sale_id",ids);if(pay.error)throw pay.error;for(const x of pay.data??[])paid.set(x.sale_id,(paid.get(x.sale_id)??0)+Number(x.amount));}
    const branchIds = user!.roles.includes("super_admin") ? [...new Set((data ?? []).map((s: any) => s.branch_id))] : user!.branchIds;
    const accountsRes = branchIds.length ? await admin.from("cash_accounts").select("id,branch_id,name,payment_method").in("branch_id", branchIds).eq("active", true).order("name") : { data: [], error: null };
    if (accountsRes.error) throw accountsRes.error;
    return Response.json({ accounts: accountsRes.data ?? [], sales:(data??[]).map((s:any)=>{const p=paid.get(s.id)??0;const due=Math.round((Number(s.grand_total)-p)*100)/100;return {...s,paid_amount:Math.round(p*100)/100,due_amount:due,payment_balance_error:due < -0.009};}) });
  }
  const { user, response } = await owner(request); if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (branchId && !branchAllowed(user!,branchId)) return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
  const admin=getSupabaseAdmin() as any;
  if(module==="central") {
    if(!user!.roles.includes("super_admin"))return Response.json({error:"الخزنة المركزية للمالك فقط"},{status:403});
    const account=await admin.from("cash_accounts").select("id,name").eq("is_central",true).maybeSingle();if(account.error)throw account.error;
    if(!account.data)return Response.json({central:null});
    const [balance,rows,nonCashRows]=await Promise.all([
      admin.rpc("cash_account_balance",{p_account:account.data.id}),
      admin.from("cash_transactions").select("id,direction,amount,description,created_by,created_at").eq("cash_account_id",account.data.id).eq("transaction_type","central_deposit").order("created_at",{ascending:false}).limit(200),
      admin.from("cash_accounts").select("id,branch_id,name,payment_method,opening_balance,active,branches(name)").eq("active",true).eq("is_central",false).not("branch_id","is",null).neq("payment_method","cash").order("name")
    ]);
    if(balance.error||rows.error||nonCashRows.error)throw balance.error??rows.error??nonCashRows.error;
    const nonCashAccounts=await Promise.all((nonCashRows.data??[]).map(async (a:any)=>{
      const result=await admin.rpc("cash_account_balance",{p_account:a.id});
      if(result.error)throw result.error;
      return {...a,balance:Number(result.data??0)};
    }));
    const actorIds=[...new Set((rows.data??[]).map((x:any)=>x.created_by).filter(Boolean))];
    const profiles=actorIds.length?await admin.from("user_profiles").select("id,full_name").in("id",actorIds):{data:[],error:null};if(profiles.error)throw profiles.error;
    const names=new Map((profiles.data??[]).map((x:any)=>[x.id,x.full_name]));
    return Response.json({central:{id:account.data.id,name:account.data.name,balance:Number(balance.data??0),deposits:(rows.data??[]).map((x:any)=>({id:x.id,amount:Number(x.amount),description:x.description,created_at:x.created_at,seller:names.get(x.created_by)??"—"})),nonCashAccounts}});
  }
  if(module==="inventory") {
    let stock=admin.from("branch_products").select("branch_id,product_id,quantity,cost_price,reference_price,products(name,sku,category)").order("updated_at",{ascending:false}).limit(300);
    let moves=admin.from("stock_movements").select("id,branch_id,product_id,quantity_delta,movement_type,reason,created_at,products(name,sku),branches(name)").order("created_at",{ascending:false}).limit(100);
    let transfers=admin.from("inventory_transfers").select("id,operation_id,source_branch_id,destination_branch_id,product_id,quantity,reason,status,dispatched_at,received_at,products(name,sku)").eq("status","in_transit").order("dispatched_at",{ascending:false}).limit(200);
    if(branchId){stock=stock.eq("branch_id",branchId);moves=moves.eq("branch_id",branchId);transfers=transfers.or("source_branch_id.eq."+branchId+",destination_branch_id.eq."+branchId)} else if(!user!.roles.includes("super_admin")){stock=stock.in("branch_id",user!.branchIds);moves=moves.in("branch_id",user!.branchIds);const allowed=user!.branchIds.join(",");transfers=transfers.or("source_branch_id.in.("+allowed+"),destination_branch_id.in.("+allowed+")")}
    let counts=admin.from("inventory_stock_counts").select("id,branch_id,notes,created_by,created_at").order("created_at",{ascending:false}).limit(50);
    if(branchId)counts=counts.eq("branch_id",branchId);else if(!user!.roles.includes("super_admin"))counts=counts.in("branch_id",user!.branchIds);
    const [s,m,p,b,t,countsR]=await Promise.all([stock,moves,admin.from("products").select("id,name,sku,category,active").eq("active",true).order("name"),admin.from("branches").select("id,name,code,status").order("name"),transfers,counts]);
    if(s.error||m.error||p.error||b.error||t.error||countsR.error)throw s.error??m.error??p.error??b.error??t.error??countsR.error;
    const branchNames=new Map((b.data??[]).map((row:any)=>[row.id,row.name]));
    const countIds=(countsR.data??[]).map((row:any)=>row.id);
    const countItemsR=countIds.length?await admin.from("inventory_stock_count_items").select("count_id,quantity_delta").in("count_id",countIds):{data:[],error:null};
    if(countItemsR.error)throw countItemsR.error;
    const countItemsById=new Map<string,{items:number;adjusted:number}>();
    for(const item of countItemsR.data??[]){const row=countItemsById.get(item.count_id)??{items:0,adjusted:0};row.items++;if(Number(item.quantity_delta)!==0)row.adjusted++;countItemsById.set(item.count_id,row);}
    return Response.json({stock:s.data??[],movements:m.data??[],products:p.data??[],branches:b.data??[],stockCounts:(countsR.data??[]).map((row:any)=>({...row,branchName:branchNames.get(row.branch_id)??"—",itemsCount:countItemsById.get(row.id)?.items??0,adjustedItems:countItemsById.get(row.id)?.adjusted??0})),transfers:(t.data??[]).map((row:any)=>({...row,sourceBranchName:branchNames.get(row.source_branch_id)??"—",destinationBranchName:branchNames.get(row.destination_branch_id)??"—"}))});
  }
  if(module==="finance") {
    let accounts=admin.from("cash_accounts").select("id,branch_id,name,account_type,payment_method,opening_balance,active,branches(name)").order("name");
    let expenses=admin.from("expenses").select("id,branch_id,description,category,amount,expense_date,status,cash_account_id,branches(name),cash_accounts(name)").order("expense_date",{ascending:false}).limit(100);
    if(branchId){accounts=accounts.eq("branch_id",branchId);expenses=expenses.eq("branch_id",branchId)} else if(!user!.roles.includes("super_admin")){accounts=accounts.in("branch_id",user!.branchIds);expenses=expenses.in("branch_id",user!.branchIds)}
    const [a,e,t,b,requests,reconciliations]=await Promise.all([accounts,expenses,admin.from("cash_transactions").select("id,cash_account_id,direction,amount,transaction_type,description,created_at,created_by").order("created_at",{ascending:false}).limit(1000),admin.from("branches").select("id,name,code,status").order("name"),admin.from("payroll_advance_requests").select("id,user_id,branch_id,amount,notes,status,created_at,user_profiles(full_name,phone),branches(name)").eq("status","pending").order("created_at"),admin.from("cash_reconciliations").select("id,cash_account_id,expected_balance,counted_balance,difference,notes,created_by,created_at,cash_accounts(name,branch_id,branches(name))").order("created_at",{ascending:false}).limit(100)]);
    if(a.error||e.error||t.error||b.error||requests.error||reconciliations.error)throw a.error??e.error??t.error??b.error??requests.error??reconciliations.error;
    const ids:string[]=(a.data??[]).map((x:any)=>x.id); const movements:any[]=(t.data??[]).filter((x:any)=>ids.includes(x.cash_account_id));
    const balances=await Promise.all((a.data??[]).map(async(account:any)=>{const result=await admin.rpc("cash_account_balance",{p_account:account.id});if(result.error)throw result.error;return {...account,balance:Number(result.data??0)};}));
    const filteredReconciliations=(reconciliations.data??[]).filter((row:any)=>ids.includes(row.cash_account_id));
    return Response.json({accounts:balances,transactions:movements,expenses:e.data??[],requests:requests.data??[],branches:b.data??[],reconciliations:filteredReconciliations});
  }
  if(module==="staff") {
    let employees=admin.from("employees").select("id,user_id,branch_id,full_name,phone,job_title,base_salary,commission_rate,status,branches(name)").order("full_name");
    if(branchId)employees=employees.eq("branch_id",branchId); else if(!user!.roles.includes("super_admin"))employees=employees.in("branch_id",user!.branchIds);
    const {data,error}=await employees; if(error)throw error;
    const ids:string[]=(data??[]).map((x:any)=>x.id); const payroll=ids.length?await admin.from("payroll_entries").select("id,employee_id,period_start,period_end,base_salary,commission_amount,deductions,amount_paid,status,notes").in("employee_id",ids).order("created_at",{ascending:false}).limit(100):{data:[],error:null};
    if(payroll.error)throw payroll.error; let accounts=admin.from("cash_accounts").select("id,branch_id,name,payment_method,active,is_central").eq("active",true); if(branchId)accounts=accounts.or(`branch_id.eq.${branchId},is_central.eq.true`);else if(!user!.roles.includes("super_admin"))accounts=accounts.in("branch_id",user!.branchIds); let timeOffQuery=admin.from("staff_time_off_requests").select("id,user_id,employee_id,branch_id,request_type,starts_at,ends_at,reason,status,reviewer_note,reviewed_at,created_at,user_profiles(full_name,phone),branches(name)").order("created_at",{ascending:false}).limit(200);if(branchId)timeOffQuery=timeOffQuery.eq("branch_id",branchId);else if(!user!.roles.includes("super_admin"))timeOffQuery=timeOffQuery.in("branch_id",user!.branchIds);const [a,users,central,timeOff]=await Promise.all([accounts.order("name"),admin.from("user_profiles").select("id,full_name,phone,user_roles(roles(key))").eq("status","active").order("full_name"),admin.from("cash_accounts").select("id,branch_id,name,payment_method,active,is_central").eq("is_central",true).maybeSingle(),timeOffQuery]); if(a.error||users.error||central.error||timeOff.error)throw a.error??users.error??central.error??timeOff.error;const allAccounts=[...(a.data??[])];if(central.data&&!allAccounts.some((x:any)=>x.id===central.data.id))allAccounts.push(central.data); return Response.json({employees:data??[],payroll:payroll.data??[],accounts:allAccounts,users:users.data??[],branches:(await admin.from("branches").select("id,name,code,status").order("name")).data??[],timeOffRequests:timeOff.data??[]});
  }
  if(module==="purchases") {
    let q=admin.from("purchases").select("id,invoice_number,supplier_id,branch_id,purchased_at,total_cost,amount_paid,status,notes,suppliers(name,phone),branches(name)").order("purchased_at",{ascending:false}).limit(100);
    if(branchId)q=q.eq("branch_id",branchId); else if(!user!.roles.includes("super_admin"))q=q.in("branch_id",user!.branchIds);
    const [p,s,products,branches]=await Promise.all([q,admin.from("suppliers").select("id,name,phone,active").eq("active",true).order("name"),admin.from("products").select("id,name,sku,category").eq("active",true).order("name"),admin.from("branches").select("id,name,code,status").order("name")]);
    if(p.error||s.error||products.error||branches.error)throw p.error??s.error??products.error??branches.error;
    const accounts=await admin.from("cash_accounts").select("id,branch_id,name,payment_method,active").eq("active",true).order("name"); if(accounts.error)throw accounts.error;
    return Response.json({purchases:p.data??[],suppliers:s.data??[],products:products.data??[],branches:branches.data??[],accounts:accounts.data??[]});
  }
  return Response.json({error:"قسم غير معروف"},{status:400});
}

const actionSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("delivery"),saleId:uuid,status:z.enum(["pending","processing","ready","delivered"]),notes:z.string().max(500).default("")}),
 z.object({action:z.literal("deliverAndCollect"),saleId:uuid,cashAccountId:uuid.optional().or(z.literal("")),discountAmount:z.number().min(0).max(100000000).default(0)}),
 z.object({action:z.literal("adjust"),branchId:uuid,productId:uuid,delta:z.number().int().min(-100000).max(100000),reason:z.string().trim().min(2).max(300)}),
 z.object({action:z.literal("transfer"),sourceBranchId:uuid,destinationBranchId:uuid,productId:uuid,quantity:z.number().int().min(1).max(100000),reason:z.string().trim().min(2).max(300),operationId:uuid}),
 z.object({action:z.literal("transferReceive"),transferId:uuid}),
 z.object({action:z.literal("cashAccount"),branchId:uuid,name:z.string().trim().min(2).max(120),accountType:z.enum(["cash","bank","digital"]),paymentMethod:z.enum(["cash","card","instapay","other"]),openingBalance:z.number().min(0).max(100000000)}),
 z.object({action:z.literal("expense"),branchId:uuid,cashAccountId:uuid.nullable().optional(),fromCentral:z.boolean().optional().default(false),operationId:uuid,description:z.string().trim().min(2).max(300),category:z.string().trim().min(2).max(100),amount:z.number().positive().max(100000000),date:z.string().date()}),
 z.object({action:z.literal("timeOffRequest"),branchId:uuid,requestType:z.enum(["leave","permission"]),startsAt:z.string().datetime(),endsAt:z.string().datetime(),reason:z.string().trim().min(2).max(500)}),
 z.object({action:z.literal("timeOffDecision"),requestId:uuid,decision:z.enum(["approve","reject"]),reviewerNote:z.string().max(500).optional().default("")}),
 z.object({action:z.literal("timeOffCancel"),requestId:uuid}),
 z.object({action:z.literal("advanceRequest"),branchId:uuid,amount:z.number().positive().max(10000000),notes:z.string().max(500).default("")}),
 z.object({action:z.literal("advanceDecision"),requestId:uuid,decision:z.enum(["pay","reject"]),cashAccountId:uuid.nullable().optional()}),
 z.object({action:z.literal("employee"),id:uuid.optional(),branchId:uuid,userId:uuid.nullable().optional(),name:z.string().trim().min(2).max(160),phone:z.string().max(40).default(""),jobTitle:z.string().trim().min(2).max(100),baseSalary:z.number().min(0).max(10000000),commissionRate:z.number().min(0).max(100)}),
 z.object({action:z.literal("payrollCreate"),employeeId:uuid,periodStart:z.string().date(),periodEnd:z.string().date(),deductions:z.number().min(0),notes:z.string().max(500).default("")}),
 z.object({action:z.literal("payrollPay"),payrollId:uuid,cashAccountId:uuid,amount:z.number().positive(),operationId:uuid}),
 z.object({action:z.literal("purchase"),invoiceNumber:z.string().trim().min(1).max(100),supplierName:z.string().trim().min(2).max(160),supplierPhone:z.string().max(40).default(""),branchId:uuid,items:z.array(z.object({productId:uuid,quantity:z.number().int().min(1),unitCost:z.number().min(0)})).min(1).max(100),paidAmount:z.number().min(0),cashAccountId:uuid.nullable().optional()}),
 z.object({action:z.literal("centralDeposit"),cashAccountId:uuid.nullable().optional()}),
 z.object({action:z.literal("cashReconcile"),cashAccountId:uuid,operationId:uuid,countedBalance:z.number().min(0).max(1000000000),notes:z.string().trim().max(500).default("")}),
]);

export async function POST(request:Request){
 const parsed=actionSchema.safeParse(await request.json().catch(()=>null)); if(!parsed.success)return Response.json({error:"راجع البيانات المدخلة"},{status:400});
 const {action}=parsed.data; const permission=action==="delivery"||action==="deliverAndCollect"?"deliveries.complete":action==="adjust"||action==="transfer"||action==="transferReceive"?"inventory.manage":action==="purchase"?"purchases.manage":action==="employee"||action.startsWith("payroll")?"staff.manage":action==="advanceRequest"?"payroll.advance.request":action==="timeOffRequest"?"branches.read":action==="timeOffCancel"?"branches.read":action==="timeOffDecision"?"staff.manage":action==="expense"&&!((await getCurrentUser())?.roles.includes("super_admin"))?"expenses.create":"finance.manage";
 const {user,response}=await requirePermission(permission); if(response)return response;
 if(!(await requireSameOrigin(request)))return Response.json({error:"الطلب غير صالح"},{status:403});
 const admin=getSupabaseAdmin() as any; let entityId=""; let actionResult:any=null;
 if(action==="cashReconcile"){
   if(!user!.roles.includes("super_admin"))return Response.json({error:"مطابقة الخزائن متاحة لمالك البراند فقط"},{status:403});
   const {data,error}=await admin.rpc("record_cash_reconciliation",{p_operation_id:parsed.data.operationId,p_cash_account_id:parsed.data.cashAccountId,p_counted_balance:parsed.data.countedBalance,p_actor:user!.id,p_notes:parsed.data.notes});
   if(error?.message.includes("operation id conflict"))return Response.json({error:"معرّف المطابقة مستخدم لبيانات مختلفة"},{status:409});
   if(error?.message.includes("not found or inactive"))return Response.json({error:"الخزنة غير موجودة أو غير نشطة"},{status:409});
   if(error)throw error;
   actionResult=Array.isArray(data)?data[0]:data;
   entityId=actionResult?.id??parsed.data.operationId;
  }else if(action==="centralDeposit"){
   if(!user!.roles.includes("super_admin"))return Response.json({error:"توريد الحسابات غير النقدية للخزنة المركزية متاح للمالك فقط"},{status:403});
   const {data,error}=await admin.rpc("deposit_non_cash_accounts_to_central",{p_account:parsed.data.cashAccountId??null,p_actor:user!.id});
   if(error){
     if(String(error.message).includes("selected account"))return Response.json({error:"الحساب المحدد غير نشط أو ليس حسابًا غير نقدي تابعًا لفرع."},{status:409});
     if(String(error.message).includes("owner-only"))return Response.json({error:"توريد الحسابات غير النقدية متاح للمالك فقط"},{status:403});
     throw error;
   }
   actionResult=data;
   entityId=parsed.data.cashAccountId??user!.id;
 }else if(action==="deliverAndCollect"){
   const sale=await admin.from("sales").select("branch_id").eq("id",parsed.data.saleId).maybeSingle(); if(!sale.data)return Response.json({error:"الفاتورة غير موجودة"},{status:404}); if(!branchAllowed(user!,sale.data.branch_id))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
   if (!parsed.data.cashAccountId) {
     const dueCheck = await admin.from("sale_payments").select("amount").eq("sale_id", parsed.data.saleId);
     if (dueCheck.error) throw dueCheck.error;
     const totalCheck = await admin.from("sales").select("grand_total").eq("id", parsed.data.saleId).single();
     if (totalCheck.error) throw totalCheck.error;
     const paidCheck = (dueCheck.data ?? []).reduce((sum: number, row: any) => sum + Number(row.amount), 0);
     if (Number(totalCheck.data.grand_total) - paidCheck > 0.009) return Response.json({error:"اختر حساب الخزنة الذي سيتم تسجيل المتبقي فيه."},{status:400});
   }
   const {data,error}=await admin.rpc("deliver_sale_and_collect_balance",{p_sale_id:parsed.data.saleId,p_actor:user!.id,p_cash_account:parsed.data.cashAccountId || null,p_discount_amount:parsed.data.discountAmount}); if(error){if(String(error.message).includes("cash account not configured"))return Response.json({error:"حساب الخزنة المختار غير نشط أو لا يتبع فرع الفاتورة."},{status:409});if(String(error.message).includes("already delivered"))return Response.json({error:"الفاتورة تم تسليمها بالفعل."},{status:409});throw error;} entityId=parsed.data.saleId;
 }else if(action==="delivery"){
   const sale=await admin.from("sales").select("branch_id").eq("id",parsed.data.saleId).maybeSingle(); if(!sale.data)return Response.json({error:"الفاتورة غير موجودة"},{status:404}); if(!branchAllowed(user!,sale.data.branch_id))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
   const {error}=await admin.rpc("change_sale_delivery",{p_sale_id:parsed.data.saleId,p_status:parsed.data.status,p_actor:user!.id,p_notes:parsed.data.notes}); if(error)throw error; entityId=parsed.data.saleId;
 }else if(action==="adjust"){
   if(!branchAllowed(user!,parsed.data.branchId))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403}); const {error}=await admin.rpc("adjust_stock",{p_branch_id:parsed.data.branchId,p_product_id:parsed.data.productId,p_delta:parsed.data.delta,p_reason:parsed.data.reason,p_actor:user!.id}); if(error)throw error;
 }else if(action==="transfer"){
    if(!branchAllowed(user!,parsed.data.sourceBranchId)||!branchAllowed(user!,parsed.data.destinationBranchId))return Response.json({error:"ليس لديك وصول للفرعين"},{status:403});
    const {data,error}=await admin.rpc("transfer_stock",{p_source:parsed.data.sourceBranchId,p_destination:parsed.data.destinationBranchId,p_product:parsed.data.productId,p_quantity:parsed.data.quantity,p_reason:parsed.data.reason,p_actor:user!.id,p_operation_id:parsed.data.operationId});
    if(error?.message.includes("insufficient product stock"))return Response.json({error:"الكمية غير متاحة في مخزون الفرع المرسل"},{status:409});
    if(error?.message.includes("operation id conflict"))return Response.json({error:"معرّف التحويل مستخدم لبيانات مختلفة"},{status:409});
    if(error)throw error;
    actionResult=Array.isArray(data)?data[0]:data;entityId=actionResult?.transferId??parsed.data.operationId;
  }else if(action==="transferReceive"){
    const transfer=await admin.from("inventory_transfers").select("id,destination_branch_id,status").eq("id",parsed.data.transferId).maybeSingle();
    if(transfer.error)throw transfer.error;
    if(!transfer.data)return Response.json({error:"التحويل غير موجود"},{status:404});
    if(!branchAllowed(user!,transfer.data.destination_branch_id))return Response.json({error:"استلام التحويل متاح للفرع المستلم فقط"},{status:403});
    const {data,error}=await admin.rpc("receive_inventory_transfer",{p_transfer:parsed.data.transferId,p_actor:user!.id});
    if(error?.message.includes("not awaiting receipt"))return Response.json({error:"التحويل غير موجود في قائمة انتظار الاستلام"},{status:409});
    if(error)throw error;
    actionResult=Array.isArray(data)?data[0]:data;entityId=parsed.data.transferId;
  }else if(action==="cashAccount"){
   if(!branchAllowed(user!,parsed.data.branchId))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403}); const {data,error}=await admin.rpc("create_cash_account",{p_branch:parsed.data.branchId,p_name:parsed.data.name,p_type:parsed.data.accountType,p_method:parsed.data.paymentMethod,p_opening:parsed.data.openingBalance,p_actor:user!.id}); if(error)throw error; entityId=data;
 }else if(action==="expense"){
   if(parsed.data.fromCentral&&!user!.roles.includes("super_admin"))return Response.json({error:"الخزنة المركزية للمالك فقط"},{status:403});
   if(!parsed.data.fromCentral&&!branchAllowed(user!,parsed.data.branchId))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
   let cashAccountId=parsed.data.cashAccountId??null;
   if(parsed.data.fromCentral){
     const {data:centralAccount,error:centralError}=await admin.from("cash_accounts").select("id").eq("is_central",true).eq("active",true).maybeSingle();
     if(centralError)throw centralError;
     if(!centralAccount)return Response.json({error:"الخزنة المركزية غير مهيأة في النظام؛ يلزم تهيئتها من إعدادات النظام."},{status:409});
     cashAccountId=centralAccount.id;
   }else if(!cashAccountId){return Response.json({error:"اختر حساب خزنة الفرع الذي تم الدفع منه"},{status:400});}
   const {data,error}=await admin.rpc("create_expense_from_account",{p_branch:parsed.data.branchId,p_account:cashAccountId,p_description:parsed.data.description,p_category:parsed.data.category,p_amount:parsed.data.amount,p_date:parsed.data.date,p_actor:user!.id,p_from_central:parsed.data.fromCentral}); if(error)throw error; entityId=data;
 }else if(action==="timeOffRequest"){
   if(user!.roles.includes("super_admin")||!user!.branchIds.includes(parsed.data.branchId)||!user!.roles.includes("salesperson"))return Response.json({error:"طلب الإجازة متاح لحسابات البائعين في فروعهم فقط"},{status:403});if(new Date(parsed.data.endsAt)<=new Date(parsed.data.startsAt))return Response.json({error:"وقت النهاية يجب أن يكون بعد البداية"},{status:400});const employee=await admin.from("employees").select("id").eq("user_id",user!.id).eq("branch_id",parsed.data.branchId).maybeSingle();if(employee.error)throw employee.error;const {data,error}=await admin.from("staff_time_off_requests").insert({user_id:user!.id,employee_id:employee.data?.id??null,branch_id:parsed.data.branchId,request_type:parsed.data.requestType,starts_at:parsed.data.startsAt,ends_at:parsed.data.endsAt,reason:parsed.data.reason,created_by:user!.id}).select("id").single();if(error)throw error;entityId=data.id;
 }else if(action==="timeOffCancel"){
   if(user!.roles.includes("super_admin"))return Response.json({error:"لا يمكن إلغاء طلب بائع من حساب المالك"},{status:403});const {data,error}=await admin.from("staff_time_off_requests").update({status:"cancelled"}).eq("id",parsed.data.requestId).eq("user_id",user!.id).eq("status","pending").select("id").maybeSingle();if(error)throw error;if(!data)return Response.json({error:"لا يمكن إلغاء هذا الطلب؛ ربما تمت مراجعته بالفعل"},{status:409});entityId=data.id;
 }else if(action==="timeOffDecision"){
   if(!user!.roles.includes("super_admin"))return Response.json({error:"مراجعة طلبات الإجازات للمالك فقط"},{status:403});const {data:requestRow,error:lookupError}=await admin.from("staff_time_off_requests").select("id,status").eq("id",parsed.data.requestId).maybeSingle();if(lookupError)throw lookupError;if(!requestRow||requestRow.status!=="pending")return Response.json({error:"الطلب غير موجود أو تمت مراجعته بالفعل"},{status:409});if(parsed.data.decision==="reject"&&!parsed.data.reviewerNote.trim())return Response.json({error:"اكتب سبب الرفض حتى يفهم الموظف القرار"},{status:400});const {data,error}=await admin.from("staff_time_off_requests").update({status:parsed.data.decision==="approve"?"approved":"rejected",reviewed_by:user!.id,reviewed_at:new Date().toISOString(),reviewer_note:parsed.data.reviewerNote.trim()||null}).eq("id",parsed.data.requestId).eq("status","pending").select("id").maybeSingle();if(error)throw error;if(!data)return Response.json({error:"تمت مراجعة الطلب بالفعل"},{status:409});entityId=data.id;
 }else if(action==="advanceRequest"){
   if(!user!.branchIds.includes(parsed.data.branchId)||user!.roles.includes("super_admin"))return Response.json({error:"طلب السلفة متاح للبائع في فروعه"},{status:403}); const employee=await admin.from("employees").select("id").eq("user_id",user!.id).maybeSingle();if(employee.error)throw employee.error;const {data,error}=await admin.from("payroll_advance_requests").insert({user_id:user!.id,employee_id:employee.data?.id??null,branch_id:parsed.data.branchId,amount:parsed.data.amount,notes:parsed.data.notes||null,created_by:user!.id}).select("id").single();if(error)throw error;entityId=data.id;
 }else if(action==="advanceDecision"){
   if(!user!.roles.includes("super_admin"))return Response.json({error:"صرف السلف ومراجعتها متاح للمالك فقط"},{status:403});const {data,error}=await admin.rpc("decide_payroll_advance",{p_request:parsed.data.requestId,p_decision:parsed.data.decision,p_account:parsed.data.cashAccountId??null,p_actor:user!.id});if(error)throw error;entityId=parsed.data.requestId;
 }else if(action==="employee"){
   if(!branchAllowed(user!,parsed.data.branchId))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403}); const row={branch_id:parsed.data.branchId,user_id:parsed.data.userId??null,full_name:parsed.data.name,phone:parsed.data.phone||null,job_title:parsed.data.jobTitle,base_salary:parsed.data.baseSalary,commission_rate:parsed.data.commissionRate};
   const q=parsed.data.id?admin.from("employees").update(row).eq("id",parsed.data.id).select("id").single():admin.from("employees").insert(row).select("id").single(); const {data,error}=await q;if(error)throw error;entityId=data.id;
 }else if(action==="payrollCreate"){
   if(parsed.data.periodEnd<parsed.data.periodStart)return Response.json({error:"نهاية الفترة قبل بدايتها"},{status:400});
   if((Date.parse(parsed.data.periodEnd)-Date.parse(parsed.data.periodStart))/86400000>6)return Response.json({error:"كشف الراتب أسبوعي: الفترة يجب ألا تزيد عن 7 أيام"},{status:400});
   const {data:employee,error:e}=await admin.from("employees").select("id,branch_id,user_id,base_salary,commission_rate").eq("id",parsed.data.employeeId).maybeSingle();if(e)throw e;if(!employee)return Response.json({error:"الموظف غير موجود"},{status:404});if(!branchAllowed(user!,employee.branch_id))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
   const overlap=await admin.from("payroll_entries").select("id").eq("employee_id",employee.id).lte("period_start",parsed.data.periodEnd).gte("period_end",parsed.data.periodStart).limit(1);if(overlap.error)throw overlap.error;if(overlap.data?.length)return Response.json({error:"يوجد كشف راتب لهذا الموظف يتداخل مع نفس الأسبوع"},{status:409});
   let commission=0;if(employee.user_id&&Number(employee.commission_rate)>0){const access=await admin.from("user_branch_access").select("branch_id").eq("user_id",employee.user_id);if(access.error)throw access.error;const sellerBranches:string[]=[...new Set<string>([employee.branch_id,...(access.data??[]).map((x:any)=>x.branch_id)])];const sales=await admin.from("sales").select("grand_total").eq("created_by",employee.user_id).in("branch_id",sellerBranches).gte("created_at",parsed.data.periodStart).lte("created_at",parsed.data.periodEnd+"T23:59:59.999Z").neq("delivery_status","cancelled");if(sales.error)throw sales.error;commission=(sales.data??[]).reduce((s:number,x:any)=>s+Number(x.grand_total),0)*Number(employee.commission_rate)/100;}
   const {data,error}=await admin.from("payroll_entries").insert({employee_id:employee.id,period_start:parsed.data.periodStart,period_end:parsed.data.periodEnd,base_salary:employee.base_salary,commission_amount:commission,deductions:parsed.data.deductions,created_by:user!.id,notes:parsed.data.notes||null}).select("id").single();if(error)throw error;entityId=data.id;
 }else if(action==="payrollPay"){
   if(!user!.roles.includes("super_admin"))return Response.json({error:"صرف الرواتب من الخزنة المركزية متاح للمالك فقط"},{status:403});const {data,error}=await admin.rpc("pay_payroll_idempotent",{p_payroll:parsed.data.payrollId,p_account:parsed.data.cashAccountId,p_amount:parsed.data.amount,p_actor:user!.id,p_operation_id:parsed.data.operationId});if(error)throw error;entityId=parsed.data.payrollId;
 }else if(action==="purchase"){
   if(!branchAllowed(user!,parsed.data.branchId))return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403}); const {data,error}=await admin.rpc("receive_purchase",{p_invoice:parsed.data.invoiceNumber,p_supplier:parsed.data.supplierName,p_phone:parsed.data.supplierPhone,p_branch:parsed.data.branchId,p_items:parsed.data.items.map(i=>({productId:i.productId,quantity:i.quantity,unitCost:i.unitCost})),p_paid:parsed.data.paidAmount,p_account:parsed.data.cashAccountId,p_actor:user!.id});if(error?.code==="23505")return Response.json({error:"رقم فاتورة المورد مسجل بالفعل"},{status:409});if(error)throw error;entityId=data;
 }
 if(entityId) await audit(user!.id,`operations.${action}`,action,entityId,action==="centralDeposit"||action==="cashReconcile"||action==="transfer"||action==="transferReceive"?{result:actionResult}:{});
 return Response.json({success:true,id:entityId||null,...(action==="centralDeposit"?{depositResult:actionResult}:{}),...(action==="cashReconcile"?{reconciliation:actionResult}:{}),...(action==="transfer"||action==="transferReceive"?{transferResult:actionResult}:{})});
}
