import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const TZ = "Africa/Cairo";
const DAY = 86400000;

function offsetMs(ms: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
/** UTC instant of 00:00 Cairo time on the given calendar day. */
function cairoMidnight(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMs(guess - 3 * 3600000);
  return new Date(guess - offsetMs(first));
}
const todayCairo = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const addDays = (dateStr: string, n: number) => new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
async function fetchAll(query: any) { const rows: any[] = []; for (let from = 0; from < 200000; from += 1000) { const { data, error } = await query.range(from, from + 999); if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 1000) break; } return rows; }

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const isOwner = user.roles.includes("super_admin");
  // The daily overview (invoices, collections and shift hours across the day) is for the brand owner only.
  if (!isOwner) return Response.json({ error: "هذه الشاشة متاحة لمالك البراند" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const today = todayCairo();
  const dateParam = params.get("date");
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !Number.isNaN(Date.parse(dateParam)) ? dateParam : today;
  const from = cairoMidnight(date).toISOString(), to = cairoMidnight(addDays(date, 1)).toISOString();
  // Staff hours and pay run weekly (Saturday to Friday), so the report covers the week that contains the selected day.
  const weekStartDate = addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7));
  const weekFrom = cairoMidnight(weekStartDate).toISOString(), weekTo = cairoMidnight(addDays(weekStartDate, 7)).toISOString();
  const admin = getSupabaseAdmin() as any;

  const branchQuery = admin.from("branches").select("id,name,code,status").eq("status", "active").order("name");
  if (!isOwner) branchQuery.in("id", user.branchIds.length ? user.branchIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data: branches, error: branchError } = await branchQuery;
  if (branchError) throw branchError;
  const allowed = (branches ?? []).map((b: any) => b.id);
  const requested = params.get("branchId");
  if (requested && requested !== "all" && !allowed.includes(requested)) return Response.json({ error: "ليس لديك وصول لهذا الفرع" }, { status: 403 });
  const branchIds: string[] = requested && requested !== "all" ? [requested] : allowed;
  if (!branchIds.length) return Response.json({ role: isOwner ? "owner" : "seller", date, today, branches: branches ?? [], branchId: requested ?? "all", summary: { invoices: 0, sales: 0, collected: 0, due: 0, expenses: 0, cashIn: 0, cashOut: 0 }, invoices: [], accounts: [], expenses: [], shifts: [], weekHours: [], weekStart: weekStartDate });

  // Invoices of the day (sellers only see their own).
  let salesQuery = admin.from("sales").select("id,invoice_number,branch_id,customer_id,created_by,grand_total,delivery_status,created_at").in("branch_id", branchIds).gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(500);
  if (!isOwner) salesQuery = salesQuery.eq("created_by", user.id);
  const { data: salesRows, error: salesError } = await salesQuery;
  if (salesError) throw salesError;
  const sales = salesRows ?? [];
  const saleIds = sales.map((s: any) => s.id);
  const customerIds = [...new Set(sales.map((s: any) => s.customer_id))] as string[];
  const sellerIds = [...new Set(sales.map((s: any) => s.created_by).filter(Boolean))] as string[];
  const [payments, customers, sellers] = await Promise.all([
    saleIds.length ? fetchAll(admin.from("sale_payments").select("sale_id,amount").in("sale_id", saleIds)) : [],
    customerIds.length ? admin.from("customers").select("id,full_name,phone").in("id", customerIds) : { data: [], error: null },
    sellerIds.length ? admin.from("user_profiles").select("id,full_name").in("id", sellerIds) : { data: [], error: null },
  ]);
  if (customers.error || sellers.error) throw customers.error ?? sellers.error;
  const paidBySale = new Map<string, number>();
  for (const p of payments) paidBySale.set(p.sale_id, (paidBySale.get(p.sale_id) ?? 0) + Number(p.amount));
  const customerMap = new Map((customers.data ?? []).map((c: any) => [c.id, c]));
  const sellerMap = new Map((sellers.data ?? []).map((s: any) => [s.id, s.full_name]));
  const branchMap = new Map((branches ?? []).map((b: any) => [b.id, b.name]));
  const invoices = sales.map((s: any) => {
    const paid = paidBySale.get(s.id) ?? 0; const total = Number(s.grand_total);
    return { id: s.id, invoice_number: s.invoice_number, branch: branchMap.get(s.branch_id) ?? "", customer: (customerMap.get(s.customer_id) as any)?.full_name ?? "—", phone: (customerMap.get(s.customer_id) as any)?.phone ?? "", seller: sellerMap.get(s.created_by) ?? "—", total, paid, due: Math.max(0, total - paid), status: s.delivery_status, created_at: s.created_at };
  });
  const live = invoices.filter((i: any) => i.status !== "cancelled");

  // Shifts of the day (+ still-open ones when looking at today) and the week's hours.
  let dayShifts = admin.from("seller_shifts").select("id,user_id,branch_id,opening_cash,closing_cash,expected_cash,variance,status,opened_at,closed_at,user_profiles(full_name),branches(name)").in("branch_id", branchIds).gte("opened_at", from).lt("opened_at", to).order("opened_at", { ascending: false });
  let openShifts = date === today ? admin.from("seller_shifts").select("id,user_id,branch_id,opening_cash,closing_cash,expected_cash,variance,status,opened_at,closed_at,user_profiles(full_name),branches(name)").in("branch_id", branchIds).eq("status", "open") : null;
  if (!isOwner) { dayShifts = dayShifts.eq("user_id", user.id); if (openShifts) openShifts = openShifts.eq("user_id", user.id); }
  const [dayRes, openRes] = await Promise.all([dayShifts, openShifts ?? Promise.resolve({ data: [], error: null })]);
  if (dayRes.error || openRes.error) throw dayRes.error ?? openRes.error;
  const shiftMap = new Map<string, any>();
  for (const s of [...(openRes.data ?? []), ...(dayRes.data ?? [])]) shiftMap.set(s.id, s);
  const shifts = [...shiftMap.values()].sort((a, b) => b.opened_at.localeCompare(a.opened_at)).map((s: any) => ({ id: s.id, user: s.user_profiles?.full_name ?? "—", branch: s.branches?.name ?? "", opened_at: s.opened_at, closed_at: s.closed_at, status: s.status, opening_cash: Number(s.opening_cash), closing_cash: s.closing_cash == null ? null : Number(s.closing_cash), variance: isOwner && s.variance != null ? Number(s.variance) : null }));

  let weekHours: { user_id: string; name: string; seconds: number; shifts: number }[] = [];
  if (isOwner) {
    const rows = await fetchAll(admin.from("seller_shifts").select("user_id,opened_at,closed_at,user_profiles(full_name)").in("branch_id", branchIds).gte("opened_at", weekFrom).lt("opened_at", weekTo));
    const acc = new Map<string, { user_id: string; name: string; seconds: number; shifts: number }>();
    for (const r of rows) { const end = r.closed_at ? Date.parse(r.closed_at) : Date.now(); const cur = acc.get(r.user_id) ?? { user_id: r.user_id, name: r.user_profiles?.full_name ?? "—", seconds: 0, shifts: 0 }; cur.seconds += Math.max(0, (end - Date.parse(r.opened_at)) / 1000); cur.shifts += 1; acc.set(r.user_id, cur); }
    weekHours = [...acc.values()].sort((a, b) => b.seconds - a.seconds).map((x) => ({ ...x, seconds: Math.round(x.seconds) }));
  }

  let accounts: any[] = [], expenses: any[] = [], cashIn = 0, cashOut = 0, collected = 0, expensesTotal = 0;
  if (isOwner) {
    const accountRows = await fetchAll(admin.from("cash_accounts").select("id,branch_id,name,payment_method,opening_balance").in("branch_id", branchIds).eq("active", true).order("name"));
    const tx = accountRows.length ? await fetchAll(admin.from("cash_transactions").select("cash_account_id,direction,amount,transaction_type,description,created_at").in("cash_account_id", accountRows.map((a: any) => a.id))) : [];
    accounts = accountRows.map((a: any) => {
      const mine = tx.filter((t: any) => t.cash_account_id === a.id && t.description !== "رصيد افتتاحي");
      const inDay = mine.filter((t: any) => t.created_at >= from && t.created_at < to);
      const sum = (rows: any[], dir: string) => rows.filter((t) => t.direction === dir).reduce((s, t) => s + Number(t.amount), 0);
      const dayIn = sum(inDay, "in"), dayOut = sum(inDay, "out");
      cashIn += dayIn; cashOut += dayOut; collected += inDay.filter((t: any) => t.transaction_type === "sale_payment" && t.direction === "in").reduce((s: number, t: any) => s + Number(t.amount), 0);
      return { id: a.id, name: a.name, branch: branchMap.get(a.branch_id) ?? "", payment_method: a.payment_method, balance: Number(a.opening_balance) + sum(mine, "in") - sum(mine, "out"), in_today: dayIn, out_today: dayOut };
    });
    const { data: exp, error: expError } = await admin.from("expenses").select("id,branch_id,description,category,amount").in("branch_id", branchIds).eq("expense_date", date).eq("status", "paid").order("created_at", { ascending: false });
    if (expError) throw expError;
    expenses = (exp ?? []).map((x: any) => ({ id: x.id, branch: branchMap.get(x.branch_id) ?? "", description: x.description, category: x.category, amount: Number(x.amount) }));
    expensesTotal = expenses.reduce((s, x) => s + x.amount, 0);
  } else {
    // A seller only sees what they collected themselves, from payments tied to their own invoices.
    collected = live.reduce((s: number, i: any) => s + i.paid, 0);
  }

  return Response.json({
    role: isOwner ? "owner" : "seller", date, today, branches: branches ?? [], branchId: requested ?? "all",
    summary: { invoices: live.length, sales: live.reduce((s: number, i: any) => s + i.total, 0), collected, due: live.reduce((s: number, i: any) => s + i.due, 0), expenses: expensesTotal, cashIn, cashOut },
    invoices, accounts, expenses, shifts, weekHours, weekStart: weekStartDate,
  });
}
