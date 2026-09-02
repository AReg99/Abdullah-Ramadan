const TOKEN_KEY = "aura.token";

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /**
     * The rest of the server's answer.
     *
     * A refusal often carries the numbers that make it actionable — the
     * ceiling that was hit, what was asked, what is still outstanding — and
     * throwing away everything but the code leaves the screen able to say
     * only "no".
     */
    public detail: Record<string, any> = {},
  ) {
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
    let detail: Record<string, any> = {};
    try {
      detail = await res.json();
      code = detail.error ?? code;
    } catch {}
    if (res.status === 401) token.clear();
    throw new ApiError(res.status, code, detail);
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
  changeMyPassword: (currentPassword: string, newPassword: string) =>
    req<{ changed: true }>("/auth/password", { method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }) }),

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
  labelsPrinted: (ids: string[]) =>
    req<{ printedAt: string; count: number; missing: string[] }>("/labels/printed",
      { method: "POST", body: JSON.stringify({ ids }) }),

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
      cost: number; warrantyMonths: number; reason: string;
      baseLeadDays: number; categoryId: string; description: string | null; isActive: boolean }>) =>
    req<ProductRow>(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  addProductPhoto: (productId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return req<ProductPhoto>(`/admin/products/${productId}/photos`, { method: "POST", body: fd });
  },
  removeProduct: (id: string) =>
    req<{ removed: "deleted" | "retired" }>(`/admin/products/${id}`, { method: "DELETE" }),
  removeProductPhoto: (productId: string, photoId: string) =>
    req<{ removed: true }>(`/admin/products/${productId}/photos/${photoId}`, { method: "DELETE" }),
  addProduct: (b: NewProduct) => req<ProductRow>("/admin/products", { method: "POST", body: JSON.stringify(b) }),
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

  // ---- the books ----
  cashAccounts: () => req<CashAccount[]>("/money/accounts"),
  addCashAccount: (b: { code: string; nameAr: string; kind?: string; openingBalance?: number }) =>
    req<CashAccount>("/money/accounts", { method: "POST", body: JSON.stringify(b) }),
  collect: (b: { orderId: string; accountId: string; amount: number; discount?: number;
                 method?: string; reference?: string; note?: string }) =>
    req<{ id: string; paidTotal: number; outstanding: number }>("/money/collect",
      { method: "POST", body: JSON.stringify(b) }),
  spend: (b: { accountId: string; amount: number; category?: string; method?: string;
               purchaseInvoiceId?: string; supplierId?: string; discount?: number;
               reference?: string; note?: string }) =>
    req<any>("/money/spend", { method: "POST", body: JSON.stringify(b) }),
  reverseEntry: (id: string, reason: string) =>
    req<any>(`/money/entries/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
  suppliers: () => req<{ id: string; name: string; phone: string | null }[]>("/money/suppliers"),
  addSupplier: (b: { name: string; phone?: string }) =>
    req<any>("/money/suppliers", { method: "POST", body: JSON.stringify(b) }),
  addPurchase: (b: { supplierId: string; purchaseOrderId?: string; number: string;
                     issuedOn: string; warehouseId?: string;
                     taxRate?: number; discount?: number; amount?: number; note?: string;
                     lines?: { description: string; qty: number; unitPrice: number;
                               discount?: number; warehouseId?: string }[] }) =>
    req<{ id: string }>("/money/purchases", { method: "POST", body: JSON.stringify(b) }),
  purchase: (id: string) => req<PurchaseDoc>(`/money/purchases/${id}`),
  voucher: (id: string) => req<Voucher>(`/money/vouchers/${id}`),
  summary: (month?: string) =>
    req<Summary>(`/money/summary${month ? `?month=${month}` : ""}`),
  savePayrollAdjustment: (month: string, userId: string, b: Record<string, number>) =>
    req<any>(`/money/payroll/${month}/${userId}`, { method: "PUT", body: JSON.stringify(b) }),
  receive: (b: { accountId: string; amount: number; category?: string; method?: string;
                 reference?: string; note?: string }) =>
    req<any>("/money/receive", { method: "POST", body: JSON.stringify(b) }),
  transfer: (b: { fromAccountId: string; toAccountId: string; amount: number; note?: string }) =>
    req<any>("/money/transfer", { method: "POST", body: JSON.stringify(b) }),
  patchCashAccount: (id: string, b: { nameAr?: string; openingBalance?: number; isActive?: boolean }) =>
    req<CashAccount>(`/money/accounts/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  payroll: (period: string) => req<Payroll>(`/money/payroll/${period}`),
  postPayroll: (period: string, b: { accountId: string; skip?: string[]; note?: string }) =>
    req<{ period: string; kind: string; paid: number; total: number }>(`/money/payroll/${period}`,
      { method: "POST", body: JSON.stringify(b) }),
  attendanceDay: (day: string) => req<AttendanceDay>(`/money/attendance/${day}`),
  saveAttendance: (day: string, lines: { userId: string; status: string;
                                         overtimeHours?: number; note?: string }[]) =>
    req<{ day: string; saved: number }>(`/money/attendance/${day}`,
      { method: "PUT", body: JSON.stringify({ lines }) }),
  attendanceWeek: (period: string) => req<AttendanceWeek>(`/money/attendance/week/${period}`),
  bom: (productId: string) => req<BomLine[]>(`/stock/bom/${productId}`),
  saveBom: (productId: string, lines: { stockItemId: string; qty: number; note?: string }[]) =>
    req<{ lines: number }>(`/stock/bom/${productId}`,
      { method: "PUT", body: JSON.stringify({ lines }) }),
  stockBatches: (itemId: string) =>
    req<{ batch: string; warehouseId: string; warehouse: string; qty: number }[]>(
      `/stock/items/${itemId}/batches`),
  settings: () => req<Record<string, string>>("/settings"),
  saveSettings: (b: Record<string, string>) =>
    req<Record<string, string>>("/settings", { method: "PUT", body: JSON.stringify(b) }),
  invoice: (id: string) => req<Invoice>(`/orders/${id}/invoice`),

  // ---- costing ----
  priceList: () => req<PriceList>("/costing/price-list"),
  costOf: (id: string) => req<ProductCosting>(`/costing/products/${id}`),
  adoptCost: (id: string, b: { reason?: string; holdMargin?: boolean }) =>
    req<{ id: string; cost: number; basePrice: number }>(
      `/costing/products/${id}/adopt`, { method: "POST", body: JSON.stringify(b) }),
  costRates: (b: { labourRate?: number; overheadPct?: number; minMarginPct?: number }) =>
    req<CostRates>("/costing/rates", { method: "PUT", body: JSON.stringify(b) }),
  priceChanges: (unseen?: boolean) =>
    req<PriceChange[]>(`/costing/changes${unseen ? "?unseen=1" : ""}`),
  unseenPrices: () => req<{ count: number }>("/costing/changes/unseen"),
  markPricesSeen: (ids?: string[]) =>
    req<{ marked: number }>("/costing/changes/seen",
      { method: "POST", body: JSON.stringify(ids ? { ids } : {}) }),
  realisedMargin: (from?: string, to?: string) =>
    req<MarginReport>(`/costing/margin${from ? `?from=${from}&to=${to ?? ""}` : ""}`),

  // ---- leads & quotations ----
  leads: (q?: { status?: string; mine?: boolean; due?: boolean }) =>
    req<LeadBoard>(`/leads${q && (q.status || q.mine || q.due)
      ? `?${new URLSearchParams({ ...(q.status ? { status: q.status } : {}),
                                  ...(q.mine ? { mine: "1" } : {}),
                                  ...(q.due ? { due: "1" } : {}) })}` : ""}`),
  lead: (id: string) => req<Lead>(`/leads/${id}`),
  addLead: (b: { name: string; phone: string; whatsapp?: string; source?: string;
                 interest?: string; estimateValue?: number; nextFollowUp?: string;
                 note?: string }) =>
    req<Lead>("/leads", { method: "POST", body: JSON.stringify(b) }),
  patchLead: (id: string, b: Record<string, unknown>) =>
    req<Lead>(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  addLeadNote: (id: string, b: { note: string; nextFollowUp?: string | null }) =>
    req<Lead>(`/leads/${id}/notes`, { method: "POST", body: JSON.stringify(b) }),
  lostLead: (id: string, b: { reason: string; note?: string }) =>
    req<Lead>(`/leads/${id}/lost`, { method: "POST", body: JSON.stringify(b) }),
  leadReport: (from?: string, to?: string) =>
    req<LeadReport>(`/leads/report${from ? `?from=${from}&to=${to ?? ""}` : ""}`),
  quotes: (q?: { leadId?: string; status?: string }) =>
    req<Quote[]>(`/quotes${q && (q.leadId || q.status)
      ? `?${new URLSearchParams({ ...(q.leadId ? { leadId: q.leadId } : {}),
                                  ...(q.status ? { status: q.status } : {}) })}` : ""}`),
  quote: (id: string) => req<Quote & { company: Invoice["company"] }>(`/quotes/${id}`),
  addQuote: (b: { leadId?: string; customerId?: string; validUntil?: string;
                  note?: string; approvalId?: string;
                  lines: { productId: string; qty: number; unitPrice?: number;
                           discount?: number; specNotes?: string }[] }) =>
    req<Quote>("/quotes", { method: "POST", body: JSON.stringify(b) }),
  quoteSent: (id: string) => req<Quote>(`/quotes/${id}/sent`, { method: "POST" }),
  quoteRejected: (id: string) => req<Quote>(`/quotes/${id}/rejected`, { method: "POST" }),
  convertQuote: (id: string) =>
    req<{ customerId: string; quotationId: string; leadId: string | null;
          lines: { productId: string; qty: number; unitPrice: number;
                   discount: number; specNotes?: string }[] }>(
      `/quotes/${id}/convert`, { method: "POST" }),

  // ---- warranty & after-sales ----
  warrantyOf: (orderLineId: string) => req<Warranty>(`/service/warranty/${orderLineId}`),
  bySerial: (serial: string) => req<Warranty & { serial: string }>(`/service/by-serial/${serial}`),
  tickets: (q?: { status?: string; kind?: string; mine?: boolean }) =>
    req<Ticket[]>(`/service/tickets${q && (q.status || q.kind || q.mine)
      ? `?${new URLSearchParams({ ...(q.status ? { status: q.status } : {}),
                                  ...(q.kind ? { kind: q.kind } : {}),
                                  ...(q.mine ? { mine: "1" } : {}) })}` : ""}`),
  ticket: (id: string) => req<Ticket>(`/service/tickets/${id}`),
  technicians: () => req<{ id: string; nameAr: string; nameEn: string; role: string }[]>(
    "/service/technicians"),
  addTicket: (b: { orderLineId: string; serial?: string; description: string;
                   defectTypeId?: string; promisedDate?: string; assignedToId?: string }) =>
    req<Ticket>("/service/tickets", { method: "POST", body: JSON.stringify(b) }),
  patchTicket: (id: string, b: Record<string, unknown>) =>
    req<Ticket>(`/service/tickets/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  addVisit: (id: string, b: { outcome: string; note?: string; photoPath?: string }) =>
    req<Ticket>(`/service/tickets/${id}/visits`, { method: "POST", body: JSON.stringify(b) }),
  closeTicket: (id: string, b: { resolution: string; rejected?: boolean;
                                 costAmount?: number; chargeAmount?: number; kind?: string }) =>
    req<Ticket>(`/service/tickets/${id}/close`, { method: "POST", body: JSON.stringify(b) }),
  serviceReport: (from?: string, to?: string) =>
    req<ServiceReport>(`/service/report${from ? `?from=${from}&to=${to ?? ""}` : ""}`),

  // ---- planning ----
  planningBoard: () => req<PlanBoard>("/planning/board"),
  setPriority: (id: string, b: { level: "NORMAL" | "URGENT" | "CRITICAL"; note?: string }) =>
    req<{ id: string; priority: number; level: string }>(
      `/planning/work-orders/${id}/priority`, { method: "POST", body: JSON.stringify(b) }),
  stationLoad: () => req<StationLoad>("/planning/load"),
  promiseFor: (lines: { productId?: string; qty: number }[]) =>
    req<PromiseDate>("/planning/promise", { method: "POST", body: JSON.stringify({ lines }) }),
  promiseWatch: () => req<PromiseWatch>("/planning/promises"),
  setCapacity: (id: string, dailyCapacityMinutes: number) =>
    req<{ id: string; dailyCapacityMinutes: number }>(
      `/planning/stations/${id}/capacity`,
      { method: "PUT", body: JSON.stringify({ dailyCapacityMinutes }) }),

  // ---- limits & approvals ----
  myLimits: () => req<MyLimits>("/limits/mine"),
  limits: () => req<RoleLimitRow[]>("/limits"),
  saveLimit: (role: string, b: { discountPct?: number | null; purchaseCeiling?: number | null }) =>
    req<RoleLimitRow>(`/limits/${role}`, { method: "PUT", body: JSON.stringify(b) }),
  approvals: (q?: { status?: string; mine?: boolean }) =>
    req<Approval[]>(`/approvals${q?.status || q?.mine
      ? `?${new URLSearchParams({ ...(q.status ? { status: q.status } : {}),
                                  ...(q.mine ? { mine: "1" } : {}) })}` : ""}`),
  askApproval: (b: { kind: "ORDER_DISCOUNT" | "PURCHASE_ORDER_VALUE"; amount: number;
                     gross?: number; subject: string; reason?: string }) =>
    req<Approval>("/approvals", { method: "POST", body: JSON.stringify(b) }),
  decideApproval: (id: string, b: { approve: boolean; amount?: number; note?: string }) =>
    req<Approval>(`/approvals/${id}/decide`, { method: "POST", body: JSON.stringify(b) }),
  cancelApproval: (id: string) => req<any>(`/approvals/${id}/cancel`, { method: "POST" }),
  waiting: () => req<{ approvals: number; purchaseRequests: number; total: number }>(
    "/approvals/waiting"),

  // ---- purchasing ----
  purchaseRequests: (status?: string) =>
    req<PurchaseRequest[]>(`/purchasing/requests${status ? `?status=${status}` : ""}`),
  purchaseRequest: (id: string) => req<PurchaseRequest>(`/purchasing/requests/${id}`),
  addPurchaseRequest: (b: { warehouseId?: string; neededBy?: string; note?: string;
                            lines: { stockItemId: string; qty: number; note?: string }[] }) =>
    req<PurchaseRequest>("/purchasing/requests", { method: "POST", body: JSON.stringify(b) }),
  decideRequest: (id: string, b: { approve: boolean; note?: string }) =>
    req<any>(`/purchasing/requests/${id}/decide`, { method: "POST", body: JSON.stringify(b) }),
  purchaseOrders: (status?: string) =>
    req<PurchaseOrder[]>(`/purchasing/orders${status ? `?status=${status}` : ""}`),
  purchaseOrder: (id: string) => req<PurchaseOrder>(`/purchasing/orders/${id}`),
  addPurchaseOrder: (b: { supplierId: string; requestId?: string; warehouseId?: string;
                          expectedOn?: string; note?: string; approvalId?: string;
                          lines: { stockItemId: string; qty: number; unitPrice: number }[] }) =>
    req<PurchaseOrder>("/purchasing/orders", { method: "POST", body: JSON.stringify(b) }),
  cancelPurchaseOrder: (id: string) =>
    req<any>(`/purchasing/orders/${id}/cancel`, { method: "POST" }),
  receiveOrder: (id: string, b: { warehouseId?: string; note?: string;
                                  lines: { orderLineId: string; qty: number; batch?: string }[] }) =>
    req<{ receipt: { id: string; number: string }; order: PurchaseOrder }>(
      `/purchasing/orders/${id}/receive`, { method: "POST", body: JSON.stringify(b) }),
  threeWayMatch: (id: string) => req<ThreeWayMatch>(`/purchasing/orders/${id}/match`),
  goodsReceipts: () => req<GoodsReceipt[]>("/purchasing/receipts"),
  buySuggestions: () => req<BuySuggestions>("/purchasing/suggest"),

  // ---- the road ----
  deliveryRun: () => req<DeliveryRun>("/delivery/run"),
  deliveryAttempts: (lineId: string) => req<DeliveryStop>(`/delivery/lines/${lineId}/attempts`),
  markDelivered: (lineId: string, b: {
    recipientName: string; note?: string; photoPath?: string; signaturePath?: string;
    lat?: number; lng?: number;
  }) => req<DeliveryStop>(`/delivery/lines/${lineId}/delivered`,
    { method: "POST", body: JSON.stringify(b) }),
  markFailed: (lineId: string, b: { reason: string; note?: string; photoPath?: string;
                                    lat?: number; lng?: number }) =>
    req<any>(`/delivery/lines/${lineId}/failed`, { method: "POST", body: JSON.stringify(b) }),
  deliveryReport: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return req<DeliveryReport>(`/delivery/report${q.toString() ? `?${q}` : ""}`);
  },
  /** Upload one piece of proof; returns the stored path to attach. */
  uploadProof: async (blob: Blob, kind: "PHOTO" | "SIGNATURE") => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", blob, kind === "SIGNATURE" ? "sign.png" : "proof.jpg");
    const r = await fetch("/api/delivery/proof", {
      method: "POST",
      headers: { authorization: `Bearer ${token.get()}` },
      body: fd,
    });
    if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).error);
    return (await r.json()) as { path: string; kind: string };
  },

  // ---- quality ----
  defectTypes: () => req<DefectType[]>("/quality/defect-types"),
  addDefectType: (b: { code: string; nameAr: string; nameEn?: string }) =>
    req<DefectType>("/quality/defect-types", { method: "POST", body: JSON.stringify(b) }),
  removeDefectType: (id: string) =>
    req<{ removed: "deleted" | "retired" }>(`/quality/defect-types/${id}`, { method: "DELETE" }),
  qcStage: (id: string) => req<QcStage>(`/quality/stages/${id}`),
  qcVerdict: (id: string, b: {
    result: "PASS" | "REWORK" | "SCRAP"; qty?: number; reworkToSeq?: number; note?: string;
    defects?: { defectTypeId: string; qty: number; stationId?: string | null;
                groupId?: string | null; note?: string }[];
  }) => req<any>(`/quality/stages/${id}/verdict`, { method: "POST", body: JSON.stringify(b) }),
  qualityReport: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return req<QualityReport>(`/quality/report${q.toString() ? `?${q}` : ""}`);
  },

  // ---- the store ----
  stockItems: () => req<StockItem[]>("/stock/items"),
  addStockItem: (b: { sku: string; nameAr: string; kind?: string; unit?: string;
                      reorderLevel?: number; unitCost?: number; productId?: string }) =>
    req<StockItem>("/stock/items", { method: "POST", body: JSON.stringify(b) }),
  updateStockItem: (id: string, b: Record<string, unknown>) =>
    req<StockItem>(`/stock/items/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  removeStockItem: (id: string) =>
    req<{ removed: "deleted" | "retired" }>(`/stock/items/${id}`, { method: "DELETE" }),
  stockMovements: (q: { itemId?: string; warehouseId?: string } = {}) => {
    const p = new URLSearchParams();
    if (q.itemId) p.set("itemId", q.itemId);
    if (q.warehouseId) p.set("warehouseId", q.warehouseId);
    return req<StockMovement[]>(`/stock/movements${p.toString() ? `?${p}` : ""}`);
  },
  stockMove: (b: { itemId: string; warehouseId: string; direction: "IN" | "OUT";
                   qty: number; reason?: string; batch?: string; note?: string }) =>
    req<any>("/stock/move", { method: "POST", body: JSON.stringify(b) }),
  stockTransfer: (b: { itemId: string; fromWarehouseId: string; toWarehouseId: string;
                       qty: number; note?: string }) =>
    req<any>("/stock/transfer", { method: "POST", body: JSON.stringify(b) }),
  reverseStockMovement: (id: string, reason: string) =>
    req<any>(`/stock/movements/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
  stockReport: () => req<StockReport>("/stock/report"),
  stocktakes: () => req<{ id: string; warehouse: string; startedAt: string;
                          postedAt: string | null; lines: number }[]>("/stock/stocktakes"),
  stocktake: (id: string) => req<Stocktake>(`/stock/stocktakes/${id}`),
  openStocktake: (warehouseId: string) =>
    req<{ id: string; lines: number }>("/stock/stocktakes",
      { method: "POST", body: JSON.stringify({ warehouseId }) }),
  saveStocktake: (id: string, counts: { itemId: string; counted: number; note?: string }[]) =>
    req<{ saved: number }>(`/stock/stocktakes/${id}`,
      { method: "PUT", body: JSON.stringify({ counts }) }),
  postStocktake: (id: string) =>
    req<{ posted: number; lines: number }>(`/stock/stocktakes/${id}/post`, { method: "POST" }),
  report: (name: string, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return req<Report>(`/money/reports/${name}${q.toString() ? `?${q}` : ""}`);
  },
  exportUrl: (name: string, from?: string, to?: string) => {
    const q = new URLSearchParams({ report: name });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return `/api/money/export?${q}`;
  },

  today: () => req<Dashboard>("/dashboard/today"),
  floor: () => req<StationCard[]>("/dashboard/floor"),
  orders: () => req<OrderRow[]>("/orders"),
  order: (id: string) => req<OrderDetail>(`/orders/${id}`),
  orderProgress: (id: string) => req<Progress>(`/orders/${id}/progress`),
  cancelOrder: (id: string, reason: string) =>
    req<{ cancelled: number; stagesStopped: number; keptDelivered: number }>(
      `/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),

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
export type PersonRow = { salary?: number | null; dayRate?: number | null;
  payType?: "MONTHLY" | "DAILY"; id: string; nameAr: string; nameEn: string; phone: string | null;
  email: string | null; role: string; canLogin: boolean; isActive: boolean; hasPassword: boolean;
  groupId: string | null; groupName: string | null; stationId: string | null; stationName: string | null;
  locationId: string | null; locationName: string | null };
export type NewPerson = { salary?: number | null; dayRate?: number | null;
  payType?: "MONTHLY" | "DAILY"; nameAr: string; nameEn?: string; role: string; phone?: string;
  email?: string; password?: string; groupId?: string; stationId?: string; locationId?: string;
  canLogin?: boolean };
export type GroupRow = { id: string; nameAr: string; nameEn: string; isActive: boolean;
  stationId: string; stationAr: string; stationEn: string;
  leader: { id: string; nameAr: string; phone: string | null } | null;
  memberCount: number; members: { id: string; nameAr: string }[] };
export type ProductPhoto = { id: string; path: string; filename: string };
export type ProductRow = { cost?: number; id: string; sku: string; nameAr: string; nameEn: string; kind: string;
  basePrice: number; baseLeadDays: number; isActive: boolean; categoryId: string; categoryAr: string;
  description: string | null; photos: ProductPhoto[] };
export type NewProduct = { cost?: number; sku: string; nameAr: string; nameEn?: string; categoryId: string;
  basePrice: number; baseLeadDays?: number; kind?: string; description?: string };
export type NewOrder = { customerId?: string; customerName?: string; customerPhone?: string;
  promisedDate?: string; approvalId?: string; quotationId?: string;
  lines: { productId: string; qty: number; unitPrice?: number;
    discount?: number; warehouseId?: string; specNotes?: string; lineKind?: string }[] };
export type LabelRow = { id: string; serial: string; printedAt: string | null; workOrderCode: string;
  orderCode: string; customer: string; productAr: string; productEn: string; qty: number; promisedDate: string | null };
export type Me = { id: string; nameAr: string; nameEn: string; phone: string; locale: "ar" | "en"; role: string; stationId: string | null };
export type Photo = { id: string; kind: string; path: string };
export type Person = { id: string; nameAr: string; nameEn: string };
export type Stage = {
  id: string; seq: number; status: string; startedAt: string | null; actualMinutes: number;
  blockedReason: string | null;
  stage: { key: string; nameAr: string; nameEn: string; stdMinutes: number; isQcGate?: boolean; photoBefore: string; photoAfter: string; station: { code: string; nameAr: string; nameEn: string } | null };
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
export type CashAccount = { id: string; code: string; nameAr: string; nameEn: string;
  kind: "CASH" | "BANK"; isActive: boolean; openingBalance: number;
  totalIn: number; totalOut: number; balance: number };
export type PurchaseDoc = {
  company: Invoice["company"];
  invoice: { id: string; number: string; date: string; note: string | null; warehouse: string | null };
  supplier: { name: string; phone: string | null };
  lines: { description: string; qty: number; unitPrice: number; discount: number;
           lineTotal: number; warehouse: string | null }[];
  totals: { subtotal: number; discount: number; taxRate: number; taxTotal: number;
            total: number; paid: number; outstanding: number };
  payments: { voucherNo: string | null; date: string; amount: number; discount: number;
              method: string; account: string }[];
};
export type Voucher = {
  company: { nameAr: string; nameEn: string; address: string; phone: string };
  voucher: { id: string; kind: "RECEIPT" | "PAYMENT"; number: string | null; date: string;
             amount: number; discount: number; settled: number; method: string;
             category: string | null; reference: string | null; note: string | null;
             isReversal: boolean };
  party: { name: string | null; phone: string | null };
  against: { orderCode: string | null; orderInvoiceNo: string | null; purchaseNumber: string | null };
  account: { nameAr: string; nameEn: string };
  by: string | null;
};
export type Summary = {
  month: string;
  cash: { id: string; nameAr: string; nameEn: string; kind: string; balance: number }[];
  totals: { inHand: number; sales: number; cogs: number; gross: number; expenses: number;
            profit: number; collected: number; receivable: number; payable: number;
            stockValue: number; net: number };
  topDebtors: { id: string; code: string; customer: string; outstanding: number; ageDays: number }[];
  oldestDebts: { id: string; code: string; customer: string; outstanding: number; ageDays: number }[];
  topBills: { id: string; number: string; supplier: string; outstanding: number; ageDays: number }[];
  lowStock: { id: string; name: string; unit: string; onHand: number;
              reorderLevel: number; value: number }[];
  byExpense: Record<string, number>;
};
export type CostRates = { labourRate: number; overheadPct: number; minMarginPct: number };
export type PriceRow = {
  id: string; sku: string; nameAr: string; nameEn: string;
  category: string; isActive: boolean;
  price: number; storedCost: number;
  computed: { materials: number; labour: number; overhead: number;
              total: number; minutes: number };
  drift: number; margin: number | null;
  belowFloor: boolean; belowCost: boolean; hasBom: boolean;
};
export type PriceList = {
  rates: CostRates;
  totals: { products: number; noBom: number; belowFloor: number; belowCost: number;
            driftedUp: number; avgMargin: number | null };
  rows: PriceRow[];
};
export type ProductCosting = {
  product: { id: string; sku: string; nameAr: string; nameEn: string;
             category: string; isActive: boolean; price: number; storedCost: number };
  rates: CostRates;
  materials: { stockItemId: string; name: string; sku: string; unit: string;
               qty: number; unitCost: number; total: number }[];
  stages: { name: string; station: string | null; minutes: number; cost: number }[];
  computed: { materials: number; labour: number; overhead: number;
              total: number; minutes: number };
  drift: number; margin: number | null; suggestedPrice: number | null;
  history: { id: string; oldPrice: number; newPrice: number; oldCost: number;
             newCost: number; reason: string | null; by: string | null;
             seenAt: string | null; at: string }[];
};
export type PriceChange = {
  id: string;
  product: { id: string; nameAr: string; nameEn: string; sku: string };
  oldPrice: number; newPrice: number; priceMoved: number;
  oldCost: number; newCost: number;
  reason: string | null; by: string | null;
  seenAt: string | null; seenBy: string | null; at: string;
};
export type MarginReport = {
  totals: { lines: number; revenue: number; cost: number; profit: number;
            margin: number | null; losingModels: number };
  rows: { id: string; name: string; sku: string; qty: number; revenue: number;
          cost: number; profit: number; margin: number | null }[];
};
export type Lead = {
  id: string; number: string; name: string; phone: string; whatsapp: string | null;
  source: string; status: "NEW" | "QUOTED" | "NEGOTIATING" | "WON" | "LOST";
  interest: string | null; estimateValue: number | null;
  showroom: string | null; owner: string | null; ownerId: string;
  customerId: string | null;
  nextFollowUp: string | null; dueNow: boolean;
  lostReason: string | null; lostNote: string | null;
  wonOrderId: string | null; createdAt: string;
  notes: { id: string; note: string; by: string | null; at: string }[];
  quotes: { id: string; number: string; status: string; total: number;
            validUntil: string; createdAt: string }[];
};
export type LeadBoard = {
  totals: { open: number; due: number; won: number; lost: number; noFollowUp: number };
  rows: Lead[];
};
export type Quote = {
  id: string; number: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED"; stored: string;
  lead: { id: string; number: string; name: string } | null;
  customer: { id: string; name: string } | null;
  who: string; phone: string | null;
  validUntil: string; expired: boolean; daysLeft: number;
  subtotal: number; discountTotal: number; taxRate: number; taxTotal: number; total: number;
  note: string | null; by: string | null;
  order: { id: string; code: string } | null;
  createdAt: string;
  lines: { id: string; productId: string;
           product: { nameAr: string; nameEn: string; sku: string };
           qty: number; unitPrice: number; discount: number; lineTotal: number;
           specNotes: string | null }[];
};
export type LeadReport = {
  totals: { leads: number; open: number; won: number; lost: number;
            conversion: number | null; wonValue: number; avgDaysToWin: number | null };
  bySource: { name: string; total: number; won: number; value: number; rate: number | null }[];
  byRep: { name: string; total: number; won: number; value: number; rate: number | null }[];
  lostReasons: { name: string; count: number }[];
};
export type Warranty = {
  orderLineId: string;
  order: { id: string; code: string };
  customer: { name: string; phone: string; address?: string | null };
  product: { nameAr: string; nameEn: string; sku: string };
  deliveredAt: string | null; delivered: boolean;
  months: number; until: string | null; inWarranty: boolean; daysLeft: number | null;
};
export type Ticket = {
  id: string; number: string;
  status: "OPEN" | "SCHEDULED" | "IN_REPAIR" | "DONE" | "REJECTED";
  kind: "WARRANTY" | "PAID" | "GOODWILL";
  description: string;
  defect: { id: string; nameAr: string; nameEn: string } | null;
  underWarranty: boolean; warrantyUntil: string | null; serial: string | null;
  order: { id: string; code: string }; orderLineId: string;
  customer: { name: string; phone: string; address: string | null };
  product: { nameAr: string; nameEn: string; sku: string };
  deliveredAt: string | null;
  reportedBy: string | null; assignedTo: string | null; assignedToId: string | null;
  promisedDate: string | null; resolution: string | null; closedAt: string | null;
  /** Absent for a technician: what a repair cost is the office's business. */
  costAmount?: number; chargeAmount?: number;
  createdAt: string;
  visits: { id: string; outcome: string; note: string | null; photoPath: string | null;
            by: string | null; occurredAt: string }[];
};
export type ServiceReport = {
  totals: { tickets: number; open: number; underWarranty: number; paid: number;
            goodwill: number; rejected: number; cost: number; charged: number;
            repeatVisits: number; avgDaysToClose: number | null };
  byProduct: { name: string; count: number; cost: number }[];
  byDefect: { name: string; count: number; cost: number }[];
  rows: Ticket[];
};
export type PlanRow = {
  id: string; code: string; qty: number;
  priority: number; level: "NORMAL" | "URGENT" | "CRITICAL";
  order: { id: string; code: string }; customer: string;
  product: { nameAr: string; nameEn: string; sku: string };
  promisedDate: string | null; daysLeft: number | null;
  late: boolean; atRisk: boolean; started: boolean;
  done: number; of: number; remainingMinutes: number;
  at: { stage: string; station: string; stationId: string; status: string } | null;
  blocked: { reason: string | null; note: string | null; sinceMinutes: number } | null;
};
export type PlanBoard = {
  totals: { open: number; late: number; atRisk: number; notStarted: number;
            blocked: number; urgent: number; remainingHours: number };
  rows: PlanRow[];
};
export type PromiseDate = {
  date: string | null;
  workingDays: number | null;
  bufferDays: number;
  totalWorkingDays?: number;
  restDays?: number[];
  reason?: string;
  bottleneck?: string | null;
  lines: { qty: number; workingDays: number | null;
           steps: { stage: string; station: string | null; waitDays: number;
                    ownDays: number; readyDay: number }[] }[];
};
export type PromiseWatch = {
  totals: { open: number; atRisk: number; noPromise: number;
            alreadyLate: number; worstSlipDays: number };
  rows: { id: string; orderId: string; orderCode: string; customer: string;
          customerPhone: string; product: { nameAr: string; nameEn: string };
          qty: number; status: string;
          promisedDate: string | null; noPromise: boolean;
          canDoBy: string | null; workingDaysLeft: number | null;
          slipDays: number | null; atRisk: boolean }[];
};
export type StationLoad = {
  totals: { queuedHours: number; capacityHoursPerDay: number; stations: number };
  bottleneck: string | null;
  rows: { id: string; code: string; nameAr: string; nameEn: string;
          dailyCapacityMinutes: number; queuedMinutes: number; queuedHours: number;
          inProgress: number; blocked: number; pieces: number; lateMinutes: number;
          people: number; daysOfQueue: number | null }[];
};
export type MyLimits = {
  role: string; discountPct: number | null; purchaseCeiling: number | null;
  approvalHours: number;
};
export type RoleLimitRow = {
  role: string; nameAr: string; nameEn: string;
  discountPct: number | null; purchaseCeiling: number | null;
  sells: boolean; buys: boolean;
};
export type Approval = {
  id: string; number: string; kind: "ORDER_DISCOUNT" | "PURCHASE_ORDER_VALUE";
  status: "PENDING" | "APPROVED" | "REJECTED" | "USED" | "EXPIRED";
  amount: number; ceiling: number; subject: string; reason: string | null;
  requestedBy: string | null; decidedBy: string | null;
  decidedAt: string | null; decisionNote: string | null;
  usedAt: string | null; spentOn: string | null;
  expiresAt: string; createdAt: string;
};
export type PurchaseRequest = {
  id: string; number: string; status: string;
  warehouse: string | null; warehouseId: string | null;
  neededBy: string | null; note: string | null;
  requestedBy: string | null; decidedBy: string | null;
  decidedAt: string | null; decisionNote: string | null; createdAt: string;
  orders: { id: string; number: string }[];
  lines: { id: string; stockItemId: string; item: string; sku: string;
           unit: string; qty: number; note: string | null }[];
};
export type PurchaseOrder = {
  id: string; number: string; status: string;
  supplier: string | null; supplierId: string;
  warehouse: string | null; warehouseId: string | null;
  requestNumber: string | null; expectedOn: string | null; note: string | null;
  by: string | null; createdAt: string; total: number;
  lines: { id: string; stockItemId: string; item: string; sku: string; unit: string;
           qty: number; received: number; outstanding: number;
           unitPrice: number; lineTotal: number; note: string | null }[];
  receipts: { id: string; number: string; receivedOn: string }[];
  invoices: { id: string; number: string; amount: number }[];
};
export type GoodsReceipt = {
  id: string; number: string; receivedOn: string;
  order: { id: string; number: string };
  supplier: string; warehouse: string; by: string | null; note: string | null;
  lines: { item: string; unit: string; qty: number; batch: string | null }[];
};
export type ThreeWayMatch = {
  order: { id: string; number: string; status: string; supplier: string };
  lines: { item: string; sku: string; unit: string; ordered: number; received: number;
           shortfall: number; unitPrice: number; orderedValue: number; receivedValue: number }[];
  totals: { ordered: number; received: number; billed: number; gap: number };
  invoices: { id: string; number: string; date: string; amount: number }[];
  verdict: { fullyReceived: boolean; billedMoreThanArrived: boolean; notYetBilled: boolean };
};
export type BuySuggestions = {
  totals: { items: number; value: number };
  rows: { id: string; sku: string; name: string; unit: string; onHand: number;
          committed: number; onOrder: number; reorderLevel: number;
          suggest: number; unitCost: number }[];
};
export type DeliveryStop = {
  id: string; status: string; qty: number; retry?: boolean;
  product: { nameAr: string; nameEn: string; sku: string };
  order: { id: string; code: string; invoiceNo: string | null };
  customer: { name: string; phone: string; whatsapp: string | null; address: string | null };
  showroom: string | null;
  promisedDate: string | null;
  specNotes: string | null;
  attempts: { id: string; delivered: boolean; failReason: string | null;
              recipientName: string | null; note: string | null;
              photo: string | null; signature: string | null;
              at: string; by: string | null }[];
};
export type DeliveryRun = {
  onVan: DeliveryStop[]; toDeliver: DeliveryStop[]; done: DeliveryStop[];
  totals: { onVan: number; toDeliver: number; done: number };
};
export type DeliveryReport = {
  from: string; to: string;
  totals: { attempts: number; delivered: number; failed: number;
            repeats: number; firstTimeRate: number };
  byReason: { reason: string; count: number }[];
  byDriver: { name: string; delivered: number; failed: number }[];
  rows: { id: string; at: string; delivered: boolean; reason: string | null;
          customer: string; order: string; recipient: string | null;
          note: string | null; by: string | null }[];
};
export type DefectType = { id: string; code: string; nameAr: string; nameEn: string };
export type QcStage = {
  stageId: string; isQcGate: boolean; status: string;
  workOrder: { id: string; code: string; qty: number };
  product: { nameAr: string; sku: string };
  order: { id: string; code: string; customer: string };
  reworkTargets: { seq: number; nameAr: string; nameEn: string;
                   stationId: string; groupId: string | null; status: string }[];
  history: { id: string; result: string; qty: number; reworkToSeq: number | null;
             note: string | null; at: string; by: string | null;
             defects: { nameAr: string; code: string; qty: number; note: string | null }[] }[];
};
export type QualityReport = {
  from: string; to: string;
  totals: { inspections: number; checked: number; passed: number;
            rework: number; scrap: number; passRate: number };
  byDefect: { name: string; qty: number }[];
  byStation: { name: string; qty: number }[];
  byCrew: { name: string; qty: number }[];
  byProduct: { name: string; checked: number; failed: number; failRate: number }[];
  rows: { id: string; at: string; result: string; qty: number; product: string;
          workOrder: string; defects: string | null; note: string | null }[];
};
export type StockItem = {
  id: string; sku: string; nameAr: string; nameEn: string; kind: "PRODUCT" | "MATERIAL";
  unit: string; reorderLevel: number; unitCost: number;
  productId: string | null; productSku: string | null; isActive: boolean;
  onHand: number; value: number; low: boolean;
  byWarehouse: { warehouseId: string; nameAr: string; nameEn: string; qty: number }[];
};
export type StockMovement = {
  id: string; date: string; item: string; sku: string; unit: string; warehouse: string;
  direction: "IN" | "OUT"; qty: number; reason: string;
  note: string | null; by: string | null; reversal: boolean;
};
export type StockReport = {
  valuation?: string;
  totals: { items: number; value: number; low: number; outOfStock: number };
  rows: { id: string; sku: string; name: string; unit: string; kind: string;
          onHand: number; unitCost: number; value: number;
          reorderLevel: number; low: boolean }[];
};
export type Stocktake = {
  id: string; warehouse: string; warehouseId: string; startedAt: string;
  postedAt: string | null; note: string | null; by: string | null;
  totals: { counted: number; differences: number; value: number };
  lines: { itemId: string; sku: string; nameAr: string; unit: string;
           expected: number; counted: number; variance: number; value: number;
           note: string | null }[];
};
export type AttendanceDay = {
  day: string; weekKey: string;
  lines: { userId: string; nameAr: string; nameEn: string; role: string; dayRate: number;
           status: string; overtimeHours: number; note: string | null; recorded: boolean }[];
};
export type AttendanceWeek = {
  period: string; start: string; end: string; days: string[];
  lines: { userId: string; nameAr: string; nameEn: string; dayRate: number;
           days: number; earned: number;
           cells: { day: string; status: string; overtimeHours: number }[] }[];
};
export type BomLine = {
  id: string; stockItemId: string; nameAr: string; sku: string; unit: string;
  qty: number; unitCost: number; cost: number; note: string | null;
};
export type Payroll = {
  period: string; kind: "WEEKLY" | "MONTHLY"; posted: boolean; postedAt?: string;
  start?: string; end?: string; total: number;
  account?: { id: string; nameAr: string; nameEn: string };
  lines: { userId: string; nameAr: string; nameEn: string; role?: string; amount: number;
           payType?: "MONTHLY" | "DAILY";
           baseSalary?: number; dayRate?: number; daysWorked?: number;
           overtime?: number; bonus?: number;
           advance?: number; deduction?: number; insurance?: number }[];
};
export type Invoice = {
  company: { nameAr: string; nameEn: string; address: string; phone: string;
             email: string; vatNumber: string };
  order: { id: string; code: string; invoiceNo: string; date: string; status: string; promisedDate: string | null;
           showroom: string | null; currency: string };
  customer: { name: string; phone: string | null };
  lines: { nameAr: string; nameEn: string; sku: string; warehouse: string | null; qty: number;
           unitPrice: number; discount: number; lineTotal: number; specNotes: string | null }[];
  totals: { gross: number; discount: number; subtotal: number; taxRate: number; taxTotal: number;
            total: number; paid: number; outstanding: number };
  payments: { voucherNo: string | null; date: string; amount: number; discount: number;
              method: string; account: string; reference: string | null }[];
};
export type Report = {
  from?: string; to?: string;
  totals: Record<string, number>;
  byMethod?: Record<string, number>;
  buckets?: Record<string, number>;
  accounts?: { id: string; code: string; nameAr: string; nameEn: string; kind: string;
    opening: number; in: number; out: number; closing: number }[];
  rows: Record<string, any>[];
};
export type Progress = {
  id: string; code: string; status: string;
  customer: { name: string; phone: string };
  showroomAr: string | null; showroomEn: string | null;
  promisedDate: string | null; late: boolean; daysToPromise: number | null;
  lastUpdate: string | null;
  lines: { id: string; qty: number; status: string; productAr: string; productEn: string;
    stagesTotal: number; stagesDone: number; percent: number; blocked: boolean;
    milestoneAr: string | null; milestoneEn: string | null;
    promisedDate: string | null; receivedAt: string | null; deliveredAt: string | null }[];
  message: { ar: string; en: string };
};
export type OrderDetail = {
  id: string; code: string; status: string; customer: { name: string; phone: string };
  total?: number; paidTotal?: number; promisedDate: string | null;
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
