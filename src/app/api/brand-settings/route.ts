import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const MAX_DATA_URL_LENGTH = 1_500_000;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("brand_settings").select("logo_data_url,updated_at").eq("id", true).maybeSingle();
  if (error) return Response.json({ error: "تعذر تحميل إعدادات العلامة التجارية" }, { status: 500 });
  return Response.json({ logoDataUrl: data?.logo_data_url ?? null, updatedAt: data?.updated_at ?? null });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "إعدادات العلامة التجارية للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const body = await request.json().catch(() => null) as { logoDataUrl?: unknown; remove?: unknown } | null;
  if (!body || (body.remove !== true && (typeof body.logoDataUrl !== "string" || body.logoDataUrl.length > MAX_DATA_URL_LENGTH || !DATA_URL_PATTERN.test(body.logoDataUrl)))) {
    return Response.json({ error: "ارفع صورة PNG أو JPG أو WebP بحجم لا يتجاوز 1 ميجابايت" }, { status: 400 });
  }
  const logoDataUrl = body.remove === true ? null : body.logoDataUrl as string;
  const admin = getSupabaseAdmin() as any;
  const { error } = await admin.from("brand_settings").upsert({ id: true, logo_data_url: logoDataUrl, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: "id" });
  if (error) return Response.json({ error: "تعذر حفظ شعار البراند. تأكد من تطبيق تحديث قاعدة البيانات." }, { status: 500 });
  await audit(user.id, body.remove === true ? "brand.logo_remove" : "brand.logo_update", "brand_settings", "true", {});
  return Response.json({ success: true, logoDataUrl });
}
