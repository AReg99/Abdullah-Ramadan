const TOKEN_KEY = "aura.token";

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = token.get();
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.body && !(init.body instanceof FormData)) headers["content-type"] = "application/json";
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let code = String(res.status);
    try { code = (await res.json()).error ?? code; } catch {}
    if (res.status === 401) token.clear();
    throw new ApiError(res.status, code);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/**
 * Read-through cache for the data a worker needs in hand. The spec is explicit
 * that reference data is pre-cached on login: a worker who cannot open a job
 * card without signal cannot work, and "offline" would be a claim rather than a
 * capability. Writes never come from here — the outbox owns those.
 */
const CACHE = "aura.cache.";
export const cache = {
  read: <T,>(key: string): T | null => {
    try { const v = localStorage.getItem(CACHE + key); return v ? (JSON.parse(v) as T) : null; }
    catch { return null; }
  },
  write: (key: string, value: unknown) => {
    try { localStorage.setItem(CACHE + key, JSON.stringify(value)); } catch { /* quota */ }
  },
  clear: () => Object.keys(localStorage).filter((k) => k.startsWith(CACHE)).forEach((k) => localStorage.removeItem(k)),
};

async function cachedGet<T>(path: string, key: string): Promise<T> {
  try {
    const fresh = await req<T>(path);
    cache.write(key, fresh);
    return fresh;
  } catch (e) {
    const stale = cache.read<T>(key);
    if (stale) return stale;
    throw e;
  }
}

