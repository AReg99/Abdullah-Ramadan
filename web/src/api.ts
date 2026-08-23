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

export const api = {
  requestOtp: (phone: string) => req<{ sent: boolean; devCode?: string }>("/auth/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string) => req<{ token: string; user: Me }>("/auth/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),
  login: (email: string, password: string) => req<{ token: string; user: Me }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => req<Me>("/me"),

  workToday: () => req<Stage[]>("/work/today"),
  stage: (id: string) => req<Stage & { previousAfterPhoto: string | null }>(`/work/stages/${id}`),
  byLabel: (serial: string) => req<{ stageId: string }>(`/work/label/${encodeURIComponent(serial)}`),
  start: (id: string) => req<any>(`/work/stages/${id}/start`, { method: "POST" }),
  pause: (id: string, reason: string, note?: string) => req<any>(`/work/stages/${id}/pause`, { method: "POST", body: JSON.stringify({ reason, note }) }),
  resume: (id: string) => req<any>(`/work/stages/${id}/resume`, { method: "POST" }),
  finish: (id: string) => req<any>(`/work/stages/${id}/finish`, { method: "POST" }),

  today: () => req<Dashboard>("/dashboard/today"),
  floor: () => req<StationCard[]>("/dashboard/floor"),
  orders: () => req<OrderRow[]>("/orders"),
  order: (id: string) => req<OrderDetail>(`/orders/${id}`),

  async uploadPhoto(stageId: string, kind: "BEFORE" | "AFTER", blob: Blob, w: number, h: number) {
    const fd = new FormData();
    fd.append("stageId", stageId);
    fd.append("kind", kind);
    // Idempotency key: a retried upload is a no-op, a double tap cannot double-count.
    fd.append("clientEventId", crypto.randomUUID());
    fd.append("capturedAt", new Date().toISOString());
    fd.append("width", String(w));
    fd.append("height", String(h));
    fd.append("file", blob, "photo.jpg");
    return req<any>("/photos", { method: "POST", body: fd });
  },
};

export type Me = { id: string; nameAr: string; nameEn: string; phone: string; locale: "ar" | "en"; role: string; stationId: string | null };
export type Photo = { id: string; kind: string; path: string };
export type Stage = {
  id: string; seq: number; status: string; startedAt: string | null; actualMinutes: number;
  blockedReason: string | null;
  stage: { key: string; nameAr: string; nameEn: string; stdMinutes: number; photoBefore: string; photoAfter: string; station: { code: string; nameAr: string; nameEn: string } | null };
  workOrder: { id: string; code: string; qty: number; serial: string | null; specNotes: string | null;
    product: { sku: string; nameAr: string; nameEn: string }; order: { code: string; promisedDate: string | null } };
  photos: Photo[];
};
export type Dashboard = {
  ordersToday: { count: number; value: number };
  unitsFinished: number; openLines: number; late: number; atRisk: number;
  blocked: { stageId: string; reason: string; note: string | null; station: string; stationAr: string; orderCode: string; minutes: number }[];
  events: { id: string; code: string; occurredAt: string; actor: { nameAr: string; nameEn: string } | null; station: { nameAr: string; nameEn: string } | null; payload: any }[];
};
export type StationCard = {
  id: string; code: string; nameAr: string; nameEn: string; waiting: number;
  active: { stageId: string; orderCode: string; productAr: string; productEn: string; worker: { nameAr: string; nameEn: string } | null; minutes: number; stdMinutes: number }[];
  blocked: { stageId: string; orderCode: string; reason: string; minutes: number }[];
};
export type OrderRow = { id: string; code: string; status: string; kind: string; customer: string; total: number; promisedDate: string | null; lines: { id: string; status: string; qty: number; productAr: string; productEn: string }[] };
export type OrderDetail = {
  id: string; code: string; status: string; customer: { name: string; phone: string };
  total: number; promisedDate: string | null;
  lines: { id: string; qty: number; status: string; productAr: string; productEn: string;
    workOrders: { code: string; status: string; stages: { seq: number; status: string; nameAr: string; nameEn: string; actualMinutes: number; stdMinutes: number; photos: { kind: string; path: string }[] }[] }[] }[];
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
