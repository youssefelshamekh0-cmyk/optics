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
import { InstallButton } from "@/components/pwa";
import CentralCash from "@/components/central-cash";
import StaffHours from "@/components/staff-hours";
import ReportsPanel from "@/components/reports-panel";
import AccountSection from "@/components/account-section";

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
  async function handleLogout() { setBusy(true); try { const supabase = createSupabaseClient(); const { error: signOutError } = await supabase.auth.signOut(); if (signOutError) throw signOutError; setUser(null); setBranches([]); setStaff([]); window.location.assign("/login"); } catch (e) { setError(e instanceof Error ? e.message : "تعذر تسجيل الخروج"); } finally { setBusy(false); } }
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
    event.preventDefault(); setError(""); setMessage("");
    if (!editingStaff && staffForm.branchIds.length === 0) { setError("اختار فرع واحد على الأقل للبائع قبل إنشاء الحساب."); document.getElementById("staff-form")?.scrollIntoView({behavior:"smooth",block:"center"}); return; }
    if (!editingStaff && staffForm.permissionKeys.length === 0) { setError("اختار صلاحية واحدة على الأقل للبائع قبل إنشاء الحساب."); document.getElementById("staff-form")?.scrollIntoView({behavior:"smooth",block:"center"}); return; }
    const normalizedPhone = normalizeEgyptianPhone(staffForm.phone);
    if (!normalizedPhone) { setError("رقم الموبايل غير صحيح. أدخل رقم موبايل مصري يبدأ بـ 01."); return; }
    setBusy(true);
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

  return <main className="app-shell"><header className="topbar"><div className="brand"><img className="brand-logo small" src="/icons/icon-192.png" alt="نظرة" width={38} height={38}/><div><strong>نظرة</strong><span>إدارة الفروع</span></div></div><div className="top-actions"><ShiftBadge /><InstallButton /><div className={`connection ${isOnline ? "" : "disconnected"}`}><span className="dot"/>{isOnline ? "متصل بالخادم" : "الخادم غير متاح"}</div><div className="user-pill"><span className="avatar">{user.name.slice(0, 1)}</span><span>{user.name}<small>{isOwner ? "مالك البراند" : "بائع"}</small></span></div><button className="quiet" onClick={handleLogout} disabled={busy}>خروج</button></div></header>
    <nav className="workspace-tabs" aria-label="أقسام النظام" role="tablist">
      <Tab id="overview" active={activeTab} setActive={setActiveTab}>نظرة عامة</Tab>
      <Tab id="account" active={activeTab} setActive={setActiveTab}>حسابي</Tab>
      {(isOwner || user.permissions.includes("sales.create")) && <Tab id="sales" active={activeTab} setActive={setActiveTab}>نقطة البيع</Tab>}
      {(isOwner || user.permissions.includes("customers.read")) && <Tab id="customers" active={activeTab} setActive={setActiveTab}>العملاء</Tab>}
      {(isOwner || user.permissions.includes("sales.read") || user.permissions.includes("payments.record") || user.permissions.includes("deliveries.complete") || user.permissions.includes("returns.manage")) && <Tab id="deliveries" active={activeTab} setActive={setActiveTab}>الفواتير</Tab>}
      {!isOwner && (user.permissions.includes("expenses.create") || user.permissions.includes("payroll.advance.request")) && <Tab id="seller-finance" active={activeTab} setActive={setActiveTab}>مصروفاتي وطلباتي</Tab>}
      {isOwner && <><Tab id="inventory" active={activeTab} setActive={setActiveTab}>الأصناف والمخزون</Tab><Tab id="purchases" active={activeTab} setActive={setActiveTab}>المشتريات والموردون</Tab><Tab id="finance" active={activeTab} setActive={setActiveTab}>الخزائن والمصروفات</Tab><Tab id="staff" active={activeTab} setActive={setActiveTab}>الموظفون</Tab><Tab id="lens-prices" active={activeTab} setActive={setActiveTab}>أسعار العدسات</Tab><Tab id="lens-supplies" active={activeTab} setActive={setActiveTab}>توريد العدسات</Tab><Tab id="branches" active={activeTab} setActive={setActiveTab}>الفروع والفريق</Tab></>}
    </nav>
    <Notice error={error} message={message}/>
    {activeTab === "overview" && <>
    <section className="welcome"><div><p className="eyebrow">مساحة العمل</p><h1>{isOwner ? "إدارة مركزية، رؤية أوضح." : `أهلًا ${user.name}`}</h1><p className="muted">{isOwner ? "تابع الفروع وحسابات فريقك من لوحة واحدة." : "ابدأ يوم عملك وسجّل فواتيرك من هنا."}</p></div><div className="welcome-art" aria-hidden="true"><span>◉</span><i/><b/></div></section>
    {isOwner && <section className="stats"><Stat label="الفروع" value={String(branches.length).padStart(2, "0")} detail="مرتبطة بالنظام"/><Stat label="الفروع النشطة" value={String(branches.filter((b) => b.status === "ACTIVE").length).padStart(2, "0")} detail="جاهزة للعمل"/><Stat label="فريق العمل" value={String(staff.length).padStart(2, "0")} detail="حسابات المستخدمين"/></section>}
    <ShiftPanel />
    {isOwner && <DailyOverview />}
    <FinanceCharts />
    {isOwner && <section className="panel"><div className="section-heading"><div><p className="eyebrow">الإدارة المركزية</p><h2>الفروع</h2></div><span className="count-badge">{branches.length} فرع</span></div>
      {branches.length ? <div className="branch-grid">{branches.map((branch) => <article className="branch-card" key={branch.id}><div className="branch-card-head"><span className="branch-icon">⌂</span><span className={`status ${branch.status === "ACTIVE" ? "active" : "inactive"}`}>{branch.status === "ACTIVE" ? "نشط" : "متوقف"}</span></div><h3>{branch.name}</h3><p className="branch-code">{branch.code}</p><div className="branch-meta"><span>{branch.address || "لم يضف عنوان"}</span><span>{branch._count?.userAccess ?? 0} مستخدم</span></div>{isOwner && <><button className="text-button" disabled={busy} onClick={() => editBranch(branch)}>تعديل البيانات<span>✎</span></button><button className="text-button" disabled={busy} onClick={() => void toggleBranch(branch)}>{branch.status === "ACTIVE" ? "إيقاف الفرع" : "تفعيل الفرع"}<span>←</span></button></>}</article>)}</div> : <div className="empty"><span>⌂</span><strong>لا توجد فروع مرتبطة بعد</strong><p>{isOwner ? "أضف أول فرع لبدء تنظيم العمل." : "اطلب من مالك البراند ربط حسابك بفرع."}</p></div>}
    </section>}</>}
    {activeTab === "account" && <AccountSection isOwner={isOwner} />}
    {activeTab === "customers" && (isOwner || user.permissions.includes("customers.read")) && <CustomersSection canManage={isOwner || user.permissions.includes("customers.manage")} />}
    {activeTab === "sales" && (isOwner || user.permissions.includes("sales.create")) && <SalesSection branches={branches} branchIds={user.branchIds} isOwner={isOwner} canCreate={isOwner || user.permissions.includes("sales.create")} canPay={false} canUpdateDelivery={false} canManageCustomers={isOwner || user.permissions.includes("customers.manage")} view="sales" />}
    
    {(isOwner || user.permissions.includes("sales.read") || user.permissions.includes("payments.record") || user.permissions.includes("deliveries.complete") || user.permissions.includes("returns.manage")) && activeTab === "deliveries" && <><SalesSection branches={branches} branchIds={user.branchIds} isOwner={isOwner} canCreate={false} canPay={isOwner || user.permissions.includes("payments.record")} canUpdateDelivery={isOwner || user.permissions.includes("deliveries.complete")} canManageCustomers={false} canManageReturns={isOwner || user.permissions.includes("returns.manage")} view="management" /><ReportsPanel branches={branches} mode="sales" /></>}
    {!isOwner && activeTab === "seller-finance" && <OperationsSection module="seller-finance" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}
    {isOwner && activeTab === "inventory" && <ProductsSection branches={branches} />}
    {isOwner && activeTab === "inventory" && <OperationsSection module="inventory" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}
    {isOwner && activeTab === "purchases" && <OperationsSection module="purchases" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/>}
    {isOwner && activeTab === "finance" && <CentralCash />}
    {isOwner && activeTab === "finance" && <><OperationsSection module="finance" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/><ReportsPanel branches={branches} mode="finance" /></>}
    {isOwner && activeTab === "staff" && <><OperationsSection module="staff" branches={branches} branchIds={user.branchIds} isOwner={isOwner}/><StaffHours branches={branches} /><ReportsPanel branches={branches} mode="staff" /></>}
    {isOwner && activeTab === "lens-prices" && <LensPricesSection branches={branches} />}
    {isOwner && activeTab === "lens-supplies" && <LensSuppliesSection branches={branches} />}
    {isOwner && activeTab === "branches" && <>
    {isOwner && <div className="admin-grid"><section className="panel form-panel" id="branch-form"><div className="section-heading"><div><p className="eyebrow">توسّع منظّم</p><h2>{editingBranch ? "تعديل بيانات الفرع" : "إضافة فرع"}</h2></div><span className="soft-icon">{editingBranch ? "✎" : "＋"}</span></div><form className="form-grid" onSubmit={createBranch}><label>اسم الفرع<input required minLength={2} value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} placeholder="مثال: فرع المعادي"/></label><label>كود الفرع<input required minLength={2} value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} placeholder="MAA-01"/></label><label className="wide">العنوان<input value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} placeholder="المنطقة والشارع"/></label><label>رقم التواصل<input type="tel" value={branchForm.phone} onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })} placeholder="01xxxxxxxxx"/></label><button className="primary" disabled={busy}>{editingBranch ? "حفظ التعديلات" : "حفظ الفرع"}</button>{editingBranch && <button type="button" className="quiet" onClick={() => { setEditingBranch(null); setBranchForm({ code: "", name: "", address: "", phone: "" }); }}>إلغاء التعديل</button>}</form></section>
      <section className="panel form-panel" id="staff-form"><div className="section-heading"><div><p className="eyebrow">فريقك</p><h2>{editingStaff ? "تعديل حساب البائع" : "إضافة بائع"}</h2></div><span className="soft-icon">♙</span></div><form className="form-grid" onSubmit={createStaff}><label>اسم الموظف<input required minLength={2} value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}/></label><label>رقم الموبايل<input type="tel" inputMode="tel" required value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })}/></label><label>الراتب الأسبوعي<input type="number" min="0" value={staffForm.baseSalary} onChange={(e)=>setStaffForm({...staffForm,baseSalary:e.target.value})}/></label><label>عمولة المبيعات %<input type="number" min="0" max="100" step="0.01" value={staffForm.commissionRate} onChange={(e)=>setStaffForm({...staffForm,commissionRate:e.target.value})}/></label><p className="wide footnote">كلمة المرور المبدئية للبائع هي رقم هاتفه بعد حذف الصفر الأول.</p><fieldset className="wide"><legend>الفروع المسموح بها <span className="selection-count">({staffForm.branchIds.length} محدد)</span></legend><div className="checks">{branches.filter((b) => b.status === "ACTIVE").map((b) => <label className="check" key={b.id}><input type="checkbox" checked={staffForm.branchIds.includes(b.id)} onChange={() => setStaffForm({ ...staffForm, branchIds: toggleInList(staffForm.branchIds, b.id) })}/>{b.name}</label>)}</div></fieldset><fieldset className="wide"><legend>صلاحيات البائع <span className="selection-count">({staffForm.permissionKeys.length} محددة)</span></legend><div className="checks">{permissionList.map((p) => <label className="check" key={p.key}><input type="checkbox" checked={staffForm.permissionKeys.includes(p.key)} onChange={() => setStaffForm({ ...staffForm, permissionKeys: toggleInList(staffForm.permissionKeys, p.key) })}/>{p.label}</label>)}</div></fieldset><button className="primary" disabled={busy || branches.filter((b) => b.status === "ACTIVE").length === 0}>{busy ? "جارٍ الحفظ…" : editingStaff ? "حفظ بيانات الموظف" : "إنشاء حساب الموظف"}</button></form></section></div>}
    <section className="panel staff-panel"><div className="section-heading"><div><p className="eyebrow">الوصول</p><h2>المستخدمون</h2></div><span className="count-badge">{staff.length} حساب</span></div><div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الفروع</th><th>الراتب الأسبوعي والعمولة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{staff.map((person) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.phone}</small></td><td>{person.roles.map((r) => r.role.name).join("، ")}</td><td>{person.branchAccess.map((b) => b.branch.name).join("، ") || "—"}</td><td>{person.employee?`${person.employee.base_salary} ج / أسبوع · ${person.employee.commission_rate}%`:"—"}</td><td><span className={`status ${person.status === "ACTIVE" ? "active" : "inactive"}`}>{person.status === "ACTIVE" ? "نشط" : "موقوف"}</span></td><td><button className="row-action" disabled={busy} onClick={() => editStaff(person)}>تعديل</button> <button className="row-action" disabled={busy} onClick={() => void toggleStaff(person)}>{person.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button></td></tr>)}{staff.length === 0 && <tr><td colSpan={6} className="table-empty">لم تتم إضافة مستخدمين بعد.</td></tr>}</tbody></table></div><p className="footnote">الأدوار المتاحة: مالك البراند وبائع. صلاحيات مدير الفرع غير موجودة.</p></section></>}
    <footer>نظرة <span>•</span> إدارة واحدة لكل فروعك</footer></main>;
}
function Notice({ error, message }: { error: string; message: string }) { if (!error && !message) return null; return <div className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>{error || message}</div>; }
function Stat({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Tab({ id, active, setActive, children }: { id: string; active: string; setActive: (value: string) => void; children: string }) { return <button type="button" role="tab" aria-selected={active === id} className={`workspace-tab ${active === id ? "selected" : ""}`} onClick={() => setActive(id)}>{children}</button>; }