/** Reflect a queued action locally so the screen matches what the worker just did. */
export function patchCachedStage(id: string, patch: Record<string, unknown>) {
  const one = cache.read<any>(`stage.${id}`);
  if (one) cache.write(`stage.${id}`, { ...one, ...patch });
  const list = cache.read<any[]>("today");
  if (Array.isArray(list)) {
    cache.write("today", list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
}

export const api = {
  requestOtp: (phone: string) => req<{ sent: boolean; devCode?: string }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string) => req<{ token: string; user: Me }>("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),
  login: (email: string, password: string) => req<{ token: string; user: Me }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  loginByPhone: (phone: string, password: string) => req<{ token: string; user: Me }>("/auth/login", { method: "POST", body: JSON.stringify({ phone, password }) }),
  me: () => req<Me>("/me"),

  workToday: () => cachedGet<Stage[]>("/work/today", "today"),
  stage: (id: string) => cachedGet<Stage & { previousAfterPhoto: string | null; crew: Person[] }>(`/work/stages/${id}`, `stage.${id}`),
  byLabel: (serial: string) => req<{ stageId: string }>(`/work/label/${encodeURIComponent(serial)}`),
  start: (id: string, clientEventId?: string, occurredAt?: string, workerIds?: string[]) =>
    req<any>(`/work/stages/${id}/start`, { method: "POST", body: JSON.stringify({ clientEventId, occurredAt, workerIds }) }),
  pause: (id: string, reason: string, note?: string, clientEventId?: string, occurredAt?: string) =>
    req<any>(`/work/stages/${id}/pause`, { method: "POST", body: JSON.stringify({ reason, note, clientEventId, occurredAt }) }),
  resume: (id: string, clientEventId?: string, occurredAt?: string) =>
    req<any>(`/work/stages/${id}/resume`, { method: "POST", body: JSON.stringify({ clientEventId, occurredAt }) }),
  finish: (id: string, clientEventId?: string, occurredAt?: string) =>
    req<any>(`/work/stages/${id}/finish`, { method: "POST", body: JSON.stringify({ clientEventId, occurredAt }) }),

  labels: () => req<LabelRow[]>("/labels"),

  // ---- setup & order entry ----
  stations: () => req<Station[]>("/admin/stations"),
  people: () => req<PersonRow[]>("/admin/people"),
  addPerson: (b: NewPerson) => req<any>("/admin/people", { method: "POST", body: JSON.stringify(b) }),
  updatePerson: (id: string, b: Record<string, unknown>) =>
    req<any>(`/admin/people/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  groups: () => req<GroupRow[]>("/admin/groups"),
  addGroup: (b: { nameAr: string; stationId: string; leaderId?: string }) =>
    req<any>("/admin/groups", { method: "POST", body: JSON.stringify(b) }),
  categories: () => req<{ id: string; nameAr: string; nameEn: string }[]>("/admin/categories"),
  addCategory: (b: { nameAr: string }) => req<any>("/admin/categories", { method: "POST", body: JSON.stringify(b) }),
  products: () => req<ProductRow[]>("/admin/products"),
  updateProduct: (id: string, b: Partial<{ nameAr: string; sku: string; basePrice: number;
      baseLeadDays: number; categoryId: string; description: string | null; isActive: boolean }>) =>
    req<ProductRow>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  addProductPhoto: (productId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return req<ProductPhoto>(`/admin/products/${productId}/photos`, { method: "POST", body: fd });
  },
  removeProductPhoto: (productId: string, photoId: string) =>
    req<{ removed: true }>(`/admin/products/${productId}/photos/${photoId}`, { method: "DELETE" }),
  addProduct: (b: NewProduct) => req<any>("/admin/products", { method: "POST", body: JSON.stringify(b) }),
  customers: () => req<{ id: string; name: string; phone: string }[]>("/admin/customers"),
  createOrder: (b: NewOrder) => req<{ id: string; code: string; total: number }>("/admin/orders",
    { method: "POST", body: JSON.stringify(b) }),
  addAttachment: (orderId: string, file: File, note?: string) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    if (note) fd.append("note", note);
    return req<Attachment>(`/orders/${orderId}/attachments`, { method: "POST", body: fd });
  },
  removeAttachment: (orderId: string, attId: string) =>
    req<{ removed: true }>(`/orders/${orderId}/attachments/${attId}`, { method: "DELETE" }),
  markPrinted: (id: string) => req<any>(`/labels/${id}/printed`, { method: "POST" }),

  // ---- factory → showroom → customer ----
  dispatchList: () => req<FlowLine[]>("/flow/dispatch"),
  showroomList: () => req<FlowLine[]>("/flow/showroom"),
  dispatchLine: (id: string) => req<FlowLine>(`/flow/lines/${id}/dispatch`, { method: "POST", body: JSON.stringify({}) }),
  receiveLine: (id: string) => req<FlowLine>(`/flow/lines/${id}/receive`, { method: "POST", body: JSON.stringify({}) }),
  deliverLine: (id: string, note?: string) =>
    req<FlowLine>(`/flow/lines/${id}/deliver`, { method: "POST", body: JSON.stringify({ note }) }),
  grantableRoles: () => req<string[]>("/admin/grantable-roles"),
  removePerson: (id: string) =>
    req<{ removed: "deleted" | "retired" }>(`/admin/people/${id}`, { method: "DELETE" }),
  locations: () => req<LocationRow[]>("/admin/locations"),
  addLocation: (b: { nameAr: string; nameEn?: string; address?: string; type?: string }) =>
    req<LocationRow>("/admin/locations", { method: "POST", body: JSON.stringify(b) }),

  today: () => req<Dashboard>("/dashboard/today"),
  floor: () => req<StationCard[]>("/dashboard/floor"),
  orders: () => req<OrderRow[]>("/orders"),
  order: (id: string) => req<OrderDetail>(`/orders/${id}`),

  async uploadPhoto(stageId: string, kind: "BEFORE" | "AFTER", blob: Blob, w: number, h: number,
                    clientEventId?: string, capturedAt?: string) {
    const fd = new FormData();
    fd.append("stageId", stageId);
    fd.append("kind", kind);
    // Idempotency key: a retried upload is a no-op, a double tap cannot double-count.
    fd.append("clientEventId", clientEventId ?? crypto.randomUUID());
    fd.append("capturedAt", capturedAt ?? new Date().toISOString());
    fd.append("width", String(w));
    fd.append("height", String(h));
    fd.append("file", blob, "photo.jpg");
    return req<any>("/photos", { method: "POST", body: fd });
  },
};

export type Station = { id: string; code: string; nameAr: string; nameEn: string };
export type Attachment = { id: string; kind: "IMAGE" | "DOCUMENT"; filename: string;
  path: string; mime: string; bytes: number; note: string | null; uploadedAt: string };
export type LocationRow = { id: string; type: "FACTORY" | "SHOWROOM" | "WAREHOUSE";
  nameAr: string; nameEn: string; address: string | null };
export type FlowLine = {
  id: string; qty: number; status: string; specNotes: string | null;
  productAr: string; productEn: string; sku: string;
  dispatchedAt: string | null; receivedAt: string | null; deliveredAt: string | null;
  promisedDate: string | null;
  order: { id: string; code: string; customer: string; phone: string;
           showroomAr: string | null; showroomEn: string | null };
  serials: string[];
};
export type PersonRow = { id: string; nameAr: string; nameEn: string; phone: string | null;
  email: string | null; role: string; canLogin: boolean; isActive: boolean; hasPassword: boolean;
  groupId: string | null; groupName: string | null; stationId: string | null; stationName: string | null;
  locationId: string | null; locationName: string | null };
export type NewPerson = { nameAr: string; nameEn?: string; role: string; phone?: string;
  email?: string; password?: string; groupId?: string; stationId?: string; locationId?: string;
  canLogin?: boolean };
export type GroupRow = { id: string; nameAr: string; nameEn: string; isActive: boolean;
  stationId: string; stationAr: string; stationEn: string;
  leader: { id: string; nameAr: string; phone: string | null } | null;
  memberCount: number; members: { id: string; nameAr: string }[] };
export type ProductPhoto = { id: string; path: string; filename: string };
export type ProductRow = { id: string; sku: string; nameAr: string; nameEn: string; kind: string;
  basePrice: number; baseLeadDays: number; isActive: boolean; categoryId: string; categoryAr: string;
  description: string | null; photos: ProductPhoto[] };
export type NewProduct = { sku: string; nameAr: string; nameEn?: string; categoryId: string;
  basePrice: number; baseLeadDays?: number; kind?: string };
export type NewOrder = { customerId?: string; customerName?: string; customerPhone?: string;
  promisedDate?: string; lines: { productId: string; qty: number; unitPrice?: number; specNotes?: string; lineKind?: string }[] };
export type LabelRow = { id: string; serial: string; printedAt: string | null; workOrderCode: string;
  orderCode: string; customer: string; productAr: string; productEn: string; qty: number; promisedDate: string | null };
export type Me = { id: string; nameAr: string; nameEn: string; phone: string; locale: "ar" | "en"; role: string; stationId: string | null };
export type Photo = { id: string; kind: string; path: string };
export type Person = { id: string; nameAr: string; nameEn: string };
export type Stage = {
  id: string; seq: number; status: string; startedAt: string | null; actualMinutes: number;
  blockedReason: string | null;
  stage: { key: string; nameAr: string; nameEn: string; stdMinutes: number; photoBefore: string; photoAfter: string; station: { code: string; nameAr: string; nameEn: string } | null };
  workOrder: { id: string; code: string; qty: number; serial: string | null; specNotes: string | null;
    product: { sku: string; nameAr: string; nameEn: string; photo: string | null };
    order: { code: string; promisedDate: string | null } };
  photos: Photo[];
  /** Who the leader recorded as being on this stage. */
  workers: Person[];
};
export type Dashboard = {
  /** value is present only for roles that may see money. */
  ordersToday: { count: number; value?: number };
  unitsFinished: number; openLines: number; late: number; atRisk: number;
  blocked: { stageId: string; reason: string; note: string | null; station: string; stationAr: string; orderCode: string; minutes: number }[];
  /** The whole-factory activity feed, present only for the owner. */
  events?: { id: string; code: string; occurredAt: string; actor: { nameAr: string; nameEn: string } | null; station: { nameAr: string; nameEn: string } | null; payload: any }[];
};
export type StationCard = {
  id: string; code: string; nameAr: string; nameEn: string; waiting: number;
  active: { stageId: string; orderCode: string; productAr: string; productEn: string; worker: { nameAr: string; nameEn: string } | null; minutes: number; stdMinutes: number }[];
  blocked: { stageId: string; orderCode: string; reason: string; minutes: number }[];
};
export type OrderRow = { id: string; code: string; status: string; kind: string; customer: string; total?: number; promisedDate: string | null; lines: { id: string; status: string; qty: number; productAr: string; productEn: string }[] };
export type OrderDetail = {
  id: string; code: string; status: string; customer: { name: string; phone: string };
  total?: number; promisedDate: string | null;
  lines: { id: string; qty: number; status: string; productAr: string; productEn: string;
    workOrders: { code: string; status: string; stages: { seq: number; status: string; nameAr: string; nameEn: string; actualMinutes: number; stdMinutes: number; photos: { kind: string; path: string }[] }[] }[] }[];
  attachments: Attachment[];
  events: { id: string; code: string; occurredAt: string; payload: any; actor: { nameAr: string; nameEn: string } | null; station: { nameAr: string; nameEn: string } | null }[];
};

/** Compress on device before upload — the network in a factory is the worst in the business. */
export function compress(file: File): Promise<{ blob: Blob; url: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1600;
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(
          (b) => (b ? resolve({ blob: b, url: URL.createObjectURL(b), w: c.width, h: c.height }) : reject(new Error("encode failed"))),
          "image/jpeg", 0.7
        );
      };
      img.onerror = () => reject(new Error("decode failed"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}
