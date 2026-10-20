import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requirePermission, requireSameOrigin } from "@/lib/auth";
import { audit } from "@/lib/audit";

const id = z.string().uuid();
const numberField = z.number().finite().min(-99).max(99).nullable().optional();
const prescriptionSchema = z.object({
  kind: z.literal("prescription"), customerId: id, branchId: id.nullable().optional(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), optometrist: z.string().trim().max(160).optional().default(""),
  rightSphere: numberField, rightCylinder: numberField, rightAxis: z.number().finite().min(0).max(180).nullable().optional(),
  rightAdd: numberField, leftSphere: numberField, leftCylinder: numberField,
  leftAxis: z.number().finite().min(0).max(180).nullable().optional(), leftAdd: numberField,
  pupilDistance: z.number().finite().min(0).max(100).nullable().optional(), notes: z.string().trim().max(2000).optional().default(""),
});
const serviceSchema = z.object({
  kind: z.literal("service"), customerId: id, branchId: id.nullable().optional(), saleInvoiceNumber: z.number().int().positive().nullable().optional(),
  serviceType: z.enum(["warranty","repair","maintenance","replacement"]), issue: z.string().trim().min(3).max(1000),
  warrantyUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expectedAt: z.string().datetime().nullable().optional(), notes: z.string().trim().max(2000).optional().default(""),
});
const reminderSchema = z.object({
  kind: z.literal("reminder"), customerId: id, branchId: id.nullable().optional(),
  reminderType: z.enum(["follow_up","annual_exam","ready_order","payment_followup","warranty_followup"]),
  dueAt: z.string().datetime(), message: z.string().trim().min(2).max(1000),
});
const updateSchema = z.discriminatedUnion("kind", [
  z.object({ action: z.literal("update_status"), recordId: id, kind: z.literal("service"), status: z.enum(["received","diagnosing","awaiting_parts","ready","delivered","cancelled"]) }),
  z.object({ action: z.literal("update_status"), recordId: id, kind: z.literal("reminder"), status: z.enum(["completed","cancelled"]) }),
]);

async function canAccessCustomer(admin: any, user: any, customerId: string) {
  if (user.roles.includes("super_admin")) return true;
  const { data: customer, error: customerError } = await admin.from("customers").select("id,created_by").eq("id", customerId).maybeSingle();
  if (customerError) throw customerError;
  if (!customer) return false;
  if (customer.created_by === user.id) return true;
  if (!user.branchIds?.length) return false;
  const { data, error } = await admin.from("sales").select("id").eq("customer_id", customerId).in("branch_id", user.branchIds).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}

async function validateBranch(admin: any, user: any, branchId?: string | null) {
  if (!branchId) return user.roles.includes("super_admin") ? null : (user.branchIds?.[0] ?? null);
  if (!user.roles.includes("super_admin") && !user.branchIds?.includes(branchId)) return false;
  const { data, error } = await admin.from("branches").select("id").eq("id", branchId).maybeSingle();
  if (error) throw error;
  return data ? branchId : false;
}

