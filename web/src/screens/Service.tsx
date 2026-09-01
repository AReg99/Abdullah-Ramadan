import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type DefectType, type OrderRow, type ServiceReport,
         type Ticket, type Warranty } from "../api";

type Tab = "open" | "all" | "report";
const TABS: Tab[] = ["open", "all", "report"];
const OUTCOMES = ["FIXED", "NEEDS_PARTS", "TAKEN_TO_FACTORY",
                  "CUSTOMER_ABSENT", "NOT_OUR_FAULT", "OTHER"] as const;
const KINDS = ["WARRANTY", "PAID", "GOODWILL"] as const;

/**
 * ما بعد البيع.
 *
 * The system forgot a piece the moment it was handed over. A customer ringing
 * six months later about a sagging door reached a WhatsApp message and
 * somebody's memory. Every part of the answer was already in the database —
 * when it was delivered, what the model's warranty is — and nothing put the
 * two together.
 */
export default function Service() {
  const { t } = useApp();
  const [tab, setTab] = useState<Tab>("open");
  const [adding, setAdding] = useState(false);
  const [bump, setBump] = useState(0);

  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {TABS.map((x) => (
          <button key={x} className={`btn sm toggle ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`srv_${x}` as any)}
          </button>
        ))}
      </div>

      {tab !== "report" && !adding && (
        <button className="btn sec sm" style={{ marginBottom: 11 }}
                onClick={() => setAdding(true)}>{t("newTicket")}</button>
      )}
      {adding && (
        <NewTicket onClose={() => setAdding(false)}
                   onDone={() => { setAdding(false); setBump(bump + 1); }} />
      )}

      {tab === "report" ? <Report /> : <List key={`${tab}-${bump}`} openOnly={tab === "open"} />}
    </>
  );
}

/* ─────────────────────────────────── البلاغات */

function List({ openOnly }: { openOnly: boolean }) {
  const { t } = useApp();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.tickets()); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (loading) return <div className="empty">{t("loading")}</div>;
  const live = openOnly
    ? rows.filter((r) => !["DONE", "REJECTED"].includes(r.status))
    : rows;
  if (live.length === 0) return <p className="note">{t("noTickets")}</p>;

  return <>{live.map((r) => <Card key={r.id} tk={r} onDone={load} />)}</>;
}

function Card({ tk, onDone }: { tk: Ticket; onDone: () => void }) {
  const { t, lang, toast, me } = useApp();
  const ar = lang === "ar";
  const [open, setOpen] = useState<"" | "visit" | "close" | "send">("");
  const [techs, setTechs] = useState<{ id: string; nameAr: string; nameEn: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const closed = tk.status === "DONE" || tk.status === "REJECTED";

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");
  // The driver and the carpenter record a visit; only the office closes one.
  const office = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                  "SHOWROOM_MANAGER", "SALES_REP", "ACCOUNTANT"].includes(me?.role ?? "");

  return (
    <div className="card" style={{ opacity: closed ? 0.72 : 1 }}>
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm mono">{tk.number}</span>
          <span className="sub">{tk.customer.name} · {when(tk.createdAt)}</span>
          <span className="sub">{ar ? tk.product.nameAr : tk.product.nameEn}</span>
          <span className="sub mono">{tk.order.code}{tk.serial && ` · ${tk.serial}`}</span>
        </span>
        <span style={{ textAlign: "end" }}>
          <span className={`pill ${tk.status === "DONE" ? "ok"
                                 : tk.status === "REJECTED" ? "bad" : "warn"}`}>
            {t(`srvSt_${tk.status}` as any)}
          </span>
          <span className={`pill ${tk.kind === "WARRANTY" ? "pri" : ""}`}
                style={{ marginTop: 5 }}>
            {t(`srvKind_${tk.kind}` as any)}
          </span>
        </span>
      </div>

      <p className="note" style={{ marginTop: 8 }}>{tk.description}</p>
      {tk.defect && <p className="note">{ar ? tk.defect.nameAr : tk.defect.nameEn}</p>}
      {tk.warrantyUntil && (
        <p className="note">
          {tk.underWarranty ? t("coveredUntil") : t("coverEnded")} {when(tk.warrantyUntil)}
        </p>
      )}
      {tk.assignedTo && <p className="note">{t("assignedTo")} {tk.assignedTo}</p>}
      {tk.promisedDate && <p className="note">{t("visitOn")} {when(tk.promisedDate)}</p>}

      {/* Two taps a technician standing in a customer's hall actually makes. */}
      {!closed && (
        <div className="row wrap" style={{ marginTop: 9 }}>
          <a className="btn sec sm toggle" href={`tel:${tk.customer.phone}`}
             style={{ textDecoration: "none" }}>{t("callCustomer")}</a>
          {tk.customer.address && (
            <a className="btn sec sm toggle" target="_blank" rel="noreferrer"
               href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tk.customer.address)}`}
               style={{ textDecoration: "none" }}>{t("openMap")}</a>
          )}
        </div>
      )}

      {tk.visits.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <span className="k">{t("visits")} · {tk.visits.length}</span>
          {tk.visits.map((v) => (
            <div className="evt" key={v.id}>
              <span style={{ flex: 1 }}>
                <b>{t(`out_${v.outcome}` as any)}</b>
                <span className="sub">{when(v.occurredAt)}{v.by && ` · ${v.by}`}</span>
                {v.note && <span className="sub">{v.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {open === "send" && (
        <div style={{ marginTop: 10 }}>
          <span className="k">{t("sendSomebody")}</span>
          <select value={tk.assignedToId ?? ""} style={{ marginTop: 6 }}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await api.patchTicket(tk.id, { assignedToId: e.target.value || null });
                      toast(t("saved")); setOpen(""); onDone();
                    } catch (err: any) { toast(err?.code ? t(err.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>
            <option value="">{t("nobodyYet")}</option>
            {techs.map((x) => (
              <option key={x.id} value={x.id}>{ar ? x.nameAr : x.nameEn}</option>
            ))}
          </select>
          <p className="note">{t("sendHint")}</p>
        </div>
      )}

      {closed ? (
        <>
          {tk.resolution && <p className="note">{t("resolution")}: {tk.resolution}</p>}
          {/* Absent, not zero, for a technician — what a repair cost is the
              office's business and the server does not send it to them. */}
          {tk.costAmount !== undefined && (
            <div className="between" style={{ marginTop: 6 }}>
              <span className="k">{t("costUs")}</span>
              <b className="mono">{num(tk.costAmount)}</b>
            </div>
          )}
          {(tk.chargeAmount ?? 0) > 0 && (
            <div className="between" style={{ marginTop: 4 }}>
              <span className="k">{t("chargedCustomer")}</span>
              <b className="mono" style={{ color: "var(--ok)" }}>{num(tk.chargeAmount!)}</b>
            </div>
          )}
        </>
      ) : (
        <div className="row wrap" style={{ marginTop: 9 }}>
          <button className="btn pri sm toggle" onClick={() => setOpen(open === "visit" ? "" : "visit")}>
            {t("recordVisit")}
          </button>
          {office && (
            <>
              <button className="btn sec sm toggle"
                      onClick={async () => {
                        if (open === "send") return setOpen("");
                        // Loaded on demand: this list is the one thing on the
                        // card that costs a request, and most cards are read
                        // without anybody being sent.
                        if (techs.length === 0) {
                          try { setTechs(await api.technicians()); } catch { /* shown empty */ }
                        }
                        setOpen("send");
                      }}>{t("sendSomebody")}</button>
              <button className="btn sec sm toggle" onClick={() => setOpen(open === "close" ? "" : "close")}>
                {t("closeTicket")}
              </button>
            </>
          )}
        </div>
      )}

      {open === "visit" && <VisitForm tk={tk} onClose={() => setOpen("")}
                                      onDone={() => { setOpen(""); onDone(); }} />}
      {open === "close" && <CloseForm tk={tk} onClose={() => setOpen("")}
                                      onDone={() => { setOpen(""); onDone(); }} />}
    </div>
  );
}

/** What happened on one trip. */
function VisitForm({ tk, onClose, onDone }: {
  tk: Ticket; onClose: () => void; onDone: () => void;
}) {
  const { t, toast } = useApp();
  const [outcome, setOutcome] = useState<string>("FIXED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <span className="k">{t("whatHappened")}</span>
      <select value={outcome} onChange={(e) => setOutcome(e.target.value)}
              style={{ marginTop: 6 }}>
        {OUTCOMES.map((o) => <option key={o} value={o}>{t(`out_${o}` as any)}</option>)}
      </select>
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }} />
      <p className="note">{t("visitHint")}</p>
      <div className="row wrap" style={{ marginTop: 9 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addVisit(tk.id, { outcome, note: note.trim() || undefined });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/** Ending it: what was done, what it cost, and who pays. */
function CloseForm({ tk, onClose, onDone }: {
  tk: Ticket; onClose: () => void; onDone: () => void;
}) {
  const { t, toast } = useApp();
  const [resolution, setResolution] = useState("");
  const [kind, setKind] = useState<string>(tk.kind);
  const [cost, setCost] = useState(String(tk.costAmount || ""));
  const [charge, setCharge] = useState(String(tk.chargeAmount || ""));
  const [rejected, setRejected] = useState(false);
  const [busy, setBusy] = useState(false);

  // A warranty job with money on it is one of the two filled in by mistake,
  // and the customer finds out at the door. The box is not offered at all.
  const chargeable = kind === "PAID";

  return (
    <div style={{ marginTop: 10 }}>
      <span className="k">{t("resolution")}</span>
      <input value={resolution} onChange={(e) => setResolution(e.target.value)}
             style={{ marginTop: 6 }} />

      <span className="k" style={{ marginTop: 10, display: "block" }}>{t("whoPays")}</span>
      <div className="row wrap" style={{ marginTop: 6 }}>
        {KINDS.map((k) => (
          <button key={k} className={`btn sm toggle ${kind === k ? "pri" : "sec"}`}
                  onClick={() => { setKind(k); if (k !== "PAID") setCharge(""); }}>
            {t(`srvKind_${k}` as any)}
          </button>
        ))}
      </div>

      <span className="k" style={{ marginTop: 10, display: "block" }}>{t("costUs")}</span>
      <input className="mono" inputMode="decimal" value={cost}
             onChange={(e) => setCost(e.target.value)} style={{ marginTop: 6 }} />
      <p className="note">{t("costHintService")}</p>

      {chargeable && (
        <>
          <span className="k" style={{ marginTop: 10, display: "block" }}>
            {t("chargedCustomer")}
          </span>
          <input className="mono" inputMode="decimal" value={charge}
                 onChange={(e) => setCharge(e.target.value)} style={{ marginTop: 6 }} />
        </>
      )}

      <button className={`btn sm ${rejected ? "dang" : "sec"}`} style={{ marginTop: 10 }}
              onClick={() => setRejected(!rejected)}>
        {rejected ? t("markedNotOurs") : t("markNotOurs")}
      </button>
      <p className="note">{t("rejectServiceHint")}</p>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle" disabled={busy || !resolution.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.closeTicket(tk.id, {
                      resolution: resolution.trim(), rejected, kind,
                      costAmount: Number(cost) || 0,
                      chargeAmount: chargeable ? Number(charge) || 0 : 0,
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("closeTicket")}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── بلاغ جديد */

/**
 * Taking the call.
 *
 * The warranty answer appears the moment a piece is picked, because the
 * showroom is on the phone to the customer and needs it in that conversation
 * — not after filling in a form and saving it.
 */
function NewTicket({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [defects, setDefects] = useState<DefectType[]>([]);
  const [find, setFind] = useState("");
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");
  const [w, setW] = useState<Warranty | null>(null);
  const [description, setDescription] = useState("");
  const [defectTypeId, setDefectTypeId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.orders().then(setOrders).catch(() => setOrders([]));
    api.defectTypes().then(setDefects).catch(() => setDefects([]));
  }, []);
  useEffect(() => {
    setW(null);
    if (!lineId) return;
    api.warrantyOf(lineId).then(setW).catch(() => setW(null));
  }, [lineId]);

  const q = find.trim().toLowerCase();
  const shown = q
    ? orders.filter((o) => o.code.toLowerCase().includes(q)
                        || o.customer.toLowerCase().includes(q))
    : orders.slice(0, 30);
  const order = orders.find((o) => o.id === orderId);
  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("newTicket")}</span>

      <input placeholder={t("findOrder")} value={find}
             onChange={(e) => setFind(e.target.value)} style={{ marginTop: 8 }} />
      <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setLineId(""); }}
              style={{ marginTop: 8 }}>
        <option value="">{t("pickOrder")}</option>
        {shown.map((o) => (
          <option key={o.id} value={o.id}>{o.code} — {o.customer}</option>
        ))}
      </select>

      {order && (
        <select value={lineId} onChange={(e) => setLineId(e.target.value)} style={{ marginTop: 8 }}>
          <option value="">{t("pickThePiece")}</option>
          {order.lines.map((l) => (
            <option key={l.id} value={l.id}>
              {ar ? l.productAr : l.productEn} · {l.qty}
            </option>
          ))}
        </select>
      )}

      {/* The answer the customer is waiting on the phone for. */}
      {w && (
        <p className="note" style={{
          marginTop: 9,
          color: !w.delivered ? "var(--bad)" : w.inWarranty ? "var(--ok)" : "var(--warn)",
        }}>
          {!w.delivered ? t("notDeliveredYet")
            : w.inWarranty
              ? `${t("coveredUntil")} ${when(w.until!)} — ${
                  w.daysLeft!.toLocaleString(ar ? "ar-EG" : "en-GB")} ${t("daysShort")}`
              : `${t("coverEnded")} ${when(w.until!)} — ${t("chargeableJob")}`}
        </p>
      )}

      <input placeholder={t("whatTheCustomerSaid")} value={description}
             onChange={(e) => setDescription(e.target.value)} style={{ marginTop: 9 }} />
      <select value={defectTypeId} onChange={(e) => setDefectTypeId(e.target.value)}
              style={{ marginTop: 8 }}>
        <option value="">{t("pickDefect")}</option>
        {defects.map((d) => (
          <option key={d.id} value={d.id}>{ar ? d.nameAr : d.nameEn}</option>
        ))}
      </select>
      <p className="note">{t("sameFaultListHint")}</p>

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle"
                disabled={busy || !lineId || !description.trim() || !w?.delivered}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addTicket({
                      orderLineId: lineId, description: description.trim(),
                      defectTypeId: defectTypeId || undefined,
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── التقرير */

/**
 * Which models come back, why, and what it costs.
 *
 * The point of recording any of it. A count of complaints changes nothing;
 * "this wardrobe came back four times and cost eleven thousand" is a decision
 * about a hinge supplier.
 */
function Report() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [r, setR] = useState<ServiceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.serviceReport().then(setR).catch(() => setR(null)).finally(() => setLoading(false));
  }, []);

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 1 });
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!r) return <p className="note">{t("noRows")}</p>;

  return (
    <>
      <div className="tiles g3">
        <div className="tile">
          <span className="k">{t("ticketsYear")}</span>
          <div className="big mono">{num(r.totals.tickets)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("stillOpen")}</span>
          <div className="big mono" style={{ color: r.totals.open ? "var(--warn)" : "var(--ok)" }}>
            {num(r.totals.open)}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("costUs")}</span>
          <div className="big mono" style={{ color: "var(--bad)" }}>{num(r.totals.cost)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("srvKind_WARRANTY")}</span>
          <div className="big mono">{num(r.totals.underWarranty)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("repeatVisits")}</span>
          <div className="big mono" style={{ color: r.totals.repeatVisits ? "var(--warn)" : undefined }}>
            {num(r.totals.repeatVisits)}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("daysToClose")}</span>
          <div className="big mono">
            {r.totals.avgDaysToClose == null ? "—" : num(r.totals.avgDaysToClose)}
          </div>
        </div>
      </div>

      <Rank title={t("byProduct")} rows={r.byProduct} empty={t("noTickets")} num={num} />
      <Rank title={t("byDefect")} rows={r.byDefect} empty={t("noDefects")} num={num} />

      {r.totals.charged > 0 && (
        <div className="card" style={{ marginTop: 11 }}>
          <div className="between">
            <span className="k">{t("chargedCustomer")}</span>
            <b className="mono" style={{ color: "var(--ok)" }}>{num(r.totals.charged)}</b>
          </div>
          <p className="note">{t("chargedHint")}</p>
        </div>
      )}
    </>
  );
}

/** Worst first, because that is the only order worth reading. */
function Rank({ title, rows, empty, num }: {
  title: string; rows: { name: string; count: number; cost: number }[];
  empty: string; num: (n: number) => string;
}) {
  const { t } = useApp();
  const top = rows[0]?.count ?? 0;
  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{title}</span>
      {rows.length === 0 && <p className="note">{empty}</p>}
      {rows.map((x) => (
        <div key={x.name} style={{ marginTop: 9 }}>
          <div className="between">
            <span style={{ flex: 1 }}>{x.name}</span>
            <b className="mono">{num(x.count)}</b>
          </div>
          <div style={{ height: 4, background: "var(--g2)", borderRadius: 100, marginTop: 5 }}>
            <div style={{
              height: "100%", borderRadius: 100, background: "var(--bad)",
              width: `${top > 0 ? Math.round((x.count / top) * 100) : 0}%`,
            }} />
          </div>
          {x.cost > 0 && (
            <p className="note">{t("costUs")} {num(x.cost)}</p>
          )}
        </div>
      ))}
    </div>
  );
}
