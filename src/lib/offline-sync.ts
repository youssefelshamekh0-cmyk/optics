"use client";

type CachedEntry = { key: string; value: unknown; savedAt: number };
export type OfflineQueueOperation = {
  id: string;
  actorId: string;
  type: "sale.create" | "customer.create";
  url: "/api/sales" | "/api/customers";
  payload: Record<string, unknown> & { operationId: string };
  localCustomerId?: string;
  status: "pending" | "syncing" | "conflict" | "rejected" | "synced";
  createdAt: number;
  updatedAt: number;
  message?: string;
  result?: { saleId?: string; invoiceNumber?: number; customerId?: string };
};
export type OfflineSaleOperation = OfflineQueueOperation;
export type OfflineSummary = { pending: number; conflicts: number; rejected: number; synced: number; online: boolean };

const DB_NAME = "nazra-offline-v1";
const DB_VERSION = 1;
const CACHE_STORE = "response-cache";
const OUTBOX_STORE = "sales-outbox";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let opening: Promise<IDBDatabase> | null = null;
let syncing = false;
let activeActorId: string | null = null;

function storedActorId(): string | null {
  if (activeActorId) return activeActorId;
  try { return window.localStorage.getItem("nazra-offline-actor"); } catch { return null; }
}

export function setOfflineActor(actorId: string) {
  const next = actorId.trim();
  if (!next) return;
  activeActorId = next;
  try { window.localStorage.setItem("nazra-offline-actor", next); } catch { /* Local storage may be disabled. */ }
  notify();
}

export function clearOfflineActor() {
  activeActorId = null;
  try { window.localStorage.removeItem("nazra-offline-actor"); } catch { /* Local storage may be disabled. */ }
  try { navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_SHELL" }); void navigator.serviceWorker?.getRegistration().then(registration => registration?.active?.postMessage({ type: "CLEAR_PRIVATE_SHELL" })); } catch { /* Service worker may not be available. */ }
  notify();
}

async function refreshOfflineActor(): Promise<string | null> {
  if (typeof navigator === "undefined" || !navigator.onLine) return storedActorId();
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return storedActorId();
    const data = await response.json();
    if (typeof data.user?.id === "string") setOfflineActor(data.user.id);
  } catch { /* Use the previous actor only while continuing an authenticated offline session. */ }
  return storedActorId();
}

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("التخزين المحلي غير متاح على هذا الجهاز"));
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { opening = null; reject(request.error ?? new Error("تعذر فتح التخزين المحلي")); };
    request.onblocked = () => { opening = null; reject(new Error("أغلق نسخة أخرى من التطبيق ثم أعد المحاولة")); };
  });
  return opening;
}

function run<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return database().then(db => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر الوصول إلى التخزين المحلي"));
    transaction.onabort = () => reject(transaction.error ?? new Error("تم إلغاء التخزين المحلي"));
  }));
}

const canCache = (url: URL) => url.origin === window.location.origin && (
  url.pathname === "/api/sales" ||
  url.pathname === "/api/sales/products" ||
  url.pathname === "/api/sales/lens-pricing" ||
  url.pathname === "/api/sales/customers" ||
  url.pathname === "/api/customers"
);

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const actorId = storedActorId();
  if (!actorId) return null;
  try {
    const entry = await run<CachedEntry | undefined>(CACHE_STORE, "readonly", store => store.get(actorId + ":" + key));
    if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.value as T;
  } catch { return null; }
}

async function cacheJson(key: string, value: unknown) {
  const actorId = storedActorId();
  if (!actorId) return;
  const scopedKey = actorId + ":" + key;
  try { await run(CACHE_STORE, "readwrite", store => store.put({ key: scopedKey, value, savedAt: Date.now() } satisfies CachedEntry)); }
  catch { /* Cache failures must not fail an online request. */ }
}

async function getOutbox(): Promise<OfflineQueueOperation[]> {
  try { return await run<OfflineQueueOperation[]>(OUTBOX_STORE, "readonly", store => store.getAll()); }
  catch { return []; }
}

async function getActorOutbox(): Promise<OfflineQueueOperation[]> {
  const actorId = storedActorId();
  if (!actorId) return [];
  return (await getOutbox()).filter(operation => operation.actorId === actorId).sort((a,b) => a.createdAt-b.createdAt);
}

async function putOperation(operation: OfflineQueueOperation) {
  await run(OUTBOX_STORE, "readwrite", store => store.put(operation));
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nazra:sync-state"));
}

export async function offlineOperations(): Promise<OfflineQueueOperation[]> { return getActorOutbox(); }

