import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser, requireSameOrigin } from "@/lib/auth";

const schema = z.object({
  supplierId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  type: z.enum(["opening_debt", "payment", "adjustment"]),
  amount: z.number().positive().max(100000000),
  cashAccountId: z.string().uuid().nullable().optional(),
  date: z.string().date().optional(),
  description: z.string().trim().max(500).optional().default(""),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin") && !user.permissions.includes("purchases.manage")) return Response.json({ error: "ليست لديك صلاحية إدارة الموردين" }, { status: 403 });
  const admin = getSupabaseAdmin() as any;
  const [suppliers, entries, accounts, branches] = await Promise.all([
    admin.from("suppliers").select("id,name,phone").order("name"),
    admin.from("supplier_ledger_entries").select("id,supplier_id,branch_id,entry_type,source_type,amount,direction,cash_account_id,purchase_id,lens_supply_id,entry_date,description,created_at,suppliers(name),branches(name),cash_accounts(name)").order("entry_date", { ascending: false }).limit(1000),
    admin.from("cash_accounts").select("id,name,branch_id,is_central,active,branches(name)").eq("active", true).order("name"),
    admin.from("branches").select("id,name,code,status").order("name"),
  ]);
  if (suppliers.error || entries.error || accounts.error || branches.error) throw suppliers.error ?? entries.error ?? accounts.error ?? branches.error;
  const allowedBranches = user.roles.includes("super_admin") ? null : user.branchIds;
  const filteredEntries = (entries.data ?? []).filter((row: any) => !allowedBranches || (row.branch_id && allowedBranches.includes(row.branch_id)));
  const balances = new Map<string, number>();
  for (const row of filteredEntries) balances.set(row.supplier_id, (balances.get(row.supplier_id) ?? 0) + (row.direction === "debit" ? Number(row.amount) : -Number(row.amount)));
  return Response.json({
    suppliers: (suppliers.data ?? []).map((s: any) => ({ ...s, balance: Math.round((balances.get(s.id) ?? 0) * 100) / 100 })),
    entries: filteredEntries,
    accounts: (accounts.data ?? []).filter((a: any) => user.roles.includes("super_admin") ? true : (!a.is_central && a.branch_id && allowedBranches!.includes(a.branch_id))),
    branches: (branches.data ?? []).filter((b: any) => !allowedBranches || allowedBranches.includes(b.id)),
  });
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return Response.json({ error: "الطلب غير صالح" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin") && !user.permissions.includes("purchases.manage")) return Response.json({ error: "ليست لديك صلاحية إدارة الموردين" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "راجع بيانات المديونية" }, { status: 400 });
  const input = parsed.data;
  if (input.type === "payment" && !input.cashAccountId) return Response.json({ error: "اختر خزنة أو وسيلة الدفع" }, { status: 400 });
  if (input.branchId && !user.roles.includes("super_admin") && !user.branchIds.includes(input.branchId)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const admin = getSupabaseAdmin() as any;
  const supplier = await admin.from("suppliers").select("id").eq("id", input.supplierId).maybeSingle();
  if (supplier.error) throw supplier.error;
  if (!supplier.data) return Response.json({ error: "المورد غير موجود" }, { status: 404 });
  if (input.cashAccountId) {
    const account = await admin.from("cash_accounts").select("id,branch_id,is_central,active").eq("id", input.cashAccountId).maybeSingle();
    if (account.error) throw account.error;
    if (!account.data?.active) return Response.json({ error: "خزنة الدفع غير نشطة" }, { status: 400 });
    if (account.data.is_central && !user.roles.includes("super_admin")) return Response.json({ error: "الخزنة المركزية للمالك فقط" }, { status: 403 });
    if (!account.data.is_central && (!input.branchId || account.data.branch_id !== input.branchId)) return Response.json({ error: "خزنة الدفع لا تتبع الفرع المحدد" }, { status: 400 });
  }
  const { data, error } = await admin.from("supplier_ledger_entries").insert({
    supplier_id: input.supplierId, branch_id: input.branchId ?? null, entry_type: input.type, source_type: "manual",
    amount: input.amount, direction: input.type === "payment" ? "credit" : "debit",
    cash_account_id: input.type === "payment" ? input.cashAccountId ?? null : null,
    entry_date: input.date ?? new Date().toISOString().slice(0, 10),
    description: input.description || (input.type === "opening_debt" ? "رصيد مديونية افتتاحي" : input.type === "payment" ? "دفعة للمورد" : "تسوية مديونية"),
    created_by: user.id,
  }).select("id").single();
  if (error) throw error;
  if (input.type === "payment" && input.cashAccountId) {
    const cash = await admin.from("cash_transactions").insert({
      cash_account_id: input.cashAccountId, direction: "out", amount: input.amount,
      transaction_type: "supplier_payment", reference_id: data.id, description: input.description || "سداد مديونية مورد", created_by: user.id,
    });
    if (cash.error) {
      await admin.from("supplier_ledger_entries").delete().eq("id", data.id);
      throw cash.error;
    }
  }
  return Response.json({ success: true, id: data.id }, { status: 201 });
}
