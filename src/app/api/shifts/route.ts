import {z} from "zod";
import {getSupabaseAdmin} from "@/lib/supabase/admin";
import {getCurrentUser,requirePermission,requireSameOrigin} from "@/lib/auth";
import {audit} from "@/lib/audit";
const openSchema=z.object({action:z.literal("open"),branchId:z.string().uuid(),cashAccountId:z.string().uuid(),openingCash:z.number().min(0).max(10000000)});
const closeSchema=z.object({action:z.literal("close"),shiftId:z.string().uuid(),closingCash:z.number().min(0).max(10000000),notes:z.string().max(500).default("")});
export async function GET(){
 const user=await getCurrentUser();if(!user)return Response.json({error:"يلزم تسجيل الدخول"},{status:401});const admin=getSupabaseAdmin() as any;
 if(user.roles.includes("super_admin")){const {data,error}=await admin.from("seller_shifts").select("id,user_id,branch_id,cash_account_id,opening_cash,closing_cash,expected_cash,variance,status,opened_at,closed_at,closing_notes,user_profiles(full_name,phone),branches(name,code),cash_accounts(name)").order("opened_at",{ascending:false}).limit(200);if(error)throw error;return Response.json({owner:true,shifts:data??[]});}
 const {data:shift,error}=await admin.from("seller_shifts").select("id,branch_id,cash_account_id,opening_cash,closing_cash,status,opened_at,closed_at,branches(name,code),cash_accounts(name)").eq("user_id",user.id).order("opened_at",{ascending:false}).limit(20);if(error)throw error;
 const {data:accounts,error:accountError}=await admin.from("cash_accounts").select("id,branch_id,name,payment_method").in("branch_id",user.branchIds).eq("payment_method","cash").eq("active",true);if(accountError)throw accountError;
 return Response.json({owner:false,shifts:shift??[],accounts:accounts??[]});
}
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user)return Response.json({error:"يلزم تسجيل الدخول"},{status:401});if(!(await requireSameOrigin(request)))return Response.json({error:"الطلب غير صالح"},{status:403});
 if(user.roles.includes("super_admin"))return Response.json({error:"الوردية مطلوبة لحسابات البائعين فقط"},{status:400});
 const parsed=z.discriminatedUnion("action",[openSchema,closeSchema]).safeParse(await request.json().catch(()=>null));if(!parsed.success)return Response.json({error:"راجع بيانات الوردية"},{status:400});const admin=getSupabaseAdmin() as any;
 if(parsed.data.action==="open"){
   const {data,error}=await admin.rpc("open_seller_shift",{p_user:user.id,p_branch:parsed.data.branchId,p_cash_account:parsed.data.cashAccountId,p_opening_cash:parsed.data.openingCash});if(error)return Response.json({error:error.message.includes("duplicate")?"لديك وردية مفتوحة بالفعل":"تعذر فتح الوردية؛ تأكد من الفرع والخزنة"},{status:400});
   await audit(user.id,"shift.open","seller_shift",data,{branchId:parsed.data.branchId});return Response.json({success:true,shiftId:data});
 }
 const {data,error}=await admin.rpc("close_seller_shift",{p_shift:parsed.data.shiftId,p_user:user.id,p_count:parsed.data.closingCash,p_notes:parsed.data.notes});if(error)return Response.json({error:"تعذر إغلاق الوردية؛ تحقق من أنها مفتوحة"},{status:400});
 await audit(user.id,"shift.close","seller_shift",parsed.data.shiftId,{});
 // Deliberately discard expected cash and variance: those are owner-only reconciliation data.
 return Response.json({success:true,message:"تم إغلاق الوردية وتسجيل العد"});
}
