import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const MAX_DATA_URL_LENGTH = 1_500_000;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const admin = getSupabaseAdmin() as any;
  const { data, error } = await admin.from("brand_settings").select("brand_name,logo_data_url,updated_at").eq("id", true).maybeSingle();
  if (error) return Response.json({ error: "تعذر تحميل إعدادات العلامة التجارية" }, { status: 500 });
  return Response.json({ brandName: data?.brand_name?.trim() || "نظرة", logoDataUrl: data?.logo_data_url ?? null, updatedAt: data?.updated_at ?? null });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "إعدادات العلامة التجارية للمالك فقط" }, { status: 403 });
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const body = await request.json().catch(() => null) as { logoDataUrl?: unknown; remove?: unknown; brandName?: unknown } | null;
  if (!body) return Response.json({ error: "البيانات غير صالحة" }, { status: 400 });
  const hasBrandName = body.brandName !== undefined;
  const brandName = typeof body.brandName === "string" ? body.brandName.trim() : "";
  if (hasBrandName && (brandName.length < 2 || brandName.length > 80)) return Response.json({ error: "اسم البراند يجب أن يكون من حرفين إلى 80 حرفًا" }, { status: 400 });
  const hasLogoChange = body.remove === true || body.logoDataUrl !== undefined;
  if (hasLogoChange && body.remove !== true && (typeof body.logoDataUrl !== "string" || body.logoDataUrl.length > MAX_DATA_URL_LENGTH || !DATA_URL_PATTERN.test(body.logoDataUrl))) return Response.json({ error: "ارفع صورة PNG أو JPG أو WebP بحجم لا يتجاوز 1 ميجابايت" }, { status: 400 });
  if (!hasBrandName && !hasLogoChange) return Response.json({ error: "لا توجد تغييرات لحفظها" }, { status: 400 });

  const values: Record<string, unknown> = { id: true, updated_at: new Date().toISOString(), updated_by: user.id };
  if (hasBrandName) values.brand_name = brandName;
  if (hasLogoChange) values.logo_data_url = body.remove === true ? null : body.logoDataUrl;
  const admin = getSupabaseAdmin() as any;
  const { error } = await admin.from("brand_settings").upsert(values, { onConflict: "id" });
  if (error) return Response.json({ error: "تعذر حفظ إعدادات البراند. تأكد من تطبيق تحديث قاعدة البيانات." }, { status: 500 });
  await audit(user.id, hasBrandName && !hasLogoChange ? "brand.name_update" : body.remove === true ? "brand.logo_remove" : "brand.settings_update", "brand_settings", "true", { brandName: hasBrandName ? brandName : undefined });
  return Response.json({ success: true, ...(hasBrandName ? { brandName } : {}), ...(hasLogoChange ? { logoDataUrl: body.remove === true ? null : body.logoDataUrl } : {}) });
}
