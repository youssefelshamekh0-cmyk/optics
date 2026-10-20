import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";

const schema = z.object({ subscription: z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
}) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? null });
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "اشتراك إشعارات غير صالح" }, { status: 400 });
  const { endpoint, keys } = parsed.data.subscription;
  const admin = getSupabaseAdmin() as any;
  const { error } = await admin.from("push_subscriptions").upsert({
    user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth,
    user_agent: request.headers.get("user-agent"), updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) throw error;
  return Response.json({ success: true });
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const body = z.object({ endpoint: z.string().url().max(2048) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "عنوان الاشتراك غير صحيح" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  const { error } = await admin.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", body.data.endpoint);
  if (error) throw error;
  return Response.json({ success: true });
}
