import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, ApiError, type Approval, type BuySuggestions, type GoodsReceipt,
         type LocationRow, type MyLimits, type PurchaseOrder, type PurchaseRequest,
         type StockItem, type ThreeWayMatch } from "../api";

type Tab = "buy" | "requests" | "orders" | "receipts";
const TABS: Tab[] = ["buy", "requests", "orders", "receipts"];

/**
 * المشتريات — طلب شراء ← أمر شراء ← إذن استلام ← الفاتورة.
 *
 * The books used to hear about a purchase for the first time from the
 * supplier's invoice, which is the last moment anything can still be done
 * about it: the money is owed, nobody approved it, and there is nothing to
 * check the delivery against. Each of the three steps here answers a question
 * the invoice cannot: who wanted it, what was agreed, and what actually
 * turned up.
 */
export default function Purchasing() {
  const { t, me } = useApp();
  const [tab, setTab] = useState<Tab>("buy");

  const role = me?.role ?? "";
  const books = ["OWNER", "ACCOUNTANT"].includes(role);       // commits money
  const approver = role === "OWNER";                          // approves a request
  const receiver = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "STOREKEEPER",
                    "SHOWROOM_MANAGER", "SALES_REP", "ACCOUNTANT"].includes(role);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {TABS.map((x) => (
          <button key={x} className={`btn sm toggle ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`buy_${x}` as any)}
          </button>
        ))}
      </div>

      {tab === "buy" && <Suggest />}
      {tab === "requests" && <Requests approver={approver} books={books} />}
      {tab === "orders" && <Orders books={books} receiver={receiver} />}
      {tab === "receipts" && <Receipts />}
    </>
  );
}

/* ─────────────────────────────────── اللي لازم يتشترى */

/**
 * What to buy, worked out rather than remembered.
 *
 * The reorder level says what the shelf should not drop below and the bill of
 * materials says what the orders already in the factory will eat. Both existed
 * and nothing was doing the subtraction, so the first anyone knew of a
 * shortage was a stopped station.
 */
function Suggest() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [s, setS] = useState<BuySuggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState(false);

  const load = () => {
    setLoading(true);
    api.buySuggestions().then(setS).catch(() => setS(null)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const chosen = (s?.rows ?? []).filter((r) => picked[r.id]);

  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!s) return <p className="note">{t("noRows")}</p>;

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="k">{t("itemsToBuy")}</span>
          <div className="big mono" style={{ color: s.totals.items ? "var(--warn)" : "var(--ok)" }}>
            {num(s.totals.items)}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("estimatedCost")}</span>
          <div className="big mono">{num(Math.round(s.totals.value))}</div>
        </div>
      </div>

      {s.rows.length === 0 && <p className="note">{t("nothingToBuy")}</p>}

      {s.rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm">{r.name}</span>
              <span className="sub mono">{r.sku}</span>
            </span>
            <button className={`chip${picked[r.id] ? " on" : ""}`}
                    onClick={() => setPicked({ ...picked, [r.id]: !picked[r.id] })}>
              {picked[r.id] ? t("picked") : t("pick")}
            </button>
          </div>
          <p className="note">
            {t("onShelfNow")} {num(r.onHand)} · {t("committedToOrders")} {num(r.committed)}
            {r.onOrder > 0 && <> · {t("alreadyOnOrder")} {num(r.onOrder)}</>}
            {" · "}{t("reorderAt")} {num(r.reorderLevel)}
          </p>
          <div className="between" style={{ marginTop: 6 }}>
            <span className="k">{t("buyThisMuch")}</span>
            <b className="mono" style={{ color: "var(--warn)" }}>{num(r.suggest)} {r.unit}</b>
          </div>
        </div>
      ))}

      {chosen.length > 0 && !asking && (
        <button className="btn pri" style={{ marginTop: 12 }} onClick={() => setAsking(true)}>
          {t("raiseRequest")} · {chosen.length}
        </button>
      )}

      {asking && (
        <NewRequest
          seed={chosen.map((c) => ({ stockItemId: c.id, qty: String(c.suggest) }))}
          onClose={() => setAsking(false)}
          onDone={() => { setAsking(false); setPicked({}); load(); }} />
      )}
    </>
  );
}

/* ─────────────────────────────────── طلبات الشراء */

function Requests({ approver, books }: { approver: boolean; books: boolean }) {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [rows, setRows] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    api.purchaseRequests().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  return (
    <>
      {!adding && (
        <button className="btn sec sm" style={{ marginBottom: 11 }} onClick={() => setAdding(true)}>
          {t("newRequest")}
        </button>
      )}
      {adding && <NewRequest onClose={() => setAdding(false)}
                             onDone={() => { setAdding(false); load(); }} />}

      {loading && <div className="empty">{t("loading")}</div>}
      {!loading && rows.length === 0 && <p className="note">{t("noRequests")}</p>}

      {rows.map((r) => (
        <RequestCard key={r.id} r={r} approver={approver} books={books}
                     when={when} onDone={load} />
      ))}
    </>
  );
}

function RequestCard({ r, approver, books, when, onDone }: {
  r: PurchaseRequest; approver: boolean; books: boolean;
  when: (d: string) => string; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const num = (v: number) =>
    v.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.decideRequest(r.id, { approve, note: note.trim() || undefined });
      toast(approve ? t("approved") : t("rejected"));
      setDeciding(false); onDone();
    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm mono">{r.number}</span>
          <span className="sub">
            {r.requestedBy ?? "—"} · {when(r.createdAt)}
            {r.warehouse && <> · {r.warehouse}</>}
          </span>
        </span>
        <span className={`pill ${r.status === "APPROVED" ? "ok"
                              : r.status === "REJECTED" ? "bad"
                              : r.status === "ORDERED" ? "ok" : "warn"}`}>
          {t(`pr_${r.status}` as any)}
        </span>
      </div>

      {r.lines.map((l) => (
        <div className="evt" key={l.id}>
          <span style={{ flex: 1 }}>
            <b>{l.item}</b>
            <span className="sub mono">{l.sku}</span>
            {l.note && <span className="sub">{l.note}</span>}
          </span>
          <b><span className="mono">{num(l.qty)}</span> {l.unit}</b>
        </div>
      ))}

      {r.neededBy && <p className="note">{t("neededBy")} {when(r.neededBy)}</p>}
      {r.note && <p className="note">{r.note}</p>}
      {r.decidedBy && (
        <p className="note">
          {r.status === "REJECTED" ? t("rejectedBy") : t("approvedBy")} {r.decidedBy}
          {r.decisionNote && ` — ${r.decisionNote}`}
        </p>
      )}
      {r.orders.length > 0 && (
        <p className="note">
          {t("orderedOn")} <span className="mono">{r.orders.map((o) => o.number).join(" · ")}</span>
        </p>
      )}

      {approver && r.status === "SUBMITTED" && !deciding && (
        <button className="btn sec sm" style={{ marginTop: 9 }}
                onClick={() => setDeciding(true)}>{t("decideIt")}</button>
      )}

      {deciding && (
        <>
          <input placeholder={t("decisionNote")} value={note}
                 onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
          {/* A refusal without a reason gets asked again next week by the same
              person for the same thing. */}
          <p className="note">{t("rejectNeedsReason")}</p>
          <div className="row" style={{ marginTop: 9 }}>
            <button className="btn sec sm" onClick={() => setDeciding(false)}>{t("cancel")}</button>
            <button className="btn dang sm" disabled={busy || !note.trim()}
                    onClick={() => decide(false)}>{t("reject")}</button>
            <button className="btn pri sm" disabled={busy}
                    onClick={() => decide(true)}>{t("approve")}</button>
          </div>
        </>
      )}

      {books && r.status === "APPROVED" && !ordering && (
        <button className="btn pri sm" style={{ marginTop: 9 }}
                onClick={() => setOrdering(true)}>{t("raiseOrder")}</button>
      )}
      {ordering && (
        <NewOrder request={r} onClose={() => setOrdering(false)}
                  onDone={() => { setOrdering(false); onDone(); }} />
      )}
    </div>
  );
}

/** Asking for materials. Deliberately open to the floor — they run out, not the office. */
function NewRequest({ seed, onClose, onDone }: {
  seed?: { stockItemId: string; qty: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [items, setItems] = useState<StockItem[]>([]);
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState(seed?.length ? seed : [{ stockItemId: "", qty: "" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.stockItems().then(setItems).catch(() => setItems([]));
    api.locations().then(setStores).catch(() => setStores([]));
  }, []);

  const ready = lines.every((l) => l.stockItemId && Number(l.qty) > 0)
    && new Set(lines.map((l) => l.stockItemId)).size === lines.length;

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("newRequest")}</span>

      {lines.map((l, i) => (
        <div key={i} style={{ marginTop: 9 }}>
          <select value={l.stockItemId}
                  onChange={(e) => setLines(lines.map((x, j) =>
                    j === i ? { ...x, stockItemId: e.target.value } : x))}>
            <option value="">{t("pickItem")}</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {ar ? it.nameAr : it.nameEn} · {it.sku}
              </option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="mono" inputMode="decimal" placeholder={t("qty")} value={l.qty}
                   onChange={(e) => setLines(lines.map((x, j) =>
                     j === i ? { ...x, qty: e.target.value } : x))} />
            {lines.length > 1 && (
              <button className="btn dang sm toggle"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        </div>
      ))}

      <button className="btn sec sm" style={{ marginTop: 9 }}
              onClick={() => setLines([...lines, { stockItemId: "", qty: "" }])}>
        {t("addLine")}
      </button>

      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              style={{ marginTop: 9 }}>
        <option value="">{t("pickWarehouse")}</option>
        {stores.map((w) => <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>)}
      </select>
      <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)}
             style={{ marginTop: 9 }} />
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
      <p className="note">{t("requestHint")}</p>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !ready}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addPurchaseRequest({
                      warehouseId: warehouseId || undefined,
                      neededBy: neededBy ? new Date(neededBy).toISOString() : undefined,
                      note: note.trim() || undefined,
                      lines: lines.map((l) => ({ stockItemId: l.stockItemId, qty: Number(l.qty) })),
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("send")}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── أوامر الشراء */

function Orders({ books, receiver }: { books: boolean; receiver: boolean }) {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    api.purchaseOrders().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  const open = rows.filter((o) => o.status === "OPEN" || o.status === "PART_RECEIVED");
  const owed = open.reduce((s, o) => s + o.total, 0);

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="k">{t("openOrders")}</span>
          <div className="big mono">
            {open.length.toLocaleString(ar ? "ar-EG" : "en-GB")}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("onOrderValue")}</span>
          <div className="big mono">
            {Math.round(owed).toLocaleString(ar ? "ar-EG" : "en-GB")}
          </div>
        </div>
      </div>

      {books && !adding && (
        <button className="btn sec sm" style={{ margin: "11px 0" }}
                onClick={() => setAdding(true)}>{t("newOrder2")}</button>
      )}
      {adding && <NewOrder onClose={() => setAdding(false)}
                           onDone={() => { setAdding(false); load(); }} />}

      {loading && <div className="empty">{t("loading")}</div>}
      {!loading && rows.length === 0 && <p className="note">{t("noOrdersYet")}</p>}

      {rows.map((o) => (
        <OrderCard key={o.id} o={o} books={books} receiver={receiver} when={when} onDone={load} />
      ))}
    </>
  );
}

function OrderCard({ o, books, receiver, when, onDone }: {
  o: PurchaseOrder; books: boolean; receiver: boolean;
  when: (d: string) => string; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [receiving, setReceiving] = useState(false);
  const [match, setMatch] = useState<ThreeWayMatch | null>(null);
  const [busy, setBusy] = useState(false);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const live = o.status === "OPEN" || o.status === "PART_RECEIVED";

  return (
    <div className="card">
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm mono">{o.number}</span>
          <span className="sub">
            {o.supplier ?? "—"} · {when(o.createdAt)}
            {o.requestNumber && <> · <span className="mono">{o.requestNumber}</span></>}
          </span>
        </span>
        <span className={`pill ${o.status === "RECEIVED" ? "ok"
                              : o.status === "CANCELLED" ? "bad" : "warn"}`}>
          {t(`po_${o.status}` as any)}
        </span>
      </div>

      {o.lines.map((l) => (
        <div className="evt" key={l.id}>
          <span style={{ flex: 1 }}>
            <b>{l.item}</b>
            <span className="sub mono">
              {num(l.received)} / {num(l.qty)} {l.unit} × {num(l.unitPrice)}
            </span>
          </span>
          <b className="mono" style={{ color: l.outstanding > 0 ? "var(--warn)" : "var(--ok)" }}>
            {num(l.lineTotal)}
          </b>
        </div>
      ))}

      <div className="between" style={{ marginTop: 8 }}>
        <span className="k">{t("total")}</span>
        <b className="mono">{num(o.total)}</b>
      </div>
      {o.expectedOn && <p className="note">{t("expectedOn")} {when(o.expectedOn)}</p>}
      {o.note && <p className="note">{o.note}</p>}
      {o.receipts.length > 0 && (
        <p className="note">
          {t("received")}: <span className="mono">
            {o.receipts.map((r) => r.number).join(" · ")}</span>
        </p>
      )}
      {o.invoices.length > 0 && (
        <p className="note">
          {t("billed")}: <span className="mono">
            {o.invoices.map((i) => i.number).join(" · ")}</span>
        </p>
      )}

      <div className="row wrap" style={{ marginTop: 9 }}>
        {receiver && live && !receiving && (
          <button className="btn pri sm toggle" onClick={() => setReceiving(true)}>
            {t("receiveGoods")}
          </button>
        )}
        {books && (
          <button className="btn sec sm toggle" disabled={busy}
                  onClick={async () => {
                    if (match) return setMatch(null);
                    setBusy(true);
                    try { setMatch(await api.threeWayMatch(o.id)); }
                    catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>{t("threeWayMatch")}</button>
        )}
        {books && live && o.receipts.length === 0 && (
          <button className="btn dang sm toggle" disabled={busy}
                  onClick={async () => {
                    if (!confirm(`${t("confirmCancelOrder")}\n\n${o.number}`)) return;
                    setBusy(true);
                    try { await api.cancelPurchaseOrder(o.id); toast(t("cancelled")); onDone(); }
                    catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>{t("cancelPO")}</button>
        )}
      </div>

      {receiving && (
        <Receive order={o} onClose={() => setReceiving(false)}
                 onDone={() => { setReceiving(false); onDone(); }} />
      )}
      {match && <Match m={match} num={num} />}
    </div>
  );
}

/** What was agreed, and at what price. Only the books commit money. */
function NewOrder({ request, onClose, onDone }: {
  request?: PurchaseRequest; onClose: () => void; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [items, setItems] = useState<StockItem[]>([]);
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(request?.warehouseId ?? "");
  const [expectedOn, setExpectedOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyLimits | null>(null);
  const [slips, setSlips] = useState<Approval[]>([]);
  const [using, setUsing] = useState<Approval | null>(null);
  const [blocked, setBlocked] = useState<{ allowed: number; asked: number } | null>(null);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const [lines, setLines] = useState<{ stockItemId: string; qty: string; unitPrice: string }[]>(
    request?.lines.map((l) => ({ stockItemId: l.stockItemId, qty: String(l.qty), unitPrice: "" }))
      ?? [{ stockItemId: "", qty: "", unitPrice: "" }]);

  useEffect(() => {
    api.stockItems().then((rows) => {
      setItems(rows);
      // The last cost paid is the honest first guess at the next one, and it
      // saves retyping a price list nobody keeps up to date.
      setLines((ls) => ls.map((l) => l.unitPrice ? l : {
        ...l, unitPrice: String(rows.find((i) => i.id === l.stockItemId)?.unitCost ?? ""),
      }));
    }).catch(() => setItems([]));
    api.locations().then(setStores).catch(() => setStores([]));
    api.suppliers().then(setSuppliers).catch(() => setSuppliers([]));
    api.myLimits().then(setMine).catch(() => setMine(null));
    void loadSlips();
  }, []);

  const loadSlips = () => api.approvals({ mine: true, status: "APPROVED" })
    .then((a) => setSlips(a.filter((x) => x.kind === "PURCHASE_ORDER_VALUE")))
    .catch(() => setSlips([]));

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
  const overCeiling = mine?.purchaseCeiling != null && total > mine.purchaseCeiling + 0.005;
  const ready = Boolean(supplierId)
    && lines.every((l) => l.stockItemId && Number(l.qty) > 0 && Number(l.unitPrice) >= 0)
    && new Set(lines.map((l) => l.stockItemId)).size === lines.length;

  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{t("newOrder2")}{request && <> · {request.number}</>}</span>

      <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}
              style={{ marginTop: 9 }}>
        <option value="">{t("pickSupplier")}</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {lines.map((l, i) => (
        <div key={i} style={{ marginTop: 9 }}>
          <select value={l.stockItemId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setLines(lines.map((x, j) => j === i ? {
                      ...x, stockItemId: id,
                      unitPrice: x.unitPrice
                        || String(items.find((it) => it.id === id)?.unitCost ?? ""),
                    } : x));
                  }}>
            <option value="">{t("pickItem")}</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{ar ? it.nameAr : it.nameEn} · {it.sku}</option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="mono" inputMode="decimal" placeholder={t("qty")} value={l.qty}
                   onChange={(e) => setLines(lines.map((x, j) =>
                     j === i ? { ...x, qty: e.target.value } : x))} />
            <input className="mono" inputMode="decimal" placeholder={t("unitPrice")}
                   value={l.unitPrice}
                   onChange={(e) => setLines(lines.map((x, j) =>
                     j === i ? { ...x, unitPrice: e.target.value } : x))} />
            {lines.length > 1 && (
              <button className="btn dang sm toggle"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button>
            )}
          </div>
        </div>
      ))}

      <button className="btn sec sm" style={{ marginTop: 9 }}
              onClick={() => setLines([...lines, { stockItemId: "", qty: "", unitPrice: "" }])}>
        {t("addLine")}
      </button>

      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              style={{ marginTop: 9 }}>
        <option value="">{t("pickWarehouse")}</option>
        {stores.map((w) => <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>)}
      </select>
      <input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)}
             style={{ marginTop: 9 }} />
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />

      <div className="between" style={{ marginTop: 10 }}>
        <span className="k">{t("total")}</span>
        <b className="mono" style={{ color: overCeiling ? "var(--warn)" : undefined }}>
          {Math.round(total).toLocaleString(ar ? "ar-EG" : "en-GB")}
        </b>
      </div>
      {mine?.purchaseCeiling != null && (
        <p className="note" style={{ color: overCeiling ? "var(--warn)" : undefined }}>
          {t("youMayTake")} {mine.purchaseCeiling.toLocaleString(ar ? "ar-EG" : "en-GB")}
        </p>
      )}
      <p className="note">{t("orderHint")}</p>

      {slips.length > 0 && !using && overCeiling && (
        <>
          <span className="k" style={{ marginTop: 10, display: "block" }}>{t("usableApprovals")}</span>
          {slips.map((a) => (
            <div className="evt" key={a.id}>
              <span style={{ flex: 1 }}>
                <b className="mono">{a.amount.toLocaleString(ar ? "ar-EG" : "en-GB")}</b>
                <span className="sub">{a.subject}</span>
              </span>
              <button className="btn sec sm toggle"
                      onClick={() => { setUsing(a); setBlocked(null); }}>{t("useApproval")}</button>
            </div>
          ))}
        </>
      )}
      {using && (
        <div className="between" style={{ marginTop: 9 }}>
          <span className="sub mono">{t("usingApproval")} {using.number}</span>
          <button className="chip" onClick={() => setUsing(null)}>{t("clearApproval")}</button>
        </div>
      )}

      {blocked && (
        <div className="card" style={{ marginTop: 10, borderColor: "var(--warn)" }}>
          <span className="k" style={{ color: "var(--warn)" }}>{t("order_needs_approval")}</span>
          <div className="between" style={{ marginTop: 8 }}>
            <span className="k">{t("youMayTake")}</span>
            <b className="mono">{blocked.allowed.toLocaleString(ar ? "ar-EG" : "en-GB")}</b>
          </div>
          <div className="between" style={{ marginTop: 5 }}>
            <span className="k">{t("youAsked")}</span>
            <b className="mono" style={{ color: "var(--warn)" }}>
              {blocked.asked.toLocaleString(ar ? "ar-EG" : "en-GB")}
            </b>
          </div>
          {sent ? (
            <p className="note" style={{ color: "var(--ok)" }}>{t("askSent")}</p>
          ) : (
            <>
              <input placeholder={t("approvalReason")} value={reason}
                     onChange={(e) => setReason(e.target.value)} style={{ marginTop: 9 }} />
              <button className="btn pri sm" style={{ marginTop: 9 }} disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.askApproval({
                            kind: "PURCHASE_ORDER_VALUE", amount: blocked.asked,
                            subject: `${suppliers.find((x) => x.id === supplierId)?.name ?? "—"}`,
                            reason: reason.trim() || undefined,
                          });
                          setSent(true); toast(t("askSent")); await loadSlips();
                        } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("askForIt")}</button>
            </>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !ready}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addPurchaseOrder({
                      supplierId, requestId: request?.id,
                      warehouseId: warehouseId || undefined,
                      expectedOn: expectedOn ? new Date(expectedOn).toISOString() : undefined,
                      note: note.trim() || undefined, approvalId: using?.id,
                      lines: lines.map((l) => ({
                        stockItemId: l.stockItemId, qty: Number(l.qty),
                        unitPrice: Number(l.unitPrice) || 0,
                      })),
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) {
                    // A ceiling, not a failure. The figures come back with it
                    // so the accountant can ask from where they are standing.
                    if (e instanceof ApiError && e.code === "order_needs_approval") {
                      setBlocked({ allowed: e.detail.allowed ?? 0, asked: e.detail.asked ?? total });
                      setUsing(null); setSent(false);
                    }
                    toast(e?.code ? t(e.code) : t("signInFailed"));
                  }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/**
 * إذن الاستلام — what actually turned up.
 *
 * The quantities start at what is still outstanding, because that is what a
 * complete delivery looks like and the storekeeper only has to correct a
 * short one.
 */
function Receive({ order, onClose, onDone }: {
  order: PurchaseOrder; onClose: () => void; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [warehouseId, setWarehouseId] = useState(order.warehouseId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(order.lines.map((l) => [l.id, l.outstanding > 0 ? String(l.outstanding) : "0"])));
  const [batch, setBatch] = useState<Record<string, string>>({});

  useEffect(() => { api.locations().then(setStores).catch(() => setStores([])); }, []);

  const taking = order.lines.filter((l) => Number(qty[l.id]) > 0);
  const over = taking.some((l) => Number(qty[l.id]) > l.outstanding + 0.0005);

  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{t("receiveGoods")} · {order.number}</span>

      {order.lines.map((l) => (
        <div key={l.id} style={{ marginTop: 9 }}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm">{l.item}</span>
              <span className="sub">
                {t("stillOutstanding")}{" "}
                <span className="mono">{num(l.outstanding)}</span> {l.unit}
              </span>
            </span>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="mono" inputMode="decimal" placeholder={t("qty")}
                   value={qty[l.id] ?? ""}
                   onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            <input className="mono" placeholder={t("batch")} value={batch[l.id] ?? ""}
                   onChange={(e) => setBatch({ ...batch, [l.id]: e.target.value })} />
          </div>
        </div>
      ))}

      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
              style={{ marginTop: 9 }}>
        <option value="">{t("pickWarehouse")}</option>
        {stores.map((w) => <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>)}
      </select>
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
      <p className="note">{t("receiveHint")}</p>
      {over && <p className="note" style={{ color: "var(--bad)" }}>{t("more_than_ordered")}</p>}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || over || taking.length === 0 || !warehouseId}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.receiveOrder(order.id, {
                      warehouseId, note: note.trim() || undefined,
                      lines: taking.map((l) => ({
                        orderLineId: l.id, qty: Number(qty[l.id]),
                        batch: batch[l.id]?.trim() || undefined,
                      })),
                    });
                    toast(`${t("goodsReceived")} · ${r.receipt.number}`);
                    onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("confirmReceipt")}</button>
      </div>
    </div>
  );
}

/**
 * المطابقة الثلاثية.
 *
 * Ordered, arrived, billed. Any two of the three can agree while the third
 * disagrees, and that is exactly the case worth catching before a cheque
 * is written.
 */
function Match({ m, num }: { m: ThreeWayMatch; num: (n: number) => string }) {
  const { t } = useApp();
  const bad = m.verdict.billedMoreThanArrived;

  return (
    <div className="card" style={{ marginTop: 11, background: "var(--g1)" }}>
      <span className="k">{t("threeWayMatch")}</span>

      {m.lines.map((l) => (
        <div className="evt" key={l.sku}>
          <span style={{ flex: 1 }}>
            <b>{l.item}</b>
            <span className="sub mono">
              {t("ordered")} {num(l.ordered)} · {t("arrived")} {num(l.received)}
            </span>
          </span>
          {l.shortfall > 0.0005
            ? <b className="mono" style={{ color: "var(--warn)" }}>−{num(l.shortfall)}</b>
            : <b className="mono" style={{ color: "var(--ok)" }}>✓</b>}
        </div>
      ))}

      <div className="between" style={{ marginTop: 9 }}>
        <span className="k">{t("orderedValue")}</span>
        <b className="mono">{num(m.totals.ordered)}</b>
      </div>
      <div className="between" style={{ marginTop: 5 }}>
        <span className="k">{t("arrivedValue")}</span>
        <b className="mono">{num(m.totals.received)}</b>
      </div>
      <div className="between" style={{ marginTop: 5 }}>
        <span className="k">{t("billedValue")}</span>
        <b className="mono">{num(m.totals.billed)}</b>
      </div>
      {/* Before any invoice arrives the gap is just the whole delivery with a
          minus sign in front of it, which reads like money owed to you. */}
      {!m.verdict.notYetBilled && (
        <div className="between" style={{ marginTop: 5 }}>
          <span className="k">{t("theGap")}</span>
          <b className="mono" style={{ color: bad ? "var(--bad)" : "var(--ok)" }}>
            {num(m.totals.gap)}
          </b>
        </div>
      )}

      <p className="note" style={{ color: bad ? "var(--bad)" : undefined }}>
        {bad ? t("billedMoreThanArrived")
             : m.verdict.notYetBilled ? t("notYetBilled")
             : m.verdict.fullyReceived ? t("matchAgrees") : t("stillOwedGoods")}
      </p>
    </div>
  );
}

/* ─────────────────────────────────── أذون الاستلام */

function Receipts() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const [rows, setRows] = useState<GoodsReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.goodsReceipts().then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  if (loading) return <div className="empty">{t("loading")}</div>;
  if (rows.length === 0) return <p className="note">{t("noReceiptsYet")}</p>;

  return (
    <>
      {rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm mono">{r.number}</span>
              <span className="sub">
                {r.supplier} · {when(r.receivedOn)} · {r.warehouse}
              </span>
              <span className="sub mono">{r.order.number}</span>
            </span>
          </div>
          {r.lines.map((l, i) => (
            <div className="evt" key={i}>
              <span style={{ flex: 1 }}>
                <b>{l.item}</b>
                {l.batch && <span className="sub mono">{t("batch")} {l.batch}</span>}
              </span>
              <b><span className="mono">{num(l.qty)}</span> {l.unit}</b>
            </div>
          ))}
          {r.by && <p className="note">{t("receivedBy")}: {r.by}</p>}
          {r.note && <p className="note">{r.note}</p>}
        </div>
      ))}
    </>
  );
}
