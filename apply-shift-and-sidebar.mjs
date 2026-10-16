// شغّله من جذر المشروع:  node apply-shift-and-sidebar.mjs
import fs from "node:fs";
const read = (p) => fs.readFileSync(p, "utf8");
const eolOf = (s) => (s.includes("\r\n") ? "\r\n" : "\n");
const fail = (m) => { console.error("❌ " + m); process.exit(1); };

if (!fs.existsSync("src/components/shift-panel.tsx")) fail("ملف src/components/shift-panel.tsx مش موجود. حطه الأول.");

// 1) workspace.tsx
{
  const p = "src/components/workspace.tsx"; let t = read(p), eol = eolOf(t), ch = false;
  if (!t.includes("shift-panel")) {
    const imp = 'import FinanceCharts from "@/components/finance-charts";';
    if (!t.includes(imp)) fail("مش لاقي import بتاع FinanceCharts. شغّل apply-finance-charts.mjs الأول.");
    t = t.replace(imp, imp + eol + 'import ShiftPanel from "@/components/shift-panel";'); ch = true;
  }
  if (!t.includes("<ShiftPanel")) {
    if (!t.includes("<FinanceCharts />")) fail("مش لاقي <FinanceCharts /> في workspace.tsx");
    t = t.replace("<FinanceCharts />", "<ShiftPanel />" + eol + "    <FinanceCharts />"); ch = true;
  }
  if (ch) { fs.writeFileSync(p, t); console.log("✅ workspace.tsx"); } else console.log("• workspace.tsx جاهز من قبل");
}

// 2) api/sales/route.ts
{
  const p = "src/app/api/sales/route.ts"; let t = read(p), eol = eolOf(t);
  if (!t.includes("seller shift required")) {
    const anchor = '  if (error) return Response.json({ error: "تعذر إنشاء الفاتورة. راجع المبالغ والبنود." }, { status: 400 });';
    if (!t.includes(anchor)) fail("مش لاقي سطر رسالة الخطأ في api/sales/route.ts");
    const add = '  if (error?.message.includes("seller shift required")) return Response.json({ error: "افتح وردية أولاً من تبويب نظرة عامة قبل تسجيل الفواتير" }, { status: 409 });';
    t = t.replace(anchor, add + eol + anchor); fs.writeFileSync(p, t); console.log("✅ api/sales/route.ts");
  } else console.log("• api/sales/route.ts جاهز من قبل");
}

// 3) globals.css
{
  const p = "src/app/globals.css"; let c = read(p), eol = eolOf(c), ch = false;
  const SHIFT = `.shift-form{display:grid;gap:10px;max-width:420px}.shift-form label{display:grid;gap:5px;font-size:11px;color:var(--muted)}`;
  const SIDE = `@media(min-width:861px){.app-shell{max-width:1320px;display:grid;grid-template-columns:210px minmax(0,1fr);column-gap:24px;align-items:start}.app-shell>*{grid-column:2;min-width:0}.app-shell>.topbar{grid-column:1/-1}.app-shell>.workspace-tabs{grid-column:1;grid-row:2/span 200;position:sticky;top:12px;align-self:start;flex-direction:column;gap:4px;overflow-x:hidden;overflow-y:auto;max-height:calc(100vh - 24px);padding:14px 0 14px 14px;border-bottom:0;border-left:1px solid var(--line)}.workspace-tabs .workspace-tab{width:100%;text-align:right;white-space:normal;padding:11px 14px;font-size:12px}}`;
  if (!c.includes(".shift-form")) { c = c.replace(/\s*$/, "") + eol + SHIFT + eol; ch = true; }
  if (!c.includes("grid-row:2/span 200")) { c = c.replace(/\s*$/, "") + eol + SIDE + eol; ch = true; }
  if (ch) { fs.writeFileSync(p, c); console.log("✅ globals.css"); } else console.log("• globals.css جاهز من قبل");
}
console.log("خلصنا. شغّل: npm run dev");
