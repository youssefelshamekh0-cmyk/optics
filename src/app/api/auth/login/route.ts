import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "بيانات الدخول غير صحيحة أو الحساب موقوف" }, { status: 401 });
  await audit(user.id, "auth.login", "user", user.id);
  return Response.json({ ok: true, user });
}
