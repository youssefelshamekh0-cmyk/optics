import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const items: { id: string; title: string; body: string; createdAt: string; target: string; kind: string }[] = [];
  const { data: stored, error: storedError } = await admin.from("app_notifications")
    .select("id,event_key,title,body,href,entity_type,entity_id,created_at")
    .eq("recipient_user_id", user.id).order("created_at", { ascending: false }).limit(30);
  if (storedError) throw storedError;
  const storedEntityIds = new Set((stored ?? []).map((x: any) => x.entity_id).filter(Boolean));
  for (const x of stored ?? []) {
    const event = String(x.event_key ?? "");
    const target = event.includes("low_stock") ? "inventory" : event.includes("lens") ? "lenses" : event.includes("advance") || event.includes("time_off") || event.includes("payroll") ? "staff" : "debts";
    items.push({ id: x.id, title: x.title, body: x.body, createdAt: x.created_at, target, kind: event });
  }
  if (user.roles.includes("super_admin")) {
    const [advances, leaves, orders] = await Promise.all([
      admin.from("payroll_advance_requests").select("id,amount,created_at,user_profiles(full_name),branches(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
      admin.from("staff_time_off_requests").select("id,request_type,created_at,user_profiles(full_name),branches(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20),
      admin.from("lens_orders").select("id,supplier_name,created_at,branches(name)").eq("status", "pending").order("created_at", { ascending: false }).limit(20)
    ]);
    if (advances.error || leaves.error || orders.error) throw advances.error ?? leaves.error ?? orders.error;
    for (const x of advances.data ?? []) if (!storedEntityIds.has(x.id)) items.push({id:"advance:"+x.id,title:"طلب سلفة جديد",body:(x.user_profiles?.full_name ?? "موظف")+" · "+Number(x.amount).toLocaleString("ar-EG")+" ج.م"+(x.branches?.name?" · "+x.branches.name:""),createdAt:x.created_at,target:"staff",kind:"advance"});
    for (const x of leaves.data ?? []) if (!storedEntityIds.has(x.id)) items.push({id:"leave:"+x.id,title:x.request_type==="leave"?"طلب إجازة":"طلب استئذان",body:(x.user_profiles?.full_name ?? "موظف")+(x.branches?.name?" · "+x.branches.name:""),createdAt:x.created_at,target:"staff",kind:"leave"});
    for (const x of orders.data ?? []) if (!storedEntityIds.has(x.id)) items.push({id:"lens:"+x.id,title:"طلبية عدسات جديدة",body:x.supplier_name+(x.branches?.name?" · "+x.branches.name:""),createdAt:x.created_at,target:"lenses",kind:"lens"});
  } else {
    const { data, error } = await admin.from("payroll_advance_requests").select("id,amount,status,created_at,decided_at").eq("user_id", user.id).in("status", ["paid","rejected"]).order("decided_at", { ascending: false }).limit(10);
    if (error) throw error;
    for (const x of data ?? []) if (!storedEntityIds.has(x.id)) items.push({id:"advance:"+x.id,title:x.status==="paid"?"تمت الموافقة على السلفة وصرفها":"تم رفض طلب السلفة",body:Number(x.amount).toLocaleString("ar-EG")+" ج.م",createdAt:x.decided_at ?? x.created_at,target:"account",kind:"advance"});
  }
  items.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  return Response.json({notifications:items.slice(0,30),count:items.length});
}
