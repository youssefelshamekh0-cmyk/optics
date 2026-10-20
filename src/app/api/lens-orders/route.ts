import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const createSchema = z.object({
  branchId: z.string().uuid(),
  supplierName: z.string().trim().min(2).max(160),
  customerName: z.string().trim().max(160).default(""),
  lensDescription: z.string().trim().min(2).max(500),
  quantity: z.number().int().min(1).max(1000),
  notes: z.string().trim().max(1000).default("")
});
const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending","ordered","received","cancelled"])
});
function allowed(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, branchId: string) {
  return user.roles.includes("super_admin") || user.branchIds.includes(branchId);
}
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:"يلزم تسجيل الدخول"},{status:401});
  if (!user.roles.includes("super_admin") && !user.permissions.some(p => ["sales.create","sales.read","inventory.manage","purchases.manage"].includes(p))) return Response.json({error:"ليست لديك صلاحية لعرض طلبيات العدسات"},{status:403});
  const branchId = new URL(request.url).searchParams.get("branchId");
  if (branchId && !allowed(user,branchId)) return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
  const admin = getSupabaseAdmin() as any;
  let query = admin.from("lens_orders").select("id,branch_id,supplier_name,customer_name,lens_description,quantity,status,notes,created_at,updated_at,branches(name,code)").order("created_at",{ascending:false}).limit(300);
  if (branchId) query = query.eq("branch_id",branchId);
  else if (!user.roles.includes("super_admin")) query = query.in("branch_id",user.branchIds);
  const {data,error}=await query;
  if(error) throw error;
  return Response.json({orders:data??[]});
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({error:"يلزم تسجيل الدخول"},{status:401});
  if (!user.roles.includes("super_admin") && !user.permissions.some(p => ["sales.create","inventory.manage","purchases.manage"].includes(p))) return Response.json({error:"ليست لديك صلاحية لإنشاء طلبية عدسات"},{status:403});
  if (!(await requireSameOrigin(request))) return Response.json({error:"الطلب غير صالح"},{status:403});
  const parsed=createSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return Response.json({error:"راجع بيانات الطلبية وتأكد من اكتمال الحقول"},{status:400});
  if(!allowed(user,parsed.data.branchId)) return Response.json({error:"ليس لديك وصول لهذا الفرع"},{status:403});
  const admin=getSupabaseAdmin() as any;
  const {data,error}=await admin.from("lens_orders").insert({...parsed.data,created_by:user.id,customer_name:parsed.data.customerName||null,notes:parsed.data.notes||null}).select("id").single();
  if(error) throw error;
  await audit(user.id,"lens_order.created","lens_order",data.id,{branchId:parsed.data.branchId,quantity:parsed.data.quantity});
  return Response.json({success:true,id:data.id},{status:201});
}
export async function PATCH(request: Request) {
  const user=await getCurrentUser();
  if(!user) return Response.json({error:"يلزم تسجيل الدخول"},{status:401});
  if(!user.roles.includes("super_admin")&&!user.permissions.some(p=>["inventory.manage","purchases.manage"].includes(p))) return Response.json({error:"تغيير حالة الطلبيات متاح للإدارة"},{status:403});
  if(!(await requireSameOrigin(request))) return Response.json({error:"الطلب غير صالح"},{status:403});
  const parsed=updateSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success) return Response.json({error:"بيانات تحديث الطلبية غير صحيحة"},{status:400});
  const admin=getSupabaseAdmin() as any;
  const {data:existing,error:lookupError}=await admin.from("lens_orders").select("id,branch_id").eq("id",parsed.data.id).maybeSingle();
  if(lookupError) throw lookupError;
  if(!existing||!allowed(user,existing.branch_id)) return Response.json({error:"الطلبية غير موجودة أو لا تملك صلاحية الوصول"},{status:404});
  const {error}=await admin.from("lens_orders").update({status:parsed.data.status,updated_at:new Date().toISOString()}).eq("id",parsed.data.id);
  if(error) throw error;
  await audit(user.id,"lens_order.status_changed","lens_order",parsed.data.id,{status:parsed.data.status});
  return Response.json({success:true});
}
