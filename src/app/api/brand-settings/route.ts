import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

const BUCKET = "brand-assets";
const MAX_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("brand_settings")
    .select("brand_name,logo_path").eq("id", true).maybeSingle();
  if (error) return Response.json({ error: "تعذر تحميل إعدادات البراند" }, { status: 500 });
  let logoUrl: string | null = null;
  if (data?.logo_path) {
    const { data: signed, error: signedError } = await admin.storage.from(BUCKET)
      .createSignedUrl(data.logo_path, 3600);
    if (!signedError) logoUrl = signed?.signedUrl ?? null;
  }
  return Response.json({ brandName: data?.brand_name ?? "نظرة", logoUrl });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "غير مسموح بتعديل هوية البراند" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });

  let form: FormData;
  try { form = await request.formData(); }
  catch { return Response.json({ error: "البيانات غير صالحة" }, { status: 400 }); }
  const brandName = String(form.get("brandName") ?? "").trim();
  if (!brandName || brandName.length > 100) return Response.json({ error: "اكتب اسم البراند بحد أقصى 100 حرف" }, { status: 400 });
  const candidate = form.get("logo");
  const file = candidate instanceof File && candidate.size > 0 ? candidate : null;
  if (file && (file.size > MAX_BYTES || !MIME_EXT[file.type])) {
    return Response.json({ error: "ارفع صورة PNG أو JPG أو WebP بحجم لا يتجاوز 5 ميجابايت" }, { status: 400 });
  }

  const admin = getSupabaseAdmin() as any;
  const { data: existing, error: readError } = await admin.from("brand_settings")
    .select("logo_path").eq("id", true).maybeSingle();
  if (readError) return Response.json({ error: "تعذر قراءة إعدادات البراند" }, { status: 500 });

  let path: string | null = existing?.logo_path ?? null;
  if (file) {
    path = `brand-logo.${MIME_EXT[file.type]}`;
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type, upsert: true, cacheControl: "3600",
    });
    if (uploadError) return Response.json({ error: "تعذر رفع صورة البراند" }, { status: 500 });
  }

  const { error: updateError } = await admin.from("brand_settings").upsert({
    id: true, brand_name: brandName, logo_path: path, updated_by: user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (updateError) return Response.json({ error: "تعذر حفظ إعدادات البراند" }, { status: 500 });

  await audit(user.id, "brand.identity.update", "brand_settings", "true", { brandName, logoChanged: Boolean(file), logoSize: file?.size ?? null });
  let logoUrl: string | null = null;
  if (path) {
    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 3600);
    logoUrl = signed?.signedUrl ?? null;
  }
  return Response.json({ success: true, brandName, logoUrl });
}
