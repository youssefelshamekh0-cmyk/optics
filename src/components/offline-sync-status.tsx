"use client";

import { useCallback, useEffect, useState } from "react";
import { clearSyncedOfflineOperations, offlineOperations, offlineSummary, registerOfflineSync, retryOfflineOperation, setOfflineActor, type OfflineSaleOperation, type OfflineSummary } from "@/lib/offline-sync";

const labels: Record<OfflineSaleOperation["status"], string> = {
  pending: "بانتظار المزامنة",
  syncing: "جارٍ المزامنة",
  conflict: "تعارض يحتاج مراجعة",
  rejected: "مرفوضة وتحتاج مراجعة",
  synced: "تمت المزامنة",
};

export default function OfflineSyncStatus() {
  const [summary, setSummary] = useState<OfflineSummary | null>(null);
  const [operations, setOperations] = useState<OfflineSaleOperation[]>([]);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    const [nextSummary, nextOperations] = await Promise.all([offlineSummary(), offlineOperations()]);
    setSummary(nextSummary);
    setOperations(nextOperations.filter(x => x.status !== "synced" || expanded).slice(-30).reverse());
  }, [expanded]);

  useEffect(() => {
    let alive = true;
    const identify = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (alive && typeof data.user?.id === "string") setOfflineActor(data.user.id);
      } catch { /* Keep the last user scope for this already-authenticated offline session. */ }
    };
    void identify().then(refresh);
    const unregister = registerOfflineSync();
    const onChange = () => { void refresh(); };
    window.addEventListener("nazra:sync-state", onChange);
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    const timer = window.setInterval(onChange, 5000);
    return () => {
      alive = false;
      unregister();
      window.removeEventListener("nazra:sync-state", onChange);
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  if (!summary || (summary.pending === 0 && summary.conflicts === 0 && summary.rejected === 0 && summary.synced === 0 && summary.online)) return null;
  const hasIssues = summary.conflicts + summary.rejected > 0;
  return <aside aria-label="حالة المزامنة" style={{
    position: "fixed", zIndex: 120, insetInlineStart: 12, bottom: 12, width: "min(420px, calc(100vw - 24px))",
    background: "#fff", color: "#172b27", border: "1px solid #cbd8d4", borderRadius: 14,
    boxShadow: "0 8px 30px rgba(10,35,30,.16)", padding: 12, fontSize: 13,
  }}>
    <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={expanded} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%",
      background: "transparent", border: 0, padding: 0, color: "inherit", cursor: "pointer", textAlign: "start",
    }}>
      <strong>{summary.online ? "مزامنة البيانات" : "أنت تعمل بدون إنترنت"}</strong>
      <span>{summary.pending ? String(summary.pending) + " معلقة" : " "}{hasIssues ? " · " + String(summary.conflicts + summary.rejected) + " للمراجعة" : ""}　{expanded ? "−" : "+"}</span>
    </button>
    {!summary.online && <p style={{ margin: "8px 0 0", color: "#7a4a00" }}>الفواتير الجديدة تُحفظ محليًا وتظل غير معتمدة حتى نجاح المزامنة. احتفظ بالجهاز مفتوحًا ولا تمسح بيانات المتصفح.</p>}
    {hasIssues && <p role="alert" style={{ margin: "8px 0 0", color: "#a02b2b" }}>توجد عمليات لم تُعتمد. راجع سبب التعارض قبل إعادة المحاولة.</p>}
    {expanded && <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <span>معلقة: {summary.pending}</span><span>تعارض: {summary.conflicts}</span><span>مرفوضة: {summary.rejected}</span><span>مزامنة ناجحة: {summary.synced}</span>
      </div>
      <div style={{ maxHeight: 240, overflow: "auto", marginTop: 8 }}>
        {operations.map(operation => <div key={operation.id} style={{ borderTop: "1px solid #e5ece9", padding: "9px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>{operation.result?.invoiceNumber ? "فاتورة #" + String(operation.result.invoiceNumber) : "فاتورة محفوظة محليًا"}</strong>
            <span>{labels[operation.status]}</span>
          </div>
          <small>{operation.message ?? "سيتم إرسال العملية بنفس رقم التعريف لمنع تكرار الفاتورة."}</small>
          {(operation.status === "conflict" || operation.status === "rejected") && <div style={{ marginTop: 6 }}>
            <button type="button" onClick={() => void retryOfflineOperation(operation.id).then(refresh)} disabled={!summary.online}>إعادة المحاولة</button>
          </div>}
        </div>)}
        {!operations.length && <p>لا توجد عمليات في قائمة المزامنة.</p>}
      </div>
      {summary.synced > 0 && <button type="button" onClick={() => void clearSyncedOfflineOperations().then(refresh)} style={{ marginTop: 8 }}>مسح العمليات المكتملة من القائمة</button>}
    </>}
  </aside>;
}
