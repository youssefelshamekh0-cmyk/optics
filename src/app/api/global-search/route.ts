import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "يلزم تسجيل الدخول" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const term = (params.get("q") ?? "").trim().slice(0, 80);
  if (term.length < 2) return Response.json({ customers: [], invoices: [], products: [] });
  const owner = user.roles.includes("super_admin");
  const canReadCustomers = owner || user.permissions.includes("customers.read");
  const canReadSales = owner || user.permissions.includes("sales.read") || user.permissions.includes("sales.create");
  const canReadProducts = owner || user.permissions.includes("sales.create") || user.permissions.includes("inventory.manage");
  const admin = getSupabaseAdmin() as any;
  const escaped = term.replace(/[,%()]/g, " ").trim();
  if (escaped.length < 2) return Response.json({ customers: [], invoices: [], products: [] });

  try {
    let allowedCustomerIds: string[] | null = null;
    if (!owner && canReadCustomers) {
      const [salesCustomers, createdCustomers] = await Promise.all([
        user.branchIds.length ? admin.from("sales").select("customer_id").in("branch_id", user.branchIds).limit(10000) : Promise.resolve({ data: [], error: null }),
        admin.from("customers").select("id").eq("created_by", user.id).limit(10000),
      ]);
      if (salesCustomers.error || createdCustomers.error) throw salesCustomers.error ?? createdCustomers.error;
      allowedCustomerIds = [...new Set([...(salesCustomers.data ?? []).map((row: any) => row.customer_id), ...(createdCustomers.data ?? []).map((row: any) => row.id)].filter(Boolean))];
    }

    let customerRows: any[] = [];
    if (canReadCustomers && (owner || allowedCustomerIds!.length)) {
      let query = admin.from("customers").select("id,full_name,phone,email").or("full_name.ilike.%"+escaped+"%,phone.ilike.%"+escaped+"%").order("full_name").limit(8);
      if (allowedCustomerIds) query = query.in("id", allowedCustomerIds);
      const result = await query;
      if (result.error) throw result.error;
      customerRows = result.data ?? [];
    }

    let invoices: any[] = [];
    if (canReadSales) {
      const queries: Promise<any>[] = [];
      if (/^\d+$/.test(term)) {
        let invoiceQuery = admin.from("sales").select("id,invoice_number,branch_id,customer_id,grand_total,delivery_status,created_at,customers(full_name),branches(name)").eq("invoice_number", Number(term)).limit(8);
        if (!owner) invoiceQuery = invoiceQuery.in("branch_id", user.branchIds);
        queries.push(invoiceQuery);
      }
      const customerIds = customerRows.map((row) => row.id);
      if (customerIds.length) {
        let byCustomer = admin.from("sales").select("id,invoice_number,branch_id,customer_id,grand_total,delivery_status,created_at,customers(full_name),branches(name)").in("customer_id", customerIds).order("created_at", { ascending: false }).limit(8);
        if (!owner) byCustomer = byCustomer.in("branch_id", user.branchIds);
        queries.push(byCustomer);
      }
      const results = await Promise.all(queries);
      for (const result of results) { if (result.error) throw result.error; invoices.push(...(result.data ?? [])); }
      invoices = [...new Map(invoices.map((row) => [row.id, row])).values()].slice(0, 8);
    }

    let products: any[] = [];
    if (canReadProducts) {
      const productResult = await admin.from("products").select("id,name,sku,category").or("name.ilike.%"+escaped+"%,sku.ilike.%"+escaped+"%").order("name").limit(12);
      if (productResult.error) throw productResult.error;
      const productIds = (productResult.data ?? []).map((row: any) => row.id);
      if (productIds.length) {
        let stockQuery = admin.from("branch_products").select("product_id,branch_id,quantity,reference_price,branches(name)").in("product_id", productIds);
        if (!owner) stockQuery = stockQuery.in("branch_id", user.branchIds);
        const stockResult = await stockQuery;
        if (stockResult.error) throw stockResult.error;
        const stockByProduct = new Map<string, any[]>();
        for (const stock of stockResult.data ?? []) stockByProduct.set(stock.product_id, [...(stockByProduct.get(stock.product_id) ?? []), stock]);
        products = (productResult.data ?? []).filter((row: any) => owner || stockByProduct.has(row.id)).slice(0, 8).map((row: any) => ({
          ...row,
          branches: (stockByProduct.get(row.id) ?? []).map((stock: any) => ({ name: stock.branches?.name ?? "فرع", quantity: Number(stock.quantity) })),
        }));
      }
    }
    return Response.json({
      customers: customerRows.map((row: any) => ({ id: row.id, name: row.full_name, phone: row.phone })),
      invoices: invoices.map((row: any) => ({ id: row.id, invoiceNumber: row.invoice_number, customerName: row.customers?.full_name ?? "عميل", branchName: row.branches?.name ?? "—", total: Number(row.grand_total), status: row.delivery_status })),
      products: products.map((row: any) => ({ id: row.id, name: row.name, sku: row.sku, category: row.category, branches: row.branches })),
    });
  } catch {
    return Response.json({ error: "تعذر إكمال البحث؛ تحقق من الصلاحيات واتصال قاعدة البيانات." }, { status: 500 });
  }
}
