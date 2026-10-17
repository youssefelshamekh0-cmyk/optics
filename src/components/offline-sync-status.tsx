"use client";

import { useCallback, useEffect, useState } from "react";
import { clearSyncedOfflineOperations, offlineOperations, offlineSummary, registerOfflineSync, retryOfflineOperation, reviseOfflineSale, setOfflineActor, type OfflineQueueOperation, type OfflineSummary } from "@/lib/offline-sync";

const labels: Record<OfflineQueueOperation["status"], string> = {
  pending: "بانتظار المزامنة", syncing: "جارٍ المزامنة", conflict: "تعارض يحتاج مراجعة",
  rejected: "مرفوضة وتحتاج مراجعة", synced: "تمت المزامنة",
};
type DraftItem = { name: string; quantity: string; productId?: string | null; itemKind?: string };
type Draft = { finalTotal: string; items: DraftItem[] };

export default function OfflineSyncStatus() {
  const [summary, setSummary] = useState<OfflineSummary | null>(null);
  const [operations, setOperations] = useState<OfflineQueueOperation[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      } catch { /* Keep local session scope for an authenticated offline session. */ }
    };
    void identify().then(refresh);
    const unregister = registerOfflineSync();
    const onChange = () => { void refresh(); };
    window.addEventListener("nazra:sync-state", onChange);
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    const timer = window.setInterval(onChange, 5000);
    return () => {
      alive = false; unregister();
      window.removeEventListener("nazra:sync-state", onChange);
      window.removeEventListener("online", onChange);
      window.removeEventListener("offline", onChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  function draftFor(operation: OfflineQueueOperation): Draft {
    const saved = drafts[operation.id];
    if (saved) return saved;
    const rawItems = Array.isArray(operation.payload.items) ? operation.payload.items as Array<Record<string, unknown>> : [];
    return {
      finalTotal: String(operation.payload.finalTotal ?? ""),
      items: rawItems.map(item => ({
        name: String(item.name ?? ""), quantity: String(item.quantity ?? "1"),
        productId: typeof item.productId === "string" ? item.productId : null,
        itemKind: typeof item.itemKind === "string" ? item.itemKind : "product",
      })),
    };
  }

  if (!summary || (summary.pending === 0 && summary.conflicts === 0 && summary.rejected === 0 && summary.synced === 0 && summary.online)) return null;
  const hasIssues = summary.conflicts + summary.rejected > 0;
  return <aside aria-label="حالة المزامنة" style={{
    position: "fixed", zIndex: 120, insetInlineStart: 12, bottom: 12, width: "min(460px, calc(100vw - 24px))",
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
    {!summary.online && <p style={{ margin: "8px 0 0", color: "#7a4a00" }}>الفواتير والعملاء المحفوظون محليًا لا يُعتمدون حتى نجاح المزامنة. لا تمسح بيانات المتصفح قبل اكتمالها.</p>}
    {hasIssues && <p role="alert" style={{ margin: "8px 0 0", color: "#a02b2b" }}>توجد عمليات لم تُعتمد. راجع السبب والكمية قبل إعادة المحاولة.</p>}
    {expanded && <>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <span>معلقة: {summary.pending}</span><span>تعارض: {summary.conflicts}</span><span>مرفوضة: {summary.rejected}</span><span>مزامنة ناجحة: {summary.synced}</span>
      </div>
      <div style={{ maxHeight: "min(60vh, 520px)", overflow: "auto", marginTop: 8 }}>
        {operations.map(operation => <div key={operation.id} style={{ borderTop: "1px solid #e5ece9", padding: "9px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <strong>{operation.type === "customer.create" ? "عميل جديد" : operation.result?.invoiceNumber ? "فاتورة #" + String(operation.result.invoiceNumber) : "فاتورة محفوظة محليًا"}</strong>
            <span>{labels[operation.status]}</span>
          </div>
          <small>{operation.message ?? "تتم إعادة المحاولة بنفس معرّف العملية لمنع التكرار."}</small>
          {operation.type === "sale.create" && (operation.status === "conflict" || operation.status === "rejected") && <>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <label>سعر البيع النهائي
                <input type="number" min="0.01" step="0.01" value={draftFor(operation).finalTotal}
                  onChange={event => setDrafts(old => ({ ...old, [operation.id]: { ...draftFor(operation), finalTotal: event.target.value } }))}
                  style={{ display: "block", width: "100%", marginTop: 3 }} />
              </label>
              {draftFor(operation).items.map((item, index) => <label key={index}>{item.name || "بند"} — الكمية
                <input type="number" min="1" max="100" step="1" value={item.quantity}
                  onChange={event => setDrafts(old => {
                    const current = draftFor(operation);
                    return { ...old, [operation.id]: { ...current, items: current.items.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row) } };
                  })} style={{ display: "block", width: "100%", marginTop: 3 }} />
              </label>)}
              {errors[operation.id] && <p role="alert" style={{ color: "#a02b2b", margin: 0 }}>{errors[operation.id]}</p>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => {
                  const draft = draftFor(operation);
                  void reviseOfflineSale(operation.id, { finalTotal: Number(draft.finalTotal), items: draft.items.map(item => ({ ...item, quantity: Number(item.quantity) })) })
                    .then(() => { setErrors(old => ({ ...old, [operation.id]: "" })); return refresh(); })
                    .catch(error => setErrors(old => ({ ...old, [operation.id]: error instanceof Error ? error.message : "تعذر حفظ التعديلات" })));
                }}>حفظ التعديلات</button>
                <button type="button" onClick={() => void retryOfflineOperation(operation.id).then(refresh)} disabled={!summary.online}>إعادة المحاولة</button>
              </div>
              <small>تعديل الكمية لا يضمن توافر المخزون؛ الخادم يعيد التحقق قبل اعتماد الفاتورة.</small>
            </div>
          </>}
          {operation.type === "customer.create" && operation.status === "conflict" && <p>راجع رقم الهاتف؛ قد يكون العميل مسجلًا بالفعل. لن تُزامن الفاتورة التابعة حتى حل هذه العملية.</p>}
        </div>)}
        {!operations.length && <p>لا توجد عمليات في قائمة المزامنة.</p>}
      </div>
      {summary.synced > 0 && <button type="button" onClick={() => void clearSyncedOfflineOperations().then(refresh)} style={{ marginTop: 8 }}>مسح العمليات المكتملة من القائمة</button>}
    </>}
  </aside>;
}
