"use client";

import { useCallback, useEffect, useState } from "react";

type Check = { key: string; label: string; status: "ok" | "warning" | "error"; detail: string; count?: number };
type Report = { checkedAt: string; status: "ok" | "warning" | "error"; checks: Check[]; scopeNote: string };

const statusLabel = { ok: "سليم", warning: "يحتاج مراجعة", error: "خطأ" } as const;
const statusClass = { ok: "active", warning: "pending", error: "inactive" } as const;

export default function SystemHealthPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/system-health", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "تعذر تحميل فحوصات النظام");
      setReport(data as Report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل فحوصات النظام");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <section className="panel">
    <div className="section-heading">
      <div><p className="eyebrow">فحوصات قراءة فقط</p><h2>صحة النظام وسلامة البيانات</h2></div>
      <button className="quiet" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "جارٍ الفحص…" : "إعادة الفحص"}</button>
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {report && <>
      <p className="muted">آخر فحص: {new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.checkedAt))}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>الفحص</th><th>النتيجة</th><th>العدد</th><th>التفاصيل</th></tr></thead>
        <tbody>{report.checks.map((check) => <tr key={check.key}>
          <td><strong>{check.label}</strong></td>
          <td><span className={`status ${statusClass[check.status]}`}>{statusLabel[check.status]}</span></td>
          <td>{check.count === undefined ? "—" : new Intl.NumberFormat("ar-EG").format(check.count)}</td>
          <td>{check.detail}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="footnote">{report.scopeNote}</p>
    </>}
  </section>;
}
