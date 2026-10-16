// شغّله من جذر المشروع:  node apply-finance-charts.mjs
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");
const eolOf = (s) => (s.includes("\r\n") ? "\r\n" : "\n");

if (!fs.existsSync("src/components/finance-charts.tsx")) {
  console.error("❌ ملف src/components/finance-charts.tsx مش موجود. حطه الأول.");
  process.exit(1);
}

// 1) workspace.tsx
const wp = "src/components/workspace.tsx";
let w = read(wp), eol = eolOf(w), changed = false;
if (!w.includes("finance-charts")) {
  const imp = 'import OperationsSection from "@/components/operations-section";';
  if (!w.includes(imp)) { console.error("❌ مش لاقي سطر import بتاع OperationsSection في workspace.tsx"); process.exit(1); }
  w = w.replace(imp, imp + eol + 'import FinanceCharts from "@/components/finance-charts";');
  changed = true;
}
if (!w.includes("<FinanceCharts")) {
  const i = w.indexOf('<Stat label="فريق العمل"');
  const j = i === -1 ? -1 : w.indexOf("</section>", i);
  if (j === -1) { console.error('❌ مش لاقي مكان الكروت (Stat label="فريق العمل") في workspace.tsx'); process.exit(1); }
  const k = j + "</section>".length;
  w = w.slice(0, k) + eol + "    <FinanceCharts />" + w.slice(k);
  changed = true;
}
if (changed) { fs.writeFileSync(wp, w); console.log("✅ تم تعديل workspace.tsx"); } else console.log("• workspace.tsx جاهز من قبل");

// 2) globals.css
const cp = "src/app/globals.css";
let c = read(cp);
if (!c.includes(".fin-kpis")) {
  const css = fs.readFileSync(new URL("./finance-charts.css", import.meta.url), "utf8").trim();
  c = c.replace(/\s*$/, "") + eolOf(c) + css + eolOf(c);
  fs.writeFileSync(cp, c); console.log("✅ تم إضافة CSS في globals.css");
} else console.log("• globals.css جاهز من قبل");
console.log("خلصنا. شغّل: npm run dev");
