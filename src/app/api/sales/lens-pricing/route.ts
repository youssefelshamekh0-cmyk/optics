import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/auth";

const querySchema = z.object({
  branchId: z.string().uuid(),
  lensTypeId: z.string().uuid().optional(),
  rightSphere: z.coerce.number().finite().min(-30).max(30).optional(),
  rightCylinder: z.coerce.number().finite().min(-20).max(20).optional(),
  leftSphere: z.coerce.number().finite().min(-30).max(30).optional(),
  leftCylinder: z.coerce.number().finite().min(-20).max(20).optional(),
  options: z.string().trim().max(300).default(""),
});

export async function GET(request: Request) {
  const { user, response } = await requirePermission("sales.create");
  if (response) return response;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "بيانات الفرع أو قياسات العدسات غير صحيحة" }, { status: 400 });
  const input = parsed.data;
  if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(input.branchId)) {
    return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data: priceRows, error: priceError } = await admin.from("branch_lens_prices")
    .select("id,lens_type_id,sphere_min,sphere_max,cylinder_min,cylinder_max,options,reference_price")
    .eq("branch_id", input.branchId).eq("active", true).order("sphere_min");
  if (priceError) throw priceError;
  const prices = priceRows ?? [];
  const typeIds = [...new Set(prices.map((row) => row.lens_type_id))];
  const { data: types, error: typeError } = typeIds.length
    ? await admin.from("lens_types").select("id,name,company_id,category").in("id", typeIds).eq("active", true).order("name")
    : { data: [], error: null };
  if (typeError) throw typeError;
  const companyIds = [...new Set((types ?? []).map((row) => row.company_id))];
  const { data: companies, error: companyError } = companyIds.length
    ? await admin.from("lens_companies").select("id,name").in("id", companyIds).eq("active", true).order("name")
    : { data: [], error: null };
  if (companyError) throw companyError;
  const companyById = new Map((companies ?? []).map((company) => [company.id, company.name]));
  const availableTypes = (types ?? []).filter((type) => companyById.has(type.company_id)).map((type) => ({ ...type, company: companyById.get(type.company_id)! }));

  if (!input.lensTypeId) {
    const optionsByType = Object.fromEntries(availableTypes.map((type) => [type.id, [...new Set(prices.filter((row) => row.lens_type_id === type.id).map((row) => row.options).filter(Boolean))]]));
    return Response.json({ lensTypes: availableTypes, optionsByType });
  }
  if ([input.rightSphere, input.rightCylinder, input.leftSphere, input.leftCylinder].some((value) => value === undefined)) {
    return Response.json({ error: "أدخل قياسات العينين لحساب سعر العدسات" }, { status: 400 });
  }
  if (!availableTypes.some((type) => type.id === input.lensTypeId)) {
    return Response.json({ error: "نوع العدسة غير متاح لهذا الفرع" }, { status: 404 });
  }

  const lookup = (sphere: number, cylinder: number) => prices.filter((row) =>
    row.lens_type_id === input.lensTypeId && row.options === input.options &&
    Number(row.sphere_min) <= sphere && Number(row.sphere_max) >= sphere &&
    (row.cylinder_min === null || (Number(row.cylinder_min) <= cylinder && Number(row.cylinder_max) >= cylinder))
  );
  const rightMatches = lookup(input.rightSphere!, input.rightCylinder!);
  const leftMatches = lookup(input.leftSphere!, input.leftCylinder!);
  if (rightMatches.length !== 1 || leftMatches.length !== 1) {
    const sideError = (matches: typeof prices) => matches.length === 0 ? "لا يوجد نطاق سعر" : "توجد نطاقات أسعار متعارضة";
    return Response.json({
      error: `تعذر تسعير العدسات: العين اليمنى ${sideError(rightMatches)}، والعين اليسرى ${sideError(leftMatches)}. راجع قائمة الأسعار أو القياسات.`,
      code: "lens_price_unresolved",
      rightMatches: rightMatches.length,
      leftMatches: leftMatches.length,
    }, { status: 409 });
  }
  const type = availableTypes.find((row) => row.id === input.lensTypeId)!;
  return Response.json({
    lensTypes: availableTypes,
    options: [...new Set(prices.filter((row) => row.lens_type_id === input.lensTypeId).map((row) => row.options).filter(Boolean))],
    quote: {
      lensTypeId: type.id,
      lensTypeName: type.name,
      company: type.company,
      right: { priceId: rightMatches[0].id, referencePrice: Number(rightMatches[0].reference_price) },
      left: { priceId: leftMatches[0].id, referencePrice: Number(leftMatches[0].reference_price) },
      pairReferencePrice: Number(rightMatches[0].reference_price) + Number(leftMatches[0].reference_price),
    },
  });
}
