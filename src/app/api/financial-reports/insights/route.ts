import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  if (!user.roles.includes("super_admin")) return Response.json({ error: "تقارير الربحية والمديونيات متاحة لمالك البراند فقط" }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const branchId = params.get("branchId") ?? "";
  if (!datePattern.test(from) || !datePattern.test(to) || from > to) {
    return Response.json({ error: "حدد فترة صحيحة للتقرير" }, { status: 400 });
  }

  const start = new Date(from + "T00:00:00.000Z").toISOString();
  const end = new Date(new Date(to + "T00:00:00.000Z").getTime() + 86400000).toISOString();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const admin = getSupabaseAdmin() as any;

  const allSalesQuery = admin.from("sales")
    .select("id,invoice_number,branch_id,customer_id,created_by,grand_total,created_at,branches(name),customers(full_name,phone)")
    .neq("delivery_status", "cancelled").lt("created_at", end).order("created_at", { ascending: false }).limit(10000);
  const periodSalesQuery = admin.from("sales")
    .select("id,invoice_number,branch_id,created_by,grand_total,created_at,branches(name)")
    .neq("delivery_status", "cancelled").gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(10000);
  const returnQuery = admin.from("sale_returns")
    .select("id,sale_id,branch_id,refund_amount,created_at")
    .gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false }).limit(10000);
  let stockQuery = admin.from("branch_products")
    .select("branch_id,product_id,quantity,cost_price,reference_price,products(name,sku,category)")
    .order("quantity", { ascending: true }).limit(10000);
  let recentItemsQuery = admin.from("sale_items")
    .select("id,sale_id,product_id,item_name,quantity,unit_price,line_total,unit_cost,unit_cost_is_estimated,sales!inner(branch_id,created_at,delivery_status)")
    .gte("sales.created_at", ninetyDaysAgo).neq("sales.delivery_status", "cancelled").limit(30000);
  if (branchId) {
    allSalesQuery.eq("branch_id", branchId);
    periodSalesQuery.eq("branch_id", branchId);
    returnQuery.eq("branch_id", branchId);
    stockQuery = stockQuery.eq("branch_id", branchId);
    recentItemsQuery = recentItemsQuery.eq("sales.branch_id", branchId);
  } else if (!user.roles.includes("super_admin")) {
    return Response.json({ error: "غير مصرح" }, { status: 403 });
  }

  const [allSalesR, periodSalesR, returnsR, stockR, recentItemsR] = await Promise.all([
    allSalesQuery, periodSalesQuery, returnQuery, stockQuery, recentItemsQuery,
  ]);
  for (const result of [allSalesR, periodSalesR, returnsR, stockR, recentItemsR]) {
    if (result.error) return Response.json({ error: "تعذر تحميل بيانات التحليل. تأكد من تطبيق تحديثات قاعدة البيانات على بيئة الاختبار." }, { status: 500 });
  }
  const allSales = allSalesR.data ?? [];
  const periodSales = periodSalesR.data ?? [];
  const saleById = new Map<string, any>(allSales.map((sale: any) => [sale.id, sale] as [string, any]));
  const saleIds = allSales.map((sale: any) => sale.id);
  const periodSaleIds = periodSales.map((sale: any) => sale.id);

  const [paymentsR, periodItemsR, returnedItemsR, branchesR, profilesR] = await Promise.all([
    saleIds.length
      ? admin.from("sale_payments").select("sale_id,amount,created_at").in("sale_id", saleIds).limit(50000)
      : { data: [], error: null },
    periodSaleIds.length
      ? admin.from("sale_items").select("id,sale_id,product_id,item_name,quantity,unit_price,line_total,unit_cost,unit_cost_is_estimated").in("sale_id", periodSaleIds).limit(30000)
      : { data: [], error: null },
    (returnsR.data ?? []).length
      ? admin.from("sale_return_items").select("id,return_id,sale_item_id,quantity,unit_refund").in("return_id", (returnsR.data ?? []).map((row: any) => row.id)).limit(30000)
      : { data: [], error: null },
    admin.from("branches").select("id,name,code,status").order("name"),
    admin.from("user_profiles").select("id,full_name").eq("status", "active"),
  ]);
  for (const result of [paymentsR, periodItemsR, returnedItemsR, branchesR, profilesR]) {
    if (result.error) return Response.json({ error: "تعذر تحميل تفاصيل التحصيلات والربحية" }, { status: 500 });
  }
  const payments = paymentsR.data ?? [];
  const paymentsBySale = new Map<string, number>();
  for (const payment of payments) paymentsBySale.set(payment.sale_id, (paymentsBySale.get(payment.sale_id) ?? 0) + Number(payment.amount));

  const currentDay = new Date();
  currentDay.setUTCHours(0, 0, 0, 0);
  const aging = { current: [] as any[], days1to30: [] as any[], days31to60: [] as any[], days61to90: [] as any[], over90: [] as any[] };
  for (const sale of allSales as any[]) {
    if (branchId && sale.branch_id !== branchId) continue;
    const paid = paymentsBySale.get(sale.id) ?? 0;
    const due = roundMoney(Number(sale.grand_total) - paid);
    if (due <= 0.009) continue;
    const ageDays = Math.max(0, Math.floor((currentDay.getTime() - new Date(sale.created_at).getTime()) / 86400000));
    const row = {
      saleId: sale.id, invoiceNumber: sale.invoice_number, branchId: sale.branch_id,
      branchName: sale.branches?.name ?? "—", customerName: sale.customers?.full_name ?? "عميل",
      customerPhone: sale.customers?.phone ?? "", createdAt: sale.created_at,
      ageDays, grandTotal: Number(sale.grand_total), paid: roundMoney(paid), due,
    };
    if (ageDays === 0) aging.current.push(row);
    else if (ageDays <= 30) aging.days1to30.push(row);
    else if (ageDays <= 60) aging.days31to60.push(row);
    else if (ageDays <= 90) aging.days61to90.push(row);
    else aging.over90.push(row);
  }

  const branches = new Map<string, string>((branchesR.data ?? []).map((b: any) => [b.id, b.name] as [string, string]));
  const profiles = new Map<string, string>((profilesR.data ?? []).map((p: any) => [p.id, p.full_name] as [string, string]));
  const revenueByBranch = new Map<string, number>();
  const performance = new Map<string, { userId: string; userName: string; invoiceCount: number; invoiced: number; collected: number; returned: number }>();
  for (const sale of periodSales as any[]) {
    if (branchId && sale.branch_id !== branchId) continue;
    revenueByBranch.set(sale.branch_id, (revenueByBranch.get(sale.branch_id) ?? 0) + Number(sale.grand_total));
    const actor = sale.created_by ?? "unassigned";
    const row = performance.get(actor) ?? {
      userId: actor, userName: profiles.get(actor) ?? "غير منسوب لمستخدم",
      invoiceCount: 0, invoiced: 0, collected: 0, returned: 0,
    };
    row.invoiceCount += 1;
    row.invoiced += Number(sale.grand_total);
    performance.set(actor, row);
  }
  for (const payment of payments as any[]) {
    const sale = saleById.get(payment.sale_id) as any;
    if (!sale || new Date(payment.created_at) < new Date(start) || new Date(payment.created_at) >= new Date(end)) continue;
    if (branchId && sale.branch_id !== branchId) continue;
    const actor = sale.created_by ?? "unassigned";
    const row = performance.get(actor) ?? {
      userId: actor, userName: profiles.get(actor) ?? "غير منسوب لمستخدم",
      invoiceCount: 0, invoiced: 0, collected: 0, returned: 0,
    };
    row.collected += Number(payment.amount);
    performance.set(actor, row);
  }

  const returnRows = returnsR.data ?? [];
  const returnSaleIds = [...new Set(returnRows.map((r: any) => r.sale_id))];
  const returnSalesR = returnSaleIds.length
    ? await admin.from("sales").select("id,branch_id,created_by").in("id", returnSaleIds)
    : { data: [], error: null };
  if (returnSalesR.error) return Response.json({ error: "تعذر ربط المرتجعات بالفروع" }, { status: 500 });
  const returnSaleMap = new Map<string, any>((returnSalesR.data ?? []).map((s: any) => [s.id, s] as [string, any]));
  for (const ret of returnRows as any[]) {
    if (branchId && ret.branch_id !== branchId) continue;
    const sale = returnSaleMap.get(ret.sale_id) as any;
    if (sale) {
      const actor = sale.created_by ?? "unassigned";
      const row = performance.get(actor);
      if (row) row.returned += Number(ret.refund_amount);
    }
  }

  const periodItems = periodItemsR.data ?? [];
  const returnedItems = returnedItemsR.data ?? [];
  const returnedSaleItemIds = [...new Set(returnedItems.map((item: any) => item.sale_item_id))];
  const returnedSaleItemsR = returnedSaleItemIds.length
    ? await admin.from("sale_items").select("id,sale_id,product_id,item_name,quantity,unit_cost,unit_cost_is_estimated").in("id", returnedSaleItemIds)
    : { data: [], error: null };
  if (returnedSaleItemsR.error) return Response.json({ error: "تعذر تحميل تكلفة الأصناف المرتجعة" }, { status: 500 });
  const itemById = new Map<string, any>([
    ...periodItems.map((item: any) => [item.id, item] as [string, any]),
    ...(returnedSaleItemsR.data ?? []).map((item: any) => [item.id, item] as [string, any]),
  ]);
  const branchBySaleItem = new Map<string, string>();
  for (const item of [...periodItems, ...(returnedSaleItemsR.data ?? [])] as any[]) {
    const sale = saleById.get(item.sale_id) as any;
    if (sale) branchBySaleItem.set(item.id, sale.branch_id);
  }

  const marginMap = new Map<string, { branchId: string; branchName: string; productId: string; productName: string; soldQty: number; returnedQty: number; revenue: number; cost: number; estimatedCostLines: number }>();
  for (const item of periodItems as any[]) {
    const sale = saleById.get(item.sale_id) as any;
    if (!sale || (branchId && sale.branch_id !== branchId)) continue;
    const invoiceItems = periodItems.filter((candidate: any) => candidate.sale_id === item.sale_id);
    const referenceLineTotal = invoiceItems.reduce((sum: number, candidate: any) => sum + Number(candidate.line_total ?? Number(candidate.quantity) * Number(candidate.unit_price)), 0);
    const lineGross = Number(item.line_total ?? Number(item.quantity) * Number(item.unit_price));
    const revenue = referenceLineTotal > 0 ? lineGross * Number(sale.grand_total) / referenceLineTotal : 0;
    const key = sale.branch_id + ":" + (item.product_id ?? "service:" + item.item_name);
    const row = marginMap.get(key) ?? {
      branchId: sale.branch_id, branchName: branches.get(sale.branch_id) ?? "—",
      productId: item.product_id ?? "", productName: item.item_name, soldQty: 0, returnedQty: 0,
      revenue: 0, cost: 0, estimatedCostLines: 0,
    };
    row.soldQty += Number(item.quantity);
    row.revenue += revenue;
    row.cost += Number(item.unit_cost ?? 0) * Number(item.quantity);
    if (item.unit_cost_is_estimated) row.estimatedCostLines += 1;
    marginMap.set(key, row);
  }
  for (const returned of returnedItems as any[]) {
    const item = itemById.get(returned.sale_item_id);
    const sale = item ? saleById.get(item.sale_id) as any : null;
    const ret = returnRows.find((r: any) => r.id === returned.return_id) as any;
    if (!item || !ret || (branchId && ret.branch_id !== branchId)) continue;
    const key = ret.branch_id + ":" + (item.product_id ?? "service:" + item.item_name);
    const row = marginMap.get(key) ?? {
      branchId: ret.branch_id, branchName: branches.get(ret.branch_id) ?? "—",
      productId: item.product_id ?? "", productName: item.item_name, soldQty: 0, returnedQty: 0,
      revenue: 0, cost: 0, estimatedCostLines: 0,
    };
    row.returnedQty += Number(returned.quantity);
    row.revenue -= Number(returned.unit_refund) * Number(returned.quantity);
    row.cost -= Number(item.unit_cost ?? 0) * Number(returned.quantity);
    if (item.unit_cost_is_estimated) row.estimatedCostLines += 1;
    marginMap.set(key, row);
  }

  const marginRows = [...marginMap.values()].map(row => ({
    ...row, revenue: roundMoney(row.revenue), cost: roundMoney(row.cost),
    grossProfit: roundMoney(row.revenue - row.cost),
    marginPercent: row.revenue > 0 ? roundMoney((row.revenue - row.cost) / row.revenue * 100) : null,
  })).sort((a,b) => b.grossProfit-a.grossProfit);

  const recentItems = recentItemsR.data ?? [];
  const movementByProduct = new Map<string, { quantity90Days: number; lastSoldAt: string | null }>();
  for (const item of recentItems as any[]) {
    const key = item.sales.branch_id + ":" + (item.product_id ?? "");
    if (!item.product_id) continue;
    const row = movementByProduct.get(key) ?? { quantity90Days: 0, lastSoldAt: null };
    row.quantity90Days += Number(item.quantity);
    if (!row.lastSoldAt || new Date(item.sales.created_at) > new Date(row.lastSoldAt)) row.lastSoldAt = item.sales.created_at;
    movementByProduct.set(key, row);
  }
  const slowMoving = (stockR.data ?? []).map((stock: any) => {
    const activity = movementByProduct.get(stock.branch_id + ":" + stock.product_id) ?? { quantity90Days: 0, lastSoldAt: null };
    return {
      branchId: stock.branch_id, branchName: branches.get(stock.branch_id) ?? "—",
      productId: stock.product_id, productName: stock.products?.name ?? "صنف",
      sku: stock.products?.sku ?? "", quantity: Number(stock.quantity), costPrice: Number(stock.cost_price),
      stockValue: roundMoney(Number(stock.quantity) * Number(stock.cost_price)),
      quantitySold90Days: activity.quantity90Days, lastSoldAt: activity.lastSoldAt,
      daysSinceLastSale: activity.lastSoldAt ? Math.floor((Date.now() - new Date(activity.lastSoldAt).getTime()) / 86400000) : null,
    };
  }).filter((row: any) => row.quantity > 0 && row.quantitySold90Days === 0 || row.quantity > 0 && (row.daysSinceLastSale ?? 0) >= 60)
    .sort((a: any,b: any) => (b.stockValue-a.stockValue)).slice(0,200);

  const byBranch = [...new Set([...revenueByBranch.keys(), ...marginRows.map(row => row.branchId)])].map(id => {
    const rows = marginRows.filter(row => row.branchId === id);
    return {
      branchId: id, branchName: branches.get(id) ?? "—",
      revenue: roundMoney(rows.reduce((sum,row)=>sum+row.revenue,0)),
      cost: roundMoney(rows.reduce((sum,row)=>sum+row.cost,0)),
      grossProfit: roundMoney(rows.reduce((sum,row)=>sum+row.grossProfit,0)),
    };
  });

  return Response.json({
    period: { from, to, branchId: branchId || null },
    dataLimit: { sales: allSales.length >= 10000, payments: payments.length >= 50000, note: "إذا ظهر حد البيانات، قسّم الفترة إلى نطاقات أقصر قبل الاعتماد." },
    profitability: { byBranch, products: marginRows.slice(0,500), historicalCostEstimated: marginRows.some(row => row.estimatedCostLines > 0) },
    receivablesAging: {
      current: { count: aging.current.length, amount: roundMoney(aging.current.reduce((sum,row)=>sum+row.due,0)), invoices: aging.current },
      days1to30: { count: aging.days1to30.length, amount: roundMoney(aging.days1to30.reduce((sum,row)=>sum+row.due,0)), invoices: aging.days1to30 },
      days31to60: { count: aging.days31to60.length, amount: roundMoney(aging.days31to60.reduce((sum,row)=>sum+row.due,0)), invoices: aging.days31to60 },
      days61to90: { count: aging.days61to90.length, amount: roundMoney(aging.days61to90.reduce((sum,row)=>sum+row.due,0)), invoices: aging.days61to90 },
      over90: { count: aging.over90.length, amount: roundMoney(aging.over90.reduce((sum,row)=>sum+row.due,0)), invoices: aging.over90 },
    },
    slowMoving,
    salespersonPerformance: [...performance.values()].map(row => ({
      ...row, invoiced: roundMoney(row.invoiced), collected: roundMoney(row.collected), returned: roundMoney(row.returned),
      netSales: roundMoney(row.invoiced - row.returned),
    })).sort((a,b)=>b.netSales-a.netSales),
  });
}
