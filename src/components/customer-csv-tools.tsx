"use client";

import { useState } from "react";

type Customer = { full_name: string; phone: string | null; email: string | null; notes: string | null };
type ImportRow = { line: number; name: string; phone: string; email: string; notes: string };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && quoted && input[i + 1] === '"') { field += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("الملف يحتوي على علامة اقتباس غير مكتملة.");
  return rows;
}
function csvCell(value: unknown) { return '"' + String(value ?? "").replace(/"/g, '""') + '"'; }

export default function CustomerCsvTools({ customers, canManage, onImported }: { customers: Customer[]; canManage: boolean; onImported: () => Promise<void> }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function exportCsv() {
    const header = ["name", "phone", "email", "notes"];
    const data = customers.map((customer) => [customer.full_name, customer.phone, customer.email, customer.notes]);
    const csv = "\uFEFF" + [header, ...data].map((values) => values.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "nazra-customers.csv"; link.click();
    URL.revokeObjectURL(url);
  }

  async function readFile(file?: File) {
    setError(""); setNotice(""); setRows([]);
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error("الملف فارغ أو لا يحتوي صفوف بيانات.");
      const headers = parsed[0].map((value) => value.trim().toLowerCase());
      const find = (names: string[]) => headers.findIndex((value) => names.includes(value));
      const nameIndex = find(["name", "full_name", "الاسم", "اسم العميل"]);
      if (nameIndex < 0) throw new Error("يجب أن يحتوي الصف الأول على عمود name أو full_name أو الاسم.");
      const phoneIndex = find(["phone", "mobile", "رقم الموبايل", "الهاتف"]);
      const emailIndex = find(["email", "البريد"]);
      const notesIndex = find(["notes", "ملاحظات"]);
      const result = parsed.slice(1).map((values, index) => ({
        line: index + 2,
        name: (values[nameIndex] ?? "").trim(),
        phone: phoneIndex < 0 ? "" : (values[phoneIndex] ?? "").trim(),
        email: emailIndex < 0 ? "" : (values[emailIndex] ?? "").trim(),
        notes: notesIndex < 0 ? "" : (values[notesIndex] ?? "").trim(),
      })).filter((value) => value.name);
      if (!result.length) throw new Error("لم يتم العثور على أسماء عملاء صالحة.");
      if (result.length > 500) throw new Error("الحد الأقصى للاستيراد 500 عميل في الملف الواحد.");
      setRows(result);
      setNotice("تمت قراءة " + result.length + " صفًا. راجع المعاينة قبل بدء الاستيراد.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر قراءة الملف"); }
  }

  async function importRows() {
    setBusy(true); setError(""); setNotice("");
    let created = 0, skipped = 0, failed = 0;
    for (const row of rows) {
      try {
        const response = await fetch("/api/customers", {
          method: "POST", cache: "no-store", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: row.name, phone: row.phone, email: row.email, notes: row.notes, operationId: crypto.randomUUID() }),
        });
        if (response.ok) created++;
        else if (response.status === 409) skipped++;
        else failed++;
      } catch { failed++; }
    }
    setBusy(false); setRows([]);
    setNotice("اكتمل الاستيراد: " + created + " إضافة، " + skipped + " مكرر تم تخطيه، " + failed + " فشل. راجع الملف الأصلي للصفوف التي فشلت.");
    await onImported();
  }

  return <div className="customer-toolbar">
    <button type="button" className="quiet" onClick={exportCsv}>تصدير Excel/CSV</button>
    {canManage && <label className="quiet">استيراد CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>}
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {rows.length > 0 && <div className="panel">
      <p>معاينة الاستيراد: {rows.length} صفًا. يُتخطى رقم الموبايل المكرر.</p>
      <div className="table-wrap"><table><thead><tr><th>السطر</th><th>الاسم</th><th>الموبايل</th><th>البريد</th></tr></thead>
        <tbody>{rows.slice(0, 5).map((row) => <tr key={row.line}><td>{row.line}</td><td>{row.name}</td><td>{row.phone || "—"}</td><td>{row.email || "—"}</td></tr>)}</tbody>
      </table></div>
      <button className="primary" type="button" disabled={busy} onClick={() => void importRows()}>{busy ? "جارٍ الاستيراد…" : "تأكيد الاستيراد"}</button>
      <button className="quiet" type="button" disabled={busy} onClick={() => setRows([])}>إلغاء</button>
    </div>}
  </div>;
}
