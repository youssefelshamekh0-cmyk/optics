import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const typeRow = z.object({
  name: z.string().trim().min(2).max(120),
  costPrice: z.number().finite().min(0).max(10_000_000),
  referencePrice: z.number().finite().min(0).max(10_000_000),
});
// One company, one measurement range/options, several lens types — each type with its own price.
const schema = z.object({
  branchId: z.string().uuid(), company: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80).default("طبي"),
  sphereMin: z.number().finite().min(-30).max(30), sphereMax: z.number().finite().min(-30).max(30),
  cylinderMin: z.union([z.number().finite().min(-20).max(20), z.null()]).default(null),
  cylinderMax: z.union([z.number().finite().min(-20).max(20), z.null()]).default(null),
  options: z.string().trim().max(300).default(""),
  types: z.array(typeRow).min(1).max(30),
}).refine((v) => v.sphereMin <= v.sphereMax, { message: "نطاق SPH غير صحيح" })
  .refine((v) => (v.cylinderMin === null && v.cylinderMax === null) || (v.cylinderMin !== null && v.cylinderMax !== null && v.cylinderMin <= v.cylinderMax), { message: "نطاق CYL غير صحيح" })
  .refine((v) => new Set(v.types.map((t) => t.name.toLowerCase())).size === v.types.length, { message: "نوع العدسة مكرر" });

async function ownerOnly() {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 }) };
  if (!user.roles.includes("super_admin")) return { user, response: Response.json({ error: "هذه الشاشة متاحة لمالك البراند" }, { status: 403 }) };
  return { user, response: null };
}

export async function GET(request: Request) {
  const { response } = await ownerOnly();
  if (response) return response;
  const branchId = new URL(request.url).searchParams.get("branchId");
  const admin = getSupabaseAdmin();
  const [companies, types, prices] = await Promise.all([
    admin.from("lens_companies").select("id,name").eq("active", true).order("name"),
    admin.from("lens_types").select("id,company_id,name,category").eq("active", true).order("name"),
    branchId ? admin.from("branch_lens_prices").select("id,branch_id,lens_type_id,sphere_min,sphere_max,cylinder_min,cylinder_max,options,cost_price,reference_price,active").eq("branch_id", branchId).eq("active", true).order("sphere_min") : Promise.resolve({ data: [], error: null }),
  ]);
  if (companies.error || types.error || prices.error) throw companies.error ?? types.error ?? prices.error;
  const companyById = new Map((companies.data ?? []).map((row) => [row.id, row.name]));
  const typeById = new Map((types.data ?? []).map((row) => [row.id, { ...row, company: companyById.get(row.company_id) ?? "" }]));
  return Response.json({ companies: companies.data ?? [], types: [...typeById.values()], prices: (prices.data ?? []).map((row) => ({ ...row, lens: typeById.get(row.lens_type_id) ?? null })) });
}

export async function POST(request: Request) {
  const { user, response } = await ownerOnly();
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات الشركة والأنواع ونطاق المقاس والأسعار" }, { status: 400 });
  const input = parsed.data;
  const admin = getSupabaseAdmin();
  const { data: company, error: companyError } = await admin.from("lens_companies").upsert({ name: input.company }, { onConflict: "name" }).select("id").single();
  if (companyError) throw companyError;
  const { data: lensTypes, error: typeError } = await admin.from("lens_types")
    .upsert(input.types.map((t) => ({ company_id: company.id, name: t.name, category: input.category })), { onConflict: "company_id,name" })
    .select("id,name");
  if (typeError) throw typeError;
  const typeIdByName = new Map((lensTypes ?? []).map((row) => [row.name.toLowerCase(), row.id]));
  const rows = input.types.map((t) => ({
    branch_id: input.branchId, lens_type_id: typeIdByName.get(t.name.toLowerCase())!, sphere_min: input.sphereMin, sphere_max: input.sphereMax,
    cylinder_min: input.cylinderMin, cylinder_max: input.cylinderMax, options: input.options,
    cost_price: t.costPrice, reference_price: t.referencePrice,
  }));
  if (rows.some((row) => !row.lens_type_id)) throw new Error("تعذر ربط أنواع العدسات");
  // A single INSERT statement is atomic: if any type overlaps an existing range, none of them is saved.
  const { data, error } = await admin.from("branch_lens_prices").insert(rows).select("id");
  if (error?.code === "P0001") return Response.json({ error: "أحد الأنواع يتعارض نطاقه مع سعر مسجل لنفس الشركة والنوع" }, { status: 409 });
  if (error) throw error;
  await audit(user!.id, "lens_price.create", "lens_price", data?.[0]?.id, { branchId: input.branchId, company: input.company, types: input.types.length });
  return Response.json({ created: data?.length ?? 0 }, { status: 201 });
}
