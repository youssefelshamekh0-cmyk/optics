"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Customer = { id: string; full_name: string; phone: string | null };
type Branch = { id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE" };
type Prescription = { id: string; exam_date: string; optometrist: string | null; right_sphere: number | null; right_cylinder: number | null; right_axis: number | null; right_add: number | null; left_sphere: number | null; left_cylinder: number | null; left_axis: number | null; left_add: number | null; pupil_distance: number | null; notes: string | null };
type Service = { id: string; service_type: string; status: string; issue: string; warranty_until: string | null; expected_at: string | null; notes: string | null; created_at: string; sales?: { invoice_number: number } | null };
type Reminder = { id: string; reminder_type: string; status: string; due_at: string; message: string; completed_at: string | null };
type Data = { prescriptions: Prescription[]; services: Service[]; reminders: Reminder[] };
const emptyData: Data = { prescriptions: [], services: [], reminders: [] };
const serviceLabels: Record<string,string> = { warranty: "ضمان", repair: "صيانة", maintenance: "خدمة دورية", replacement: "استبدال" };
const serviceStatusLabels: Record<string,string> = { received: "تم الاستلام", diagnosing: "قيد الفحص", awaiting_parts: "بانتظار قطع غيار", ready: "جاهز", delivered: "تم التسليم", cancelled: "ملغي" };
const reminderLabels: Record<string,string> = { follow_up: "متابعة عميل", annual_exam: "كشف سنوي", ready_order: "طلب جاهز", payment_followup: "متابعة مديونية", warranty_followup: "متابعة ضمان" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(new Date(value));
const datetimeLabel = (value: string) => new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function CustomerCarePanel({ customers, branches, branchIds, isOwner, canManage }: { customers: Customer[]; branches: Branch[]; branchIds: string[]; isOwner: boolean; canManage: boolean }) {
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState(isOwner ? "" : branchIds[0] ?? "");
  const [data, setData] = useState<Data>(emptyData);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exam, setExam] = useState({ examDate: new Date().toISOString().slice(0,10), optometrist: "", rightSphere: "", rightCylinder: "", rightAxis: "", rightAdd: "", leftSphere: "", leftCylinder: "", leftAxis: "", leftAdd: "", pupilDistance: "", notes: "" });
  const [service, setService] = useState({ serviceType: "warranty", saleInvoiceNumber: "", issue: "", warrantyUntil: "", expectedAt: "", notes: "" });
  const [reminder, setReminder] = useState({ reminderType: "follow_up", dueAt: "", message: "" });

  const refresh = useCallback(async () => {
    if (!customerId) { setData(emptyData); return; }
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/customer-care?customerId=" + encodeURIComponent(customerId), { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "تعذر تحميل ملف العميل");
      setData(result as Data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحميل ملف العميل"); }
    finally { setLoading(false); }
  }, [customerId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent, body: Record<string, unknown>, reset: () => void) {
    event.preventDefault();
    if (!customerId) { setError("اختر العميل أولًا"); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/customer-care", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, customerId, branchId: branchId || null }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "تعذر حفظ السجل");
      reset(); setNotice("تم حفظ السجل"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر حفظ السجل"); }
    finally { setBusy(false); }
  }
  async function updateStatus(kind: "service" | "reminder", recordId: string, status: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/customer-care", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update_status", kind, recordId, status }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "تعذر تحديث الحالة");
      setNotice("تم تحديث الحالة"); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تحديث الحالة"); }
    finally { setBusy(false); }
  }
  const selected = customers.find((customer) => customer.id === customerId);

  return <section className="panel">
    <div className="section-heading"><div><p className="eyebrow">ملف العميل وسجل المتابعة</p><h2>الكشوف السابقة والضمان والصيانة</h2></div></div>
    <div className="customer-fields">
      <label>اختيار العميل<select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">اختر عميلًا</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.full_name}{customer.phone ? " — " + customer.phone : ""}</option>)}</select></label>
      {isOwner && <label>الفرع المرتبط بالسجل<select value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">بدون تحديد فرع</option>{branches.filter((branch) => branch.status === "ACTIVE").map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
    {!customerId && <p className="footnote">اختر عميلًا لعرض تاريخ قياس النظر والضمان والصيانة والتذكيرات.</p>}
    {customerId && <>
      <h3>سجل قياس النظر</h3>
      {canManage && <form className="customer-form" onSubmit={(event) => void submit(event, { kind: "prescription", ...exam, rightSphere: exam.rightSphere === "" ? null : Number(exam.rightSphere), rightCylinder: exam.rightCylinder === "" ? null : Number(exam.rightCylinder), rightAxis: exam.rightAxis === "" ? null : Number(exam.rightAxis), rightAdd: exam.rightAdd === "" ? null : Number(exam.rightAdd), leftSphere: exam.leftSphere === "" ? null : Number(exam.leftSphere), leftCylinder: exam.leftCylinder === "" ? null : Number(exam.leftCylinder), leftAxis: exam.leftAxis === "" ? null : Number(exam.leftAxis), leftAdd: exam.leftAdd === "" ? null : Number(exam.leftAdd), pupilDistance: exam.pupilDistance === "" ? null : Number(exam.pupilDistance) }, () => setExam({ examDate: new Date().toISOString().slice(0,10), optometrist: "", rightSphere: "", rightCylinder: "", rightAxis: "", rightAdd: "", leftSphere: "", leftCylinder: "", leftAxis: "", leftAdd: "", pupilDistance: "", notes: "" }))}>
        <div className="customer-fields"><label>تاريخ الكشف<input type="date" required value={exam.examDate} onChange={(e)=>setExam({...exam,examDate:e.target.value})}/></label><label>أخصائي/محرر الكشف<input maxLength={160} value={exam.optometrist} onChange={(e)=>setExam({...exam,optometrist:e.target.value})}/></label>
        <label>اليمنى SPH<input type="number" step="0.25" min="-30" max="30" value={exam.rightSphere} onChange={(e)=>setExam({...exam,rightSphere:e.target.value})}/></label><label>اليمنى CYL<input type="number" step="0.25" min="-20" max="20" value={exam.rightCylinder} onChange={(e)=>setExam({...exam,rightCylinder:e.target.value})}/></label><label>اليمنى AXIS<input type="number" min="0" max="180" value={exam.rightAxis} onChange={(e)=>setExam({...exam,rightAxis:e.target.value})}/></label><label>اليمنى ADD<input type="number" step="0.25" min="-10" max="10" value={exam.rightAdd} onChange={(e)=>setExam({...exam,rightAdd:e.target.value})}/></label>
        <label>اليسرى SPH<input type="number" step="0.25" min="-30" max="30" value={exam.leftSphere} onChange={(e)=>setExam({...exam,leftSphere:e.target.value})}/></label><label>اليسرى CYL<input type="number" step="0.25" min="-20" max="20" value={exam.leftCylinder} onChange={(e)=>setExam({...exam,leftCylinder:e.target.value})}/></label><label>اليسرى AXIS<input type="number" min="0" max="180" value={exam.leftAxis} onChange={(e)=>setExam({...exam,leftAxis:e.target.value})}/></label><label>اليسرى ADD<input type="number" step="0.25" min="-10" max="10" value={exam.leftAdd} onChange={(e)=>setExam({...exam,leftAdd:e.target.value})}/></label><label>PD المسافة بين الحدقتين<input type="number" step="0.5" min="0" max="100" value={exam.pupilDistance} onChange={(e)=>setExam({...exam,pupilDistance:e.target.value})}/></label><label>ملاحظات الكشف<textarea rows={2} maxLength={2000} value={exam.notes} onChange={(e)=>setExam({...exam,notes:e.target.value})}/></label><button className="primary" disabled={busy}>حفظ الكشف</button></div>
      </form>}
      <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>العين اليمنى</th><th>العين اليسرى</th><th>PD</th><th>الملاحظات</th></tr></thead><tbody>{data.prescriptions.map((p)=><tr key={p.id}><td>{dateLabel(p.exam_date)}<small>{p.optometrist || "—"}</small></td><td>{[["SPH",p.right_sphere],["CYL",p.right_cylinder],["AXIS",p.right_axis],["ADD",p.right_add]].map(([label,value])=>label+": "+(value ?? "—")).join(" · ")}</td><td>{[["SPH",p.left_sphere],["CYL",p.left_cylinder],["AXIS",p.left_axis],["ADD",p.left_add]].map(([label,value])=>label+": "+(value ?? "—")).join(" · ")}</td><td>{p.pupil_distance ?? "—"}</td><td>{p.notes || "—"}</td></tr>)}{!data.prescriptions.length && <tr><td colSpan={5} className="table-empty">لا يوجد كشف سابق مسجل.</td></tr>}</tbody></table></div>

      <h3>الضمان والصيانة والاستبدال</h3>
      {canManage && <form className="customer-form" onSubmit={(event) => void submit(event, { kind: "service", serviceType: service.serviceType, saleInvoiceNumber: service.saleInvoiceNumber === "" ? null : Number(service.saleInvoiceNumber), issue: service.issue, warrantyUntil: service.warrantyUntil || null, expectedAt: service.expectedAt ? new Date(service.expectedAt).toISOString() : null, notes: service.notes }, () => setService({ serviceType: "warranty", saleInvoiceNumber: "", issue: "", warrantyUntil: "", expectedAt: "", notes: "" }))}>
        <div className="customer-fields"><label>نوع الطلب<select value={service.serviceType} onChange={(e)=>setService({...service,serviceType:e.target.value})}><option value="warranty">ضمان</option><option value="repair">صيانة</option><option value="maintenance">خدمة دورية</option><option value="replacement">استبدال</option></select></label><label>رقم الفاتورة الأصلية (اختياري)<input type="number" min="1" value={service.saleInvoiceNumber} onChange={(e)=>setService({...service,saleInvoiceNumber:e.target.value})} placeholder="رقم الفاتورة"/></label><label>تاريخ انتهاء الضمان<input type="date" value={service.warrantyUntil} onChange={(e)=>setService({...service,warrantyUntil:e.target.value})}/></label><label>موعد التسليم المتوقع<input type="datetime-local" value={service.expectedAt} onChange={(e)=>setService({...service,expectedAt:e.target.value})}/></label><label>وصف المشكلة/الخدمة<textarea required minLength={3} maxLength={1000} rows={2} value={service.issue} onChange={(e)=>setService({...service,issue:e.target.value})}/></label><label>ملاحظات<textarea rows={2} maxLength={2000} value={service.notes} onChange={(e)=>setService({...service,notes:e.target.value})}/></label><button className="primary" disabled={busy}>تسجيل طلب الخدمة</button></div>
      </form>}
      <div className="table-wrap"><table><thead><tr><th>النوع</th><th>المشكلة</th><th>الحالة</th><th>الضمان/الموعد</th><th>إجراء</th></tr></thead><tbody>{data.services.map((item)=><tr key={item.id}><td>{serviceLabels[item.service_type] ?? item.service_type}<small>{item.sales?.invoice_number ? "فاتورة #" + item.sales.invoice_number : "بدون فاتورة مرتبطة"}</small></td><td>{item.issue}<small>{item.notes || ""}</small></td><td>{serviceStatusLabels[item.status] ?? item.status}</td><td>{item.warranty_until || "—"}<small>{item.expected_at ? datetimeLabel(item.expected_at) : ""}</small></td><td>{canManage && <select aria-label="تحديث حالة الخدمة" disabled={busy} value={item.status} onChange={(e)=>void updateStatus("service",item.id,e.target.value)}>{Object.entries(serviceStatusLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>}</td></tr>)}{!data.services.length && <tr><td colSpan={5} className="table-empty">لا توجد طلبات ضمان أو صيانة.</td></tr>}</tbody></table></div>

      <h3>تذكيرات العميل</h3>
      {canManage && <form className="customer-form" onSubmit={(event) => void submit(event, { kind: "reminder", reminderType: reminder.reminderType, dueAt: new Date(reminder.dueAt).toISOString(), message: reminder.message }, () => setReminder({ reminderType: "follow_up", dueAt: "", message: "" }))}>
        <div className="customer-fields"><label>نوع التذكير<select value={reminder.reminderType} onChange={(e)=>setReminder({...reminder,reminderType:e.target.value})}>{Object.entries(reminderLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>موعد التذكير<input type="datetime-local" required value={reminder.dueAt} onChange={(e)=>setReminder({...reminder,dueAt:e.target.value})}/></label><label>رسالة المتابعة<textarea required minLength={2} maxLength={1000} rows={2} value={reminder.message} onChange={(e)=>setReminder({...reminder,message:e.target.value})}/></label><button className="primary" disabled={busy}>حفظ التذكير</button></div>
      </form>}
      <div className="table-wrap"><table><thead><tr><th>الموعد</th><th>النوع</th><th>الرسالة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{data.reminders.map((item)=><tr key={item.id}><td>{datetimeLabel(item.due_at)}</td><td>{reminderLabels[item.reminder_type] ?? item.reminder_type}</td><td>{item.message}</td><td>{item.status === "completed" ? "تم" : item.status === "cancelled" ? "ملغي" : "معلق"}</td><td>{canManage && item.status === "pending" && <button className="row-action" disabled={busy} onClick={()=>void updateStatus("reminder",item.id,"completed")}>تمت المتابعة</button>}</td></tr>)}{!data.reminders.length && <tr><td colSpan={5} className="table-empty">لا توجد تذكيرات مسجلة.</td></tr>}</tbody></table></div>
      {loading && <p className="footnote">جارٍ تحديث ملف العميل…</p>}
    </>}
  </section>;
}
