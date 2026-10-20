"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { normalizeEgyptianPhone } from "@/lib/phone";
import CustomersSection from "@/components/customers-section";
import SalesSection from "@/components/sales-section";
import { LensPricesSection, LensSuppliesSection, ProductsSection } from "@/components/catalog-sections";
import OperationsSection from "@/components/operations-section";
import FinanceCharts from "@/components/finance-charts";
import ShiftPanel, { ShiftBadge } from "@/components/shift-panel";
import DailyOverview from "@/components/daily-overview";
import DeliveriesPanel from "@/components/deliveries-panel";
import { InstallButton } from "@/components/pwa";
import CentralCash from "@/components/central-cash";
import StaffHours from "@/components/staff-hours";
import AccountSection from "@/components/account-section";
import AccountPanel from "@/components/account-panel";
import ReportsPanel from "@/components/reports-panel";
import SystemHealthPanel from "@/components/system-health-panel";
import GlobalSearch from "@/components/global-search";
import LensOrders from "@/components/lens-orders";


type User = { id?: string; name: string; email?: string | null; phone?: string; roles: string[]; permissions: string[]; branchIds: string[] };
type Branch = { id: string; code: string; name: string; address: string | null; phone: string | null; status: "ACTIVE" | "INACTIVE"; _count?: { userAccess: number } };
type Staff = { id: string; name: string; phone: string; status: string; employee?: { branch_id:string;base_salary:number;commission_rate:number;job_title:string } | null; roles: { role: { key: string; name: string } }[]; grants: { permission: { key: string } }[]; branchAccess: { branch: { id: string; code: string; name: string } }[] };
type Permission = { key: string; label: string };
const permissionList: Permission[] = [
  { key: "branches.read", label: "عرض الفروع المسموح بها" },
  { key: "customers.read", label: "عرض العملاء" }, { key: "customers.manage", label: "إدارة العملاء" },
  { key: "sales.create", label: "إنشاء الفواتير" }, { key: "payments.record", label: "تسجيل المدفوعات" },
  { key: "deliveries.complete", label: "إتمام التسليمات" }, { key: "returns.manage", label: "إدارة المرتجعات" },
  { key: "reports.own.read", label: "عرض تقاريره الشخصية" },
  { key: "inventory.manage", label: "إدارة المخزون والتحويلات" },
  { key: "purchases.manage", label: "إدارة المشتريات والموردين" },
  { key: "finance.manage", label: "إدارة الخزائن والمصروفات" },
  { key: "staff.manage", label: "إدارة الموظفين والرواتب" },
  { key: "expenses.create", label: "تسجيل مصروفات الفرع" },
  { key: "payroll.advance.request", label: "طلب مسحوبات أو سلفة راتب" },
];
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "تعذر إتمام الطلب");
  return data;
}

