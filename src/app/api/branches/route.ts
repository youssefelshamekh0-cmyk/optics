import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const branchSchema = z.object({ code: z.string().trim().min(2).max(32).regex(/^[\p{L}\p{N}_-]+$/u), name: z.string().trim().min(2).max(120), address: z.string().trim().max(500).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), status: z.enum(["active", "inactive"]).optional() });

export async function GET() {
  const { user, response } = await requirePermission("branches.read");
  if (response) return response;
  const admin = getSupabaseAdmin();
  let query = admin.from("branches").select("id,code,name,address,phone,status,created_at,updated_at").order("name");
  if (!user!.roles.includes("super_admin")) query = query.in("id", user!.branchIds).eq("status", "active");
  const { data, error } = await query;
  if (error) throw error;
  const branches = await Promise.all((data ?? []).map(async (branch) => {
    const { count } = await admin.from("user_branch_access").select("user_id", { count: "exact", head: true }).eq("branch_id", branch.id);
    return { ...branch, status: branch.status.toUpperCase(), _count: { userAccess: count ?? 0 } };
  }));
  return Response.json({ branches });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("branches.manage");
  if (response) return response;
  if (!user!.roles.includes("super_admin")) return Response.json({ error: "إدارة الفروع للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = branchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الفرع" }, { status: 400 });
  const { data, error } = await getSupabaseAdmin().from("branches").insert({ ...parsed.data, code: parsed.data.code.toUpperCase() }).select().single();
  if (error?.code === "23505") return Response.json({ error: "كود الفرع مستخدم بالفعل" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "branch.create", "branch", data.id, { code: data.code, name: data.name });
  return Response.json({ branch: { ...data, status: data.status.toUpperCase(), _count: { userAccess: 0 } } }, { status: 201 });
}