async function localCustomerRows(query: string): Promise<Array<{ id: string; full_name: string; phone: string; email: string }>> {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 1) return [];
  const operations = await getActorOutbox();
  return operations.filter(item => item.type === "customer.create" && item.localCustomerId)
    .map(item => ({
      id: item.status === "synced" && item.result?.customerId ? item.result.customerId : item.localCustomerId!,
      full_name: String(item.payload.name ?? ""),
      phone: String(item.payload.phone ?? ""),
      email: String(item.payload.email ?? ""),
    }))
    .filter(customer => !normalized || customer.full_name.toLocaleLowerCase().includes(normalized) || customer.phone.toLocaleLowerCase().includes(normalized))
    .slice(0,20);
}

async function addLocalCustomerMatches<T>(data: T, query: string): Promise<T> {
  if (typeof data !== "object" || data === null || !("customers" in data) || !Array.isArray((data as { customers?: unknown }).customers)) return data;
  const current = (data as { customers: Array<{ id?: string }> }).customers;
  const local = await localCustomerRows(query);
  const map = new Map<string, any>();
  for (const row of [...current, ...local]) if (typeof row.id === "string") map.set(row.id, row);
  return { ...(data as any), customers: [...map.values()].slice(0, query.trim().length >= 2 ? 20 : 200) } as T;
}

export async function offlineSummary(): Promise<OfflineSummary> {
  const operations = await getActorOutbox();
  return {
    pending: operations.filter(x => x.status === "pending" || x.status === "syncing").length,
    conflicts: operations.filter(x => x.status === "conflict").length,
    rejected: operations.filter(x => x.status === "rejected").length,
    synced: operations.filter(x => x.status === "synced").length,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
  };
}

export async function cachedRequestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const parsedUrl = new URL(url, window.location.origin);
  if ((method === "GET" && canCache(parsedUrl)) || (method === "POST" && ["/api/sales", "/api/customers"].includes(parsedUrl.pathname))) await refreshOfflineActor();
  const cacheable = method === "GET" && canCache(parsedUrl);

  if (method === "POST" && parsedUrl.pathname === "/api/customers") {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const operationId = typeof payload.operationId === "string" ? payload.operationId : crypto.randomUUID();
    const safePayload: Record<string, unknown> & { operationId: string } = { ...payload, operationId };
    const actorId = storedActorId();
    if (!actorId) throw new Error("لا يمكن حفظ العميل دون جلسة مستخدم محفوظة. اتصل بالإنترنت وافتح النظام أولاً.");
    try {
      const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, body: JSON.stringify(safePayload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error ?? "تعذر حفظ العميل"), { status: response.status });
      return data as T;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
      if (status) throw error;
      const localCustomerId = crypto.randomUUID();
      const now = Date.now();
      await putOperation({ id: operationId, actorId, type: "customer.create", url: "/api/customers", payload: safePayload, localCustomerId, status: "pending", createdAt: now, updatedAt: now, message: "عميل محفوظ محليًا؛ سيُنشأ على الخادم قبل مزامنة فواتيره." });
      notify();
      return { queued: true, operationId, customer: { id: localCustomerId, full_name: String(payload.name ?? ""), phone: String(payload.phone ?? ""), email: String(payload.email ?? ""), notes: String(payload.notes ?? "") } } as T;
    }
  }

  if (method === "POST" && parsedUrl.pathname === "/api/sales") {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const operationId = typeof payload.operationId === "string" ? payload.operationId : crypto.randomUUID();
    const safePayload: Record<string, unknown> & { operationId: string } = { ...payload, operationId };
    const actorId = storedActorId();
    if (!actorId) throw new Error("لا يمكن حفظ الفاتورة دون جلسة مستخدم محفوظة. اتصل بالإنترنت وافتح النظام أولاً.");
    const requestInit = { ...init, headers: { "content-type": "application/json", ...init?.headers }, body: JSON.stringify(safePayload) };
    if (parsedUrl.pathname === "/api/sales" && typeof safePayload.customerId === "string") {
      const pendingCustomer = (await getActorOutbox()).find(item =>
        item.type === "customer.create" && item.localCustomerId === safePayload.customerId && item.status !== "synced"
      );
      if (pendingCustomer) {
        if (!safePayload.branchId) throw new Error("لا يمكن حفظ الفاتورة دون فرع محدد");
        const now = Date.now();
        await putOperation({ id: operationId, actorId, type: "sale.create", url: "/api/sales", payload: safePayload, status: "pending", createdAt: now, updatedAt: now, message: "بانتظار مزامنة العميل المحلي أولًا" });
        notify();
        if (navigator.onLine) void syncPendingOperations();
        return { queued: true, operationId, invoiceNumber: null } as T;
      }
    }
    try {
      const response = await fetch(url, requestInit);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error ?? "تعذر إتمام الطلب"), { status: response.status });
      return data as T;
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
      if (status) throw error;
      if (!safePayload.branchId || !safePayload.customerId) throw new Error("لا يمكن حفظ الفاتورة دون فرع وعميل محددين");
      const now = Date.now();
      await putOperation({
        id: operationId, actorId, type: "sale.create", url: "/api/sales",
        payload: safePayload, status: "pending",
        createdAt: now, updatedAt: now,
      });
      notify();
      return { queued: true, operationId, invoiceNumber: null } as T;
    }
  }

  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error ?? "تعذر إتمام الطلب"), { status: response.status });
    if (cacheable) await cacheJson(parsedUrl.pathname + parsedUrl.search, data);
    return parsedUrl.pathname === "/api/sales/customers"
      ? await addLocalCustomerMatches(data as T, parsedUrl.searchParams.get("q") ?? "")
      : data as T;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
    if (status || !cacheable) throw error;
    const cached = await getCachedJson<T>(parsedUrl.pathname + parsedUrl.search);
    if (cached !== null) {
      if (parsedUrl.pathname === "/api/sales/customers") return await addLocalCustomerMatches(cached, parsedUrl.searchParams.get("q") ?? "");
      if (parsedUrl.pathname === "/api/customers" && !parsedUrl.searchParams.has("phone")) return await addLocalCustomerMatches(cached, "");
      return cached;
    }
    if (parsedUrl.pathname === "/api/sales/customers") {
      const customers = await localCustomerRows(parsedUrl.searchParams.get("q") ?? "");
      if (customers.length) return { customers } as T;
    }
    if (parsedUrl.pathname === "/api/customers" && !parsedUrl.searchParams.has("phone")) {
      const customers = await localCustomerRows("");
      if (customers.length) return { customers } as T;
    }
    throw new Error("لا يوجد اتصال ولا توجد نسخة محلية محفوظة لهذه البيانات. اتصل بالإنترنت مرة واحدة لتحميل بيانات الفرع.");
  }
}