export async function GET(request: Request) {
  const { user, response } = await requirePermission("customers.manage");
  if (response) return response;
  const customerId = new URL(request.url).searchParams.get("customerId") ?? "";
  if (!id.safeParse(customerId).success) return Response.json({ error: "حدد عميلًا صحيحًا" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  if (!(await canAccessCustomer(admin, user!, customerId))) return Response.json({ error: "ليس لديك وصول لملف هذا العميل" }, { status: 403 });
  const [prescriptions, services, reminders] = await Promise.all([
    admin.from("customer_prescriptions").select("*").eq("customer_id", customerId).order("exam_date", { ascending: false }).limit(100),
    admin.from("sale_service_records").select("*,sales(invoice_number)").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(100),
    admin.from("customer_reminders").select("*").eq("customer_id", customerId).order("due_at", { ascending: true }).limit(100),
  ]);
  if (prescriptions.error || services.error || reminders.error) return Response.json({ error: "تعذر تحميل ملف العميل؛ تحقق من تطبيق تحديث قاعدة البيانات." }, { status: 500 });
  return Response.json({ prescriptions: prescriptions.data ?? [], services: services.data ?? [], reminders: reminders.data ?? [] });
}

export async function POST(request: Request) {
  const { user, response } = await requirePermission("customers.manage");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const parsed = prescriptionSchema.safeParse(body);
  const service = serviceSchema.safeParse(body);
  const reminder = reminderSchema.safeParse(body);
  const input = parsed.success ? parsed.data : service.success ? service.data : reminder.success ? reminder.data : null;
  if (!input) return Response.json({ error: "راجع بيانات الكشف أو الصيانة أو التذكير" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  if (!(await canAccessCustomer(admin, user!, input.customerId))) return Response.json({ error: "ليس لديك وصول لملف هذا العميل" }, { status: 403 });
  const branch = await validateBranch(admin, user!, input.branchId);
  if (branch === false) return Response.json({ error: "الفرع غير مسموح به لهذا الحساب" }, { status: 403 });

  let table: string;
  let values: Record<string, unknown>;
  if (input.kind === "prescription") {
    table = "customer_prescriptions";
    values = {
      customer_id: input.customerId, branch_id: branch, exam_date: input.examDate, optometrist: input.optometrist || null,
      right_sphere: input.rightSphere ?? null, right_cylinder: input.rightCylinder ?? null, right_axis: input.rightAxis ?? null, right_add: input.rightAdd ?? null,
      left_sphere: input.leftSphere ?? null, left_cylinder: input.leftCylinder ?? null, left_axis: input.leftAxis ?? null, left_add: input.leftAdd ?? null,
      pupil_distance: input.pupilDistance ?? null, notes: input.notes || null, created_by: user!.id,
    };
  } else if (input.kind === "service") {
    let linkedSale: { id: string; customer_id: string; branch_id: string } | null = null;
    if (input.saleInvoiceNumber) {
      const { data: sale, error } = await admin.from("sales").select("id,customer_id,branch_id").eq("invoice_number", input.saleInvoiceNumber).eq("customer_id", input.customerId).maybeSingle();
      if (error) throw error;
      if (!sale) return Response.json({ error: "رقم الفاتورة غير موجود لهذا العميل" }, { status: 400 });
      linkedSale = sale;
      if (!user!.roles.includes("super_admin") && !user!.branchIds.includes(sale.branch_id)) return Response.json({ error: "ليس لديك وصول للفرع المرتبط بالفاتورة" }, { status: 403 });
    }
    table = "sale_service_records";
    values = {
      customer_id: input.customerId, sale_id: linkedSale?.id ?? null, branch_id: linkedSale?.branch_id ?? branch, service_type: input.serviceType, issue: input.issue,
      warranty_until: input.warrantyUntil ?? null, expected_at: input.expectedAt ?? null, notes: input.notes || null, created_by: user!.id,
    };
  } else {
    table = "customer_reminders";
    values = {
      customer_id: input.customerId, sale_id: null, branch_id: branch, reminder_type: input.reminderType,
      due_at: input.dueAt, message: input.message, created_by: user!.id,
    };
  }
  const { data, error } = await admin.from(table).insert(values).select("*").single();
  if (error) throw error;
  await audit(user!.id, `customer_care.${input.kind}.create`, table, data.id, { customerId: input.customerId, branchId: branch });
  return Response.json({ record: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { user, response } = await requirePermission("customers.manage");
  if (response) return response;
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "بيانات تحديث الحالة غير صالحة" }, { status: 400 });
  const admin = getSupabaseAdmin() as any;
  const table = parsed.data.kind === "service" ? "sale_service_records" : "customer_reminders";
  const { data: record, error: lookupError } = await admin.from(table).select("id,customer_id,branch_id,status").eq("id", parsed.data.recordId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!record) return Response.json({ error: "السجل غير موجود" }, { status: 404 });
  if (!(await canAccessCustomer(admin, user!, record.customer_id))) return Response.json({ error: "ليس لديك وصول لهذا السجل" }, { status: 403 });
  if (!user!.roles.includes("super_admin") && record.branch_id && !user!.branchIds.includes(record.branch_id)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const nextStatus = parsed.data.status;
  const values = parsed.data.kind === "service"
    ? { status: nextStatus, updated_at: new Date().toISOString(), completed_at: nextStatus === "delivered" ? new Date().toISOString() : null }
    : { status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null };
  const { data, error } = await admin.from(table).update(values).eq("id", record.id).select("*").single();
  if (error) throw error;
  await audit(user!.id, `customer_care.${parsed.data.kind}.status`, table, record.id, { from: record.status, to: nextStatus });
  return Response.json({ record: data });
}
