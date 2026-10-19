import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(8).max(72) });

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف" }, { status: 400 });
  const { currentPassword, newPassword } = parsed.data;
  if (currentPassword === newPassword) return Response.json({ error: "كلمة المرور الجديدة مطابقة للحالية" }, { status: 400 });

  // Confirm the current password with a throwaway client so the browser session cookies are untouched.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");
  const verifier = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const credentials = user.phone ? { phone: user.phone, password: currentPassword } : user.email ? { email: user.email, password: currentPassword } : null;
  if (!credentials) return Response.json({ error: "تعذر التحقق من الحساب" }, { status: 400 });
  const { error: verifyError } = await verifier.auth.signInWithPassword(credentials);
  if (verifyError) return Response.json({ error: "كلمة المرور الحالية غير صحيحة" }, { status: 400 });
  await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);

  const { error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) return Response.json({ error: "تعذر تغيير كلمة المرور؛ جرّب كلمة مرور أقوى" }, { status: 400 });
  await audit(user.id, "user.password_change", "user", user.id, {});
  return Response.json({ success: true });
}
