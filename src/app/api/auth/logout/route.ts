import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST() {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return Response.json({ error: "تعذر تسجيل الخروج" }, { status: 400 });
  if (user) await audit(user.id, "auth.logout", "user", user.id);
  return Response.json({ ok: true });
}