export async function syncPendingOperations(): Promise<void> {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine || !storedActorId()) return;
  syncing = true;
  try {
    const operations = (await getActorOutbox()).filter(operation => operation.status === "pending").sort((a, b) => a.type === b.type ? a.createdAt - b.createdAt : a.type === "customer.create" ? -1 : 1);
    for (const queued of operations) {
      const operation = (await getActorOutbox()).find(item => item.id === queued.id);
      if (!operation || operation.status !== "pending") continue;
      if (operation.type === "sale.create" && typeof operation.payload.customerId === "string") {
        const unresolvedCustomer = (await getActorOutbox()).find(item => item.type === "customer.create" && item.localCustomerId === operation.payload.customerId && item.status !== "synced");
        if (unresolvedCustomer) {
          await putOperation({ ...operation, message: "الفاتورة تنتظر مزامنة العميل أولًا.", updatedAt: Date.now() });
          continue;
        }
      }
      const started = { ...operation, status: "syncing" as const, updatedAt: Date.now() };
      await putOperation(started);
      notify();
      let response: Response;
      let data: Record<string, unknown>;
      try {
        response = await fetch(operation.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(operation.payload),
          cache: "no-store",
        });
        data = await response.json().catch(() => ({}));
      } catch {
        await putOperation({ ...operation, status: "pending", updatedAt: Date.now(), message: "بانتظار عودة الاتصال" });
        break;
      }
      if (response.ok) {
        const responseData = data as { saleId?: unknown; invoiceNumber?: unknown; customer?: { id?: unknown; full_name?: unknown; phone?: unknown; email?: unknown; notes?: unknown; created_at?: unknown; updated_at?: unknown } };
        const result = {
          saleId: typeof responseData.saleId === "string" ? responseData.saleId : undefined,
          invoiceNumber: typeof responseData.invoiceNumber === "number" ? responseData.invoiceNumber : undefined,
          customerId: typeof responseData.customer?.id === "string" ? responseData.customer.id : undefined,
        };
        await putOperation({ ...operation, status: "synced", updatedAt: Date.now(), result, message: "تمت المزامنة بنجاح" });
        if (operation.type === "customer.create" && responseData.customer && result.customerId) {
          const cachedCustomers = await getCachedJson<{ customers: Array<{ id?: string }> }>("/api/customers");
          const customerRow = responseData.customer as Record<string, unknown>;
          const existingRows = cachedCustomers?.customers ?? [];
          await cacheJson("/api/customers", { customers: [customerRow, ...existingRows.filter(row => row.id !== result.customerId)].slice(0, 100) });
        }
        if (operation.type === "customer.create" && operation.localCustomerId && result.customerId) {
          const dependents = (await getActorOutbox()).filter(item =>
            item.type === "sale.create" && item.status === "pending" && item.payload.customerId === operation.localCustomerId
          );
          for (const dependent of dependents) {
            await putOperation({
              ...dependent,
              payload: { ...dependent.payload, customerId: result.customerId },
              updatedAt: Date.now(),
              message: "تم ربط العميل المحلي بسجل العميل على الخادم.",
            });
          }
        }
        continue;
      }
      if (response.status === 409) {
        await putOperation({ ...operation, status: "conflict", updatedAt: Date.now(), message: typeof data.error === "string" ? data.error : "تعارض في المخزون أو بيانات العملية؛ يلزم المراجعة" });
      } else if (response.status >= 500) {
        await putOperation({ ...operation, status: "pending", updatedAt: Date.now(), message: "مشكلة مؤقتة بالخادم؛ ستتم إعادة المحاولة" });
        break;
      } else {
        await putOperation({ ...operation, status: "rejected", updatedAt: Date.now(), message: typeof data.error === "string" ? data.error : "رفض الخادم العملية؛ راجع البيانات والصلاحيات" });
      }
    }
  } finally {
    syncing = false;
    notify();
  }
}