export default function Workspace({ initialUser }: { initialUser: User | null }) {
  const [user, setUser] = useState<User | null>(initialUser);
  const [activeTab, setActiveTab] = useState("overview");
  const [salesView, setSalesView] = useState<"pos" | "invoices" | "deliveries">("pos");
  const [lensView, setLensView] = useState<"prices" | "supplies" | "orders">("prices");
  const [inventoryView, setInventoryView] = useState<"products" | "stock" | "purchases">("products");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<{id:string;title:string;body:string;createdAt:string;target:string;kind:string}[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]); const [staff, setStaff] = useState<Staff[]>([]);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [loginPhone, setLoginPhone] = useState(""); const [loginPassword, setLoginPassword] = useState("");
  const [branchForm, setBranchForm] = useState({ code: "", name: "", address: "", phone: "" });
  const [editingBranch, setEditingBranch] = useState<string | null>(null);
  const [staffForm, setStaffForm] = useState({ name: "", phone: "", branchIds: [] as string[], permissionKeys: [] as string[], baseSalary: "0", commissionRate: "0" });
  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  const [editingStaffStatus, setEditingStaffStatus] = useState("ACTIVE");
  const isOwner = user?.roles.includes("super_admin") ?? false;
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [brandName, setBrandName] = useState("نظرة");
  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    const loadBrandSettings = () => {
      fetch("/api/brand-settings", { cache: "no-store" }).then((r) => r.json()).then((j) => {
        if (active && j && !j.error) { setBrandLogo(j.logoDataUrl ?? null); setBrandName(typeof j.brandName === "string" && j.brandName.trim() ? j.brandName.trim() : "نظرة"); }
      }).catch(() => {});
    };
    loadBrandSettings();
    window.addEventListener("brand-settings:changed", loadBrandSettings);
    return () => { active = false; window.removeEventListener("brand-settings:changed", loadBrandSettings); };
  }, [isOwner]);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const b = await api("/api/branches"); setBranches(b.branches);
      if (isOwner) { const u = await api("/api/users"); setStaff(u.users); }
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحميل البيانات"); }
  }, [user, isOwner]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!user) return;
    let active = true;
    const check = async () => { try { const result = await fetch("/api/auth/session", { cache: "no-store" }); if (active) setIsOnline(result.ok); } catch { if (active) setIsOnline(false); } };
    void check(); const timer = window.setInterval(check, 20000);
    const onOnline = () => { void check(); }; const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [user]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const credentials = normalizeEgyptianPhone(loginPhone); if (!credentials) throw new Error("أدخل رقم موبايل مصري صحيحًا"); const supabase = createSupabaseClient(); const { error: signInError } = await supabase.auth.signInWithPassword({ phone: credentials.phone, password: loginPassword }); if (signInError) throw new Error("بيانات الدخول غير صحيحة"); await api("/api/auth/login", { method: "POST", body: "{}" }); setUser((await api("/api/auth/session")).user); setMessage("تم تسجيل الدخول"); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل الدخول"); }
    finally { setBusy(false); }
  }
  async function handleLogout() { setBusy(true); try { const supabase = createSupabaseClient(); const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) throw signOutError; navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_SHELL" });  setUser(null); setBranches([]); setStaff([]); window.location.assign("/login"); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل الخروج"); } finally { setBusy(false); } }
  async function createBranch(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const branch = branches.find((item) => item.id === editingBranch);
      if (editingBranch && branch) await api(`/api/branches/${editingBranch}`, { method: "PATCH", body: JSON.stringify({ ...branchForm, status: branch.status }) });
      else await api("/api/branches", { method: "POST", body: JSON.stringify(branchForm) });
      setBranchForm({ code: "", name: "", address: "", phone: "" }); setEditingBranch(null); setMessage(editingBranch ? "تم تحديث بيانات الفرع" : "تم حفظ الفرع على الخادم"); await refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر حفظ الفرع"); } finally { setBusy(false); }
  }
  function editBranch(branch: Branch) { setEditingBranch(branch.id); setBranchForm({ code: branch.code, name: branch.name, address: branch.address ?? "", phone: branch.phone ?? "" }); setActiveTab("branches"); }
  async function toggleBranch(branch: Branch) {
    setBusy(true); setError("");
    try { await api(`/api/branches/${branch.id}`, { method: "PATCH", body: JSON.stringify({ code: branch.code, name: branch.name, address: branch.address, phone: branch.phone, status: branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) }); setMessage("تم تحديث حالة الفرع"); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر تحديث الفرع"); } finally { setBusy(false); }
  }
  async function createStaff(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (editingStaff) await api(`/api/users/${editingStaff}`, { method: "PATCH", body: JSON.stringify({ name: staffForm.name, status: editingStaffStatus, branchIds: staffForm.branchIds, permissionKeys: staffForm.permissionKeys, baseSalary:Number(staffForm.baseSalary), commissionRate:Number(staffForm.commissionRate) }) });
      else await api("/api/users", { method: "POST", body: JSON.stringify({ ...staffForm, baseSalary:Number(staffForm.baseSalary), commissionRate:Number(staffForm.commissionRate) }) });
      setStaffForm({ name: "", phone: "", branchIds: [], permissionKeys: [], baseSalary:"0", commissionRate:"0" }); setEditingStaff(null); setMessage(editingStaff ? "تم تحديث حساب البائع" : "تم إنشاء حساب البائع"); await refresh();
    }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر إنشاء الحساب"); } finally { setBusy(false); }
  }
  function editStaff(person: Staff) { setEditingStaff(person.id); setEditingStaffStatus(person.status); setStaffForm({ name: person.name, phone: person.phone, branchIds: person.branchAccess.map((item) => item.branch.id), permissionKeys: person.grants.map((item) => item.permission.key), baseSalary:String(person.employee?.base_salary??0), commissionRate:String(person.employee?.commission_rate??0) }); document.getElementById("staff-form")?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  async function toggleStaff(person: Staff) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/users/${person.id}`, { method: "PATCH", body: JSON.stringify({ name: person.name, status: person.status === "ACTIVE" ? "DISABLED" : "ACTIVE", branchIds: person.branchAccess.map((item) => item.branch.id), permissionKeys: person.grants.map((item) => item.permission.key), baseSalary:Number(person.employee?.base_salary??0), commissionRate:Number(person.employee?.commission_rate??0) }) });
      setMessage(person.status === "ACTIVE" ? "تم إيقاف الحساب وإنهاء جلساته" : "تم تفعيل الحساب"); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر تحديث الحساب"); } finally { setBusy(false); }
  }
  function toggleInList(list: string[], item: string) { return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]; }

  if (!user) return <main className="login-wrap"><div className="login-card"><img className="brand-logo" src="/icons/icon-192.png" alt="نظرة" width={56} height={56}/><p className="eyebrow">نظام إدارة البصريات</p><h1>مرحبًا بعودتك</h1><p className="muted">سجّل الدخول لمتابعة فروعك من مكان واحد.</p>
    <form onSubmit={handleLogin} className="stack"><label>رقم الموبايل<input type="tel" inputMode="tel" autoComplete="username" required value={loginPhone} onChange={(e) => { const value = e.target.value; setLoginPhone(value); const normalized = normalizeEgyptianPhone(value); if (normalized) setLoginPassword(normalized.initialPassword); }} placeholder="01012345678" /></label><label>كلمة المرور<input type="password" autoComplete="current-password" required value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} /></label><p className="footnote">تُملأ مبدئيًا من رقمك بعد حذف الصفر الأول، ويمكنك إدخال كلمة مرور مختلفة.</p><button className="primary" disabled={busy}>{busy ? "جارٍ التحقق…" : "تسجيل الدخول"}</button></form>
    <Notice error={error} message={message}/><div className="secure-note"><span className="dot"/> الاتصال بالخادم مطلوب لحفظ كل عملية</div></div></main>;

  return <main className="app-shell"><header className="topbar"><div className="brand">{brandLogo ? <img className="brand-logo small" src={brandLogo} alt="شعار البراند" width={38} height={38}/> : <img className="brand-logo small" src="/icons/icon-192.png" alt="نظرة" width={38} height={38}/>}<div><strong>{brandName || "نظرة"}</strong><span>إدارة الفروع</span></div></div><div className="top-actions"><button type="button" className="quiet icon-action" aria-label={searchOpen ? "إغلاق البحث" : "فتح البحث"} aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)}>⌕</button><div className="notification-wrap"><button type="button" className="quiet icon-action notification-button" aria-label="التنبيهات" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(v=>!v)}><span aria-hidden="true">🔔</span>{notifications.length>0&&<span className="notification-count">{notifications.length>99?"99+":notifications.length}</span>}</button>{notificationsOpen&&<div className="notification-menu" role="dialog" aria-label="التنبيهات"><div className="section-heading"><strong>التنبيهات</strong><button type="button" className="quiet" onClick={()=>setNotificationsOpen(false)}>إغلاق</button></div>{notifications.length===0?<p className="footnote">لا توجد تنبيهات حالية.</p>:notifications.map(n=><button type="button" className="notification-item" key={n.id} onClick={()=>{setActiveTab(n.target);if(n.target==="lenses")setLensView("orders");setNotificationsOpen(false)}}><strong>{n.title}</strong><span>{n.body}</span><small>{new Intl.DateTimeFormat("ar-EG",{dateStyle:"short",timeStyle:"short"}).format(new Date(n.createdAt))}</small></button>)}</div>}</div><ShiftBadge /><InstallButton /><div className={`connection ${isOnline ? "" : "disconnected"}`}><span className="dot"/>{isOnline ? "متصل بالخادم" : "الخادم غير متاح"}</div><button className="quiet" onClick={handleLogout} disabled={busy}>خروج</button></div></header>
    {searchOpen && <div className="search-drawer"><GlobalSearch onNavigate={(tab) => { setActiveTab(tab === "pos" || tab === "invoices" ? "sales" : tab); if (tab === "pos" || tab === "invoices") setSalesView(tab); setSearchOpen(false); }} isOwner={isOwner} /><button type="button" className="quiet" onClick={() => setSearchOpen(false)}>إغلاق</button></div>}
    <nav className="workspace-tabs" aria-label="أقسام النظام" role="tablist">
      <Tab id="overview" active={activeTab} setActive={setActiveTab}>الرئيسية</Tab>
      {(isOwner || user.permissions.includes("sales.create") || user.permissions.includes("sales.read") || user.permissions.includes("returns.manage") || user.permissions.includes("deliveries.complete")) && <Tab id="sales" active={activeTab} setActive={setActiveTab}>المبيعات</Tab>}
      {(isOwner || user.permissions.includes("customers.read")) && <Tab id="customers" active={activeTab} setActive={setActiveTab}>العملاء</Tab>}
      {isOwner && <><Tab id="inventory" active={activeTab} setActive={setActiveTab}>المخزون</Tab><Tab id="lenses" active={activeTab} setActive={setActiveTab}>العدسات</Tab><Tab id="finance" active={activeTab} setActive={setActiveTab}>الخزينة</Tab><Tab id="reports" active={activeTab} setActive={setActiveTab}>التقارير</Tab><Tab id="staff" active={activeTab} setActive={setActiveTab}>الموظفون</Tab><Tab id="settings" active={activeTab} setActive={setActiveTab}>الإعدادات</Tab></>}
      {!isOwner && (user.permissions.includes("sales.create") || user.permissions.includes("inventory.manage") || user.permissions.includes("purchases.manage")) && <Tab id="lens-orders" active={activeTab} setActive={setActiveTab}>طلبيات العدسات</Tab>}
      {!isOwner && user.permissions.includes("expenses.create") && <Tab id="seller-finance" active={activeTab} setActive={setActiveTab}>مصروفات</Tab>}
      <Tab id="account" active={activeTab} setActive={setActiveTab}>حسابي</Tab>
    </nav>
    <Notice error={error} message={message}/>
    {activeTab === "overview" && <>
    <section className="welcome"><div><p className="eyebrow">مساحة العمل</p><h1>{isOwner ? "إدارة مركزية، رؤية أوضح." : `أهلًا ${user.name}`}</h1><p className="muted">{isOwner ? "تابع الفروع وحسابات فريقك من لوحة واحدة." : "ابدأ يوم عملك وسجّل فواتيرك من هنا."}</p></div><div className="welcome-art" aria-hidden="true"><span>◉</span><i/><b/></div></section>
    {isOwner && <section className="stats"><Stat label="الفروع" value={String(branches.length).padStart(2, "0")} detail="مرتبطة بالنظام"/><Stat label="الفروع النشطة" value={String(branches.filter((b) => b.status === "ACTIVE").length).padStart(2, "0")} detail="جاهزة للعمل"/><Stat label="فريق العمل" value={String(staff.length).padStart(2, "0")} detail="حسابات المستخدمين"/></section>}
    <ShiftPanel />
    <FinanceCharts /></>}
    {activeTab === "account" && <><AccountSection isOwner={isOwner} /><AccountPanel branches={branches} branchIds={user.branchIds} /></>}
    {activeTab === "lens-orders" && !isOwner && <LensOrders branches={branches} branchIds={user.branchIds} isOwner={isOwner} />}
    {activeTab === "customers" && (isOwner || user.permissions.includes("customers.read")) && <CustomersSection canManage={isOwner || user.permissions.includes("customers.manage")} branches={branches} branchIds={user.branchIds} isOwner={isOwner} />}
    {activeTab === "sales" && <section className="panel"><div className="mode-switch" role="tablist" aria-label="أقسام المبيعات">
      {(isOwner || user.permissions.includes("sales.create")) && <button type="button" role="tab" aria-selected={salesView === "pos"} className={salesView === "pos" ? "on" : "off"} onClick={() => setSalesView("pos")}>نقطة البيع</button>}
      {(isOwner || user.permissions.includes("sales.read") || user.permissions.includes("sales.create") || user.permissions.includes("returns.manage")) && <button type="button" role="tab" aria-selected={salesView === "invoices"} className={salesView === "invoices" ? "on" : "off"} onClick={() => setSalesView("invoices")}>الفواتير والمرتجعات</button>}
      {(isOwner || user.permissions.includes("deliveries.complete")) && <button type="button" role="tab" aria-selected={salesView === "deliveries"} className={salesView === "deliveries" ? "on" : "off"} onClick={() => setSalesView("deliveries")}>التسليم</button>}
    </div>
    {(salesView === "pos" && (isOwner || user.permissions.includes("sales.create"))) && <SalesSection branches={branches} branchIds={user.branchIds} isOwner={isOwner} canCreate={isOwner || user.permissions.includes("sales.create")} canPay={isOwner || user.permissions.includes("payments.record")} canUpdateDelivery={isOwner || user.permissions.includes("deliveries.complete")} canManageCustomers={isOwner || user.permissions.includes("customers.manage")} canManageReturns={isOwner || user.permissions.includes("returns.manage")} mode="pos" />}
    {(salesView === "invoices" && (isOwner || user.permissions.includes("sales.read") || user.permissions.includes("sales.create") || user.permissions.includes("returns.manage"))) && <><SalesSection branches={branches} branchIds={user.branchIds} isOwner={isOwner} canCreate={isOwner || user.permissions.includes("sales.create")} canPay={isOwner || user.permissions.includes("payments.record")} canUpdateDelivery={isOwner || user.permissions.includes("deliveries.complete")} canManageCustomers={isOwner || user.permissions.includes("customers.manage")} canManageReturns={isOwner || user.permissions.includes("returns.manage")} mode="invoices" />{isOwner && <ReportsPanel branches={branches} mode="sales" />}</>}
    {salesView === "deliveries" && (isOwner || user.permissions.includes("deliveries.complete")) && <DeliveriesPanel branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}
    </section>}
    {!isOwner && activeTab === "seller-finance" && <OperationsSection module="seller-finance" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}
    {isOwner && activeTab === "overview" && <DailyOverview />}
    {isOwner && activeTab === "inventory" && <section className="panel"><div className="mode-switch" role="tablist" aria-label="أقسام المخزون">
      <button type="button" role="tab" aria-selected={inventoryView==="products"} className={inventoryView==="products"?"on":"off"} onClick={()=>setInventoryView("products")}>الأصناف والأرصدة</button>
      <button type="button" role="tab" aria-selected={inventoryView==="stock"} className={inventoryView==="stock"?"on":"off"} onClick={()=>setInventoryView("stock")}>الجرد والتحويلات</button>
      <button type="button" role="tab" aria-selected={inventoryView==="purchases"} className={inventoryView==="purchases"?"on":"off"} onClick={()=>setInventoryView("purchases")}>المشتريات والموردون</button>
    </div>{inventoryView==="products"?<ProductsSection branches={branches}/>:inventoryView==="stock"?<OperationsSection module="inventory" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>:<OperationsSection module="purchases" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}</section>}
    {isOwner && activeTab === "finance" && <><CentralCash /><OperationsSection module="finance" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/></>}
    {isOwner && activeTab === "reports" && <><ReportsPanel branches={branches} mode="finance" /><ReportsPanel branches={branches} mode="staff" /><FinanceCharts /></>}
    {isOwner && activeTab === "staff" && <><OperationsSection module="staff" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/><StaffHours branches={branches} /></>}
    {isOwner && activeTab === "lenses" && <section className="panel"><div className="mode-switch" role="tablist" aria-label="إدارة العدسات">
      <button type="button" role="tab" aria-selected={lensView === "prices"} className={lensView === "prices" ? "on" : "off"} onClick={() => setLensView("prices")}>الأسعار</button>
      <button type="button" role="tab" aria-selected={lensView === "supplies"} className={lensView === "supplies" ? "on" : "off"} onClick={() => setLensView("supplies")}>التوريد</button><button type="button" role="tab" aria-selected={lensView === "orders"} className={lensView === "orders" ? "on" : "off"} onClick={() => setLensView("orders")}>طلبيات العدسات</button>
    </div>{lensView === "prices" ? <LensPricesSection branches={branches} /> : lensView === "supplies" ? <LensSuppliesSection branches={branches} /> : <LensOrders branches={branches} branchIds={user.branchIds} isOwner={isOwner} />}</section>}
    {isOwner && activeTab === "settings" && <><SystemHealthPanel />
    {isOwner && <div className="admin-grid"><section className="panel form-panel" id="branch-form"><div className="section-heading"><div><p className="eyebrow">توسّع منظّم</p><h2>{editingBranch ? "تعديل بيانات الفرع" : "إضافة فرع"}</h2></div><span className="soft-icon">{editingBranch ? "✎" : "＋"}</span></div><form className="form-grid" onSubmit={createBranch}><label>اسم الفرع<input required minLength={2} value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="مثال: فرع المعادي"/></label><label>كود الفرع<input required minLength={2} value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} placeholder="MAA-01"/></label><label className="wide">العنوان<input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} placeholder="المنطقة والشارع"/></label><label>رقم التواصل<input type="tel" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="01xxxxxxxxx"/></label><button className="primary" disabled={busy}>{editingBranch ? "حفظ التعديلات" : "حفظ الفرع"}</button>{editingBranch && <button type="button" className="quiet" onClick={() => { setEditingBranch(null); setBranchForm({ code: "", name: "", address: "", phone: "" }); }}>إلغاء التعديل</button>}</form></section>
      <section className="panel form-panel"><div className="section-heading"><div><p className="eyebrow">فريقك</p><h2>إضافة بائع</h2></div><span className="soft-icon">♙</span></div><form className="form-grid" onSubmit={createStaff}><label>اسم الموظف<input required minLength={2} value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}/></label><label>رقم الموبايل<input type="tel" inputMode="tel" required value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}/></label><label>الراتب الأسبوعي<input type="number" min="0" value={staffForm.baseSalary} onChange={(e)=>setStaffForm({...staffForm,baseSalary:e.target.value})}/></label><label>عمولة المبيعات %<input type="number" min="0" max="100" step="0.01" value={staffForm.commissionRate} onChange={(e)=>setStaffForm({...staffForm,commissionRate:e.target.value})}/></label><p className="wide footnote">كلمة المرور المبدئية للبائع هي رقم هاتفه بعد حذف الصفر الأول.</p><fieldset className="wide"><legend>الفروع المسموح بها</legend><div className="checks">{branches.filter((b) => b.status === "ACTIVE").map((b) => <label className="check" key={b.id}><input type="checkbox" checked={staffForm.branchIds.includes(b.id)} onChange={() => setStaffForm({ ...staffForm, branchIds: toggleInList(staffForm.branchIds, b.id) })}/>{b.name}</label>)}</div></fieldset><fieldset className="wide"><legend>صلاحيات البائع</legend><div className="checks">{permissionList.map((p) => <label className="check" key={p.key}><input type="checkbox" checked={staffForm.permissionKeys.includes(p.key)} onChange={() => setStaffForm({ ...staffForm, permissionKeys: toggleInList(staffForm.permissionKeys, p.key) })}/>{p.label}</label>)}</div></fieldset><button className="primary" disabled={busy || branches.filter((b) => b.status === "ACTIVE").length === 0}>{editingStaff?"حفظ بيانات الموظف":"إنشاء حساب الموظف"}</button></form></section></div>}
    <section className="panel staff-panel"><div className="section-heading"><div><p className="eyebrow">الوصول</p><h2>المستخدمون</h2></div><span className="count-badge">{staff.length} حساب</span></div><div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الفروع</th><th>الراتب الأسبوعي والعمولة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{staff.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.phone}</small></td><td>{person.roles.map((r) => r.role.name).join("، ")}</td><td>{person.branchAccess.map((b) => b.branch.name).join("، ") || "—"}</td><td>{person.employee?`${person.employee.base_salary} ج / أسبوع · ${person.employee.commission_rate}%`:"—"}</td><td><span className={`status ${person.status === "ACTIVE" ? "active" : "inactive"}`}>{person.status === "ACTIVE" ? "نشط" : "موقوف"}</span></td><td><button className="row-action" disabled={busy} onClick={() => editStaff(person)}>تعديل</button> <button className="row-action" disabled={busy} onClick={() => void toggleStaff(person)}>{person.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button></td></tr>)}{staff.length === 0 && <tr><td colSpan={6} className="table-empty">لم تتم إضافة مستخدمين بعد.</td></tr>}</tbody></table></div><p className="footnote">الأدوار المتاحة: مالك البراند وبائع. صلاحيات مدير الفرع غير موجودة.</p></section></>}
    <footer className="system-powered-footer"><img src="/icons/icon-192.png" alt="Nazra Systems" width={28} height={28}/><span>Powered by <strong>Nazra Systems</strong></span></footer></main>;
}
function Notice({ error, message }: { error: string; message: string }) { if (!error && !message) return null; return <div className={`notice ${error ? "error" : "success"}`} role="status">{error || message}</div>; }
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Tab({ id, active, setActive, children }: { id: string; active: string; setActive: (value: string) => void; children: string }) { return <button type="button" role="tab" aria-selected={active === id} className={`workspace-tab ${active === id ? "selected" : ""}`} onClick={() => setActive(id)}>{children}</button>; }
