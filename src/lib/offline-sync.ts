"use client";

type CachedEntry = { key: string; value: unknown; savedAt: number };
export type OfflineSaleOperation = {
  id: string;
  type: "sale.create";
  url: "/api/sales";
  payload: Record<string, unknown> & { operationId: string; branchId: string };
  status: "pending" | "syncing" | "conflict" | "rejected" | "synced";
  createdAt: number;
  updatedAt: number;
  message?: string;
  result?: { saleId?: string; invoiceNumber?: number };
};
export type OfflineSummary = { pending: number; conflicts: number; rejected: number; synced: number; online: boolean };

const DB_NAME = "nazra-offline-v1";
const DB_VERSION = 1;
const CACHE_STORE = "response-cache";
const OUTBOX_STORE = "sales-outbox";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let opening: Promise<IDBDatabase> | null = null;
let syncing = false;

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
  url.pathname === "/api/sales/customers"
);

export async function getCachedJson<T>(key: string): Promise<T | null> {
  try {
    const entry = await run<CachedEntry | undefined>(CACHE_STORE, "readonly", store => store.get(key));
    if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.value as T;
  } catch { return null; }
}

async function cacheJson(key: string, value: unknown) {
  try { await run(CACHE_STORE, "readwrite", store => store.put({ key, value, savedAt: Date.now() } satisfies CachedEntry)); }
  catch { /* Cache failures must not fail an online request. */ }
}

async function getOutbox(): Promise<OfflineSaleOperation[]> {
  try { return await run<OfflineSaleOperation[]>(OUTBOX_STORE, "readonly", store => store.getAll()); }
  catch { return []; }
}

async function putOperation(operation: OfflineSaleOperation) {
  await run(OUTBOX_STORE, "readwrite", store => store.put(operation));
}

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nazra:sync-state"));
}

export async function offlineSummary(): Promise<OfflineSummary> {
  const operations = await getOutbox();
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
  const cacheable = method === "GET" && canCache(parsedUrl);

  if (method === "POST" && parsedUrl.pathname === "/api/sales") {
    const raw = typeof init?.body === "string" ? init.body : "{}";
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const operationId = typeof payload.operationId === "string" ? payload.operationId : crypto.randomUUID();
    const safePayload = { ...payload, operationId };
    const requestInit = { ...init, headers: { "content-type": "application/json", ...init?.headers }, body: JSON.stringify(safePayload) };
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
        id: operationId, type: "sale.create", url: "/api/sales",
        payload: safePayload as OfflineSaleOperation["payload"], status: "pending",
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
    return data as T;
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : 0;
    if (status || !cacheable) throw error;
    const cached = await getCachedJson<T>(parsedUrl.pathname + parsedUrl.search);
    if (cached !== null) return cached;
    throw new Error("لا يوجد اتصال ولا توجد نسخة محلية محفوظة لهذه البيانات. اتصل بالإنترنت مرة واحدة لتحميل بيانات الفرع.");
  }
}

export async function syncPendingSales(): Promise<void> {
  if (syncing || typeof navigator === "undefined" || !navigator.onLine) return;
  syncing = true;
  try {
    const operations = (await getOutbox()).filter(operation => operation.status === "pending");
    for (const operation of operations) {
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
        await putOperation({
          ...operation, status: "synced", updatedAt: Date.now(),
          result: { saleId: typeof data.saleId === "string" ? data.saleId : undefined, invoiceNumber: typeof data.invoiceNumber === "number" ? data.invoiceNumber : undefined },
          message: "تمت المزامنة بنجاح",
        });
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

export async function retryOfflineOperation(id: string): Promise<void> {
  const operation = (await getOutbox()).find(item => item.id === id);
  if (!operation || (operation.status !== "conflict" && operation.status !== "rejected")) return;
  await putOperation({ ...operation, status: "pending", message: undefined, updatedAt: Date.now() });
  notify();
  await syncPendingSales();
}

export async function clearSyncedOfflineOperations(): Promise<void> {
  const operations = await getOutbox();
  await Promise.all(operations.filter(x => x.status === "synced").map(x => run(OUTBOX_STORE, "readwrite", store => store.delete(x.id))));
  notify();
}

export function registerOfflineSync() {
  if (typeof window === "undefined") return () => undefined;
  const sync = () => { void syncPendingSales(); };
  window.addEventListener("online", sync);
  window.addEventListener("focus", sync);
  sync();
  return () => { window.removeEventListener("online", sync); window.removeEventListener("focus", sync); };
}