export async function reviseOfflineSale(id: string, edits: { finalTotal: number; items: Array<{ name: string; quantity: number; productId?: string | null; itemKind?: string }> }): Promise<void> {
  const operation = (await getActorOutbox()).find(item => item.id === id);
  if (!operation || operation.type !== "sale.create" || (operation.status !== "conflict" && operation.status !== "rejected")) {
    throw new Error("لا يمكن تعديل هذه العملية في حالتها الحالية");
  }
  if (!Number.isFinite(edits.finalTotal) || edits.finalTotal <= 0 || edits.items.length < 1 || edits.items.length > 20) {
    throw new Error("راجع سعر البيع والبنود");
  }
  const originalItems = Array.isArray(operation.payload.items) ? operation.payload.items as Array<Record<string, unknown>> : [];
  const normalizedItems = edits.items.map((item, index) => ({
    ...(originalItems[index] ?? {}),
    name: String(item.name ?? "").trim(),
    quantity: Number(item.quantity),
    productId: item.productId ?? originalItems[index]?.productId ?? null,
    itemKind: item.itemKind ?? String(originalItems[index]?.itemKind ?? "product"),
  }));
  if (normalizedItems.some(item => item.name.length < 2 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
    throw new Error("اسم أو كمية أحد البنود غير صحيحة");
  }
  const payload = { ...operation.payload, finalTotal: Math.round(edits.finalTotal * 100) / 100, items: normalizedItems };
  await putOperation({ ...operation, payload, status: "conflict", message: "تم تعديل الفاتورة محليًا. راجعها ثم أعد المحاولة.", updatedAt: Date.now() });
  notify();
}

export async function reviseOfflineCustomer(id: string, edits: { name: string; phone: string; email?: string; notes?: string }): Promise<void> {
  const operation = (await getActorOutbox()).find(item => item.id === id);
  if (!operation || operation.type !== "customer.create" || (operation.status !== "conflict" && operation.status !== "rejected")) {
    throw new Error("لا يمكن تعديل بيانات هذا العميل في حالته الحالية");
  }
  const name = edits.name.trim();
  const phone = edits.phone.trim();
  if (name.length < 2 || name.length > 160 || phone.length > 40) throw new Error("راجع اسم العميل ورقم الهاتف");
  await putOperation({
    ...operation,
    payload: { ...operation.payload, name, phone, email: edits.email ?? "", notes: edits.notes ?? "" },
    status: "conflict",
    message: "تم تعديل بيانات العميل محليًا. احفظ التعديل ثم أعد المحاولة.",
    updatedAt: Date.now(),
  });
  notify();
}

export async function retryOfflineOperation(id: string): Promise<void> {
  const operation = (await getActorOutbox()).find(item => item.id === id);
  if (!operation || (operation.status !== "conflict" && operation.status !== "rejected")) return;
  await putOperation({ ...operation, status: "pending", message: undefined, updatedAt: Date.now() });
  notify();
  await syncPendingOperations();
}

export async function clearSyncedOfflineOperations(): Promise<void> {
  const operations = await getActorOutbox();
  await Promise.all(operations.filter(x => x.status === "synced").map(x => run(OUTBOX_STORE, "readwrite", store => store.delete(x.id))));
  notify();
}

export function registerOfflineSync() {
  if (typeof window === "undefined") return () => undefined;
  const sync = async () => {
    if (!navigator.onLine) return;
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (typeof data.user?.id !== "string") return;
      setOfflineActor(data.user.id);
    } catch { /* Do not send queued operations until an authenticated session is reachable. */ return; }
    await syncPendingOperations();
  };
  window.addEventListener("online", sync);
  window.addEventListener("focus", sync);
  void sync();
  return () => { window.removeEventListener("online", sync); window.removeEventListener("focus", sync); };
}

export const syncPendingSales = syncPendingOperations;
