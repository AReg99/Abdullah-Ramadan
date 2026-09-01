import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, type Lead, type LeadBoard, type LeadReport,
         type ProductRow, type Quote } from "../api";
import { useApp } from "../app-context";

type Tab = "board" | "quotes" | "report";
const TABS: Tab[] = ["board", "quotes", "report"];
const SOURCES = ["WALK_IN", "PHONE", "WHATSAPP", "INSTAGRAM",
                 "FACEBOOK", "REFERRAL", "OTHER"] as const;
const LOST = ["PRICE", "LEAD_TIME", "BOUGHT_ELSEWHERE",
              "CHANGED_MIND", "NO_CONTACT", "OTHER"] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * العملاء المحتملين وعروض الأسعار.
 *
 * The showroom could record exactly one thing: a confirmed order. Somebody who
 * walked in, was given a price and said they would think about it left no trace
 * at all — nobody could be followed up, nobody knew how many walk-ins became
 * sales, and the next quote was retyped from nothing.
 */
export default function Leads() {
  const { t, me } = useApp();
  // The accountant reads how many walk-ins became sales and never touches a
  // lead. Offering them the board would hand them a tab that refuses them.
  const works = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "");
  const [tab, setTab] = useState<Tab>(works ? "board" : "report");
  const tabs = works ? TABS : (["report"] as Tab[]);

  return (
    <>
      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map((x) => (
            <button key={x} className={`btn sm ${tab === x ? "pri" : "sec"}`}
                    style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
              {t(`lead_${x}` as any)}
            </button>
          ))}
        </div>
      )}
      {tab === "board" ? <Board /> : tab === "quotes" ? <Quotes /> : <Report />}
    </>
  );
}

/* ─────────────────────────────────── اللوحة */

function Board() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [b, setB] = useState<LeadBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [only, setOnly] = useState<"" | "due" | "open">("");

  const load = async () => {
    setLoading(true);
    try { setB(await api.leads()); }
    catch { setB(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!b) return <p className="empty">{t("noRows")}</p>;

  const rows = b.rows.filter((l) =>
    only === "due" ? l.dueNow
    : only === "open" ? !["WON", "LOST"].includes(l.status)
    : true);

  return (
    <>
      <div className="tiles g3">
        <Tile k={t("dueToday")} v={num(b.totals.due)} tone={b.totals.due ? "warn" : "ok"}
              on={() => setOnly(only === "due" ? "" : "due")} lit={only === "due"} />
        <Tile k={t("openLeads")} v={num(b.totals.open)}
              on={() => setOnly(only === "open" ? "" : "open")} lit={only === "open"} />
        <Tile k={t("noNextCall")} v={num(b.totals.noFollowUp)}
              tone={b.totals.noFollowUp ? "warn" : undefined} />
        <Tile k={t("wonLeads")} v={num(b.totals.won)} tone="ok" />
        <Tile k={t("lostLeads")} v={num(b.totals.lost)} tone={b.totals.lost ? "bad" : undefined} />
        <Tile k={t("all")} v={num(b.rows.length)}
              on={() => setOnly("")} lit={only === ""} />
      </div>

      {!adding && (
        <button className="btn sec sm" style={{ margin: "11px 0" }}
                onClick={() => setAdding(true)}>{t("newLead")}</button>
      )}
      {adding && <NewLead onClose={() => setAdding(false)}
                          onDone={() => { setAdding(false); load(); }} />}

      <p className="note">{t("boardHint")}</p>
      {rows.length === 0 && <p className="note">{t("nothingHere")}</p>}
      {rows.map((l) => <LeadCard key={l.id} l={l} ar={ar} onDone={load} />)}
    </>
  );
}

function Tile({ k, v, tone, on, lit }: {
  k: string; v: string; tone?: "ok" | "warn" | "bad"; on?: () => void; lit?: boolean;
}) {
  const colour = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)"
               : tone === "ok" ? "var(--ok)" : undefined;
  return (
    <div className="tile" onClick={on}
         style={{ cursor: on ? "pointer" : undefined,
                  borderColor: lit ? "var(--p)" : undefined }}>
      <span className="k">{k}</span>
      <div className="big mono" style={{ color: colour }}>{v}</div>
    </div>
  );
}

function LeadCard({ l, ar, onDone }: { l: Lead; ar: boolean; onDone: () => void }) {
  const { t, toast } = useApp();
  const [open, setOpen] = useState<"" | "note" | "quote" | "lost">("");
  const settled = l.status === "WON" || l.status === "LOST";

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");

  return (
    <div className="card" style={{
      opacity: settled ? 0.72 : 1,
      // The one thing a rep scans for down a long list.
      borderInlineStartWidth: l.dueNow ? 3 : undefined,
      borderInlineStartColor: l.dueNow ? "var(--warn)" : undefined,
    }}>
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm">{l.name}</span>
          <span className="sub mono">{l.number} · {l.phone}</span>
          <span className="sub">
            {t(`src_${l.source}` as any)}
            {l.owner && ` · ${l.owner}`} · {when(l.createdAt)}
          </span>
        </span>
        <span className={`pill ${l.status === "WON" ? "ok"
                              : l.status === "LOST" ? "bad"
                              : l.dueNow ? "warn" : ""}`}>
          {t(`ld_${l.status}` as any)}
        </span>
      </div>

      {l.interest && <p className="note">{l.interest}</p>}
      {l.estimateValue != null && (
        <p className="note">{t("roughly")} {num(l.estimateValue)}</p>
      )}
      {l.nextFollowUp && (
        <p className="note" style={{ color: l.dueNow ? "var(--warn)" : undefined }}>
          {t("ringOn")} {when(l.nextFollowUp)}
        </p>
      )}
      {l.status === "LOST" && l.lostReason && (
        <p className="note" style={{ color: "var(--bad)" }}>
          {t(`lost_${l.lostReason}` as any)}{l.lostNote && ` — ${l.lostNote}`}
        </p>
      )}

      {l.quotes.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="k">{t("lead_quotes")}</span>
          {l.quotes.map((q) => (
            <div className="evt" key={q.id}>
              <span style={{ flex: 1 }}>
                <b className="mono">{q.number}</b>
                <span className="sub">{t(`qs_${q.status}` as any)} · {when(q.validUntil)}</span>
              </span>
              <b className="mono">{num(q.total)}</b>
            </div>
          ))}
        </div>
      )}

      {l.notes.length > 0 && (
        <p className="note" style={{ marginTop: 8 }}>
          <b>{l.notes[0].by ?? "—"}</b> · {when(l.notes[0].at)} — {l.notes[0].note}
        </p>
      )}

      {!settled && (
        <div className="row wrap" style={{ marginTop: 9 }}>
          <a className="btn sec sm toggle" href={`tel:${l.phone}`}
             style={{ textDecoration: "none" }}>{t("callCustomer")}</a>
          {l.whatsapp && (
            <a className="btn sec sm toggle" target="_blank" rel="noreferrer"
               href={`https://wa.me/${l.whatsapp.replace(/[^0-9]/g, "")}`}
               style={{ textDecoration: "none" }}>{t("sendWhatsapp")}</a>
          )}
          <button className="btn sec sm toggle"
                  onClick={() => setOpen(open === "note" ? "" : "note")}>{t("logCall")}</button>
          <button className="btn pri sm toggle"
                  onClick={() => setOpen(open === "quote" ? "" : "quote")}>{t("writeQuote")}</button>
          <button className="btn dang sm toggle"
                  onClick={() => setOpen(open === "lost" ? "" : "lost")}>{t("markLost")}</button>
        </div>
      )}

      {open === "note" && <NoteForm l={l} onClose={() => setOpen("")}
                                    onDone={() => { setOpen(""); onDone(); }} />}
      {open === "quote" && <QuoteForm lead={l} onClose={() => setOpen("")}
                                      onDone={() => { setOpen(""); onDone(); }} />}
      {open === "lost" && <LostForm l={l} onClose={() => setOpen("")}
                                    onDone={() => { setOpen(""); onDone(); }} />}
    </div>
  );
}

/** A conversation, and the next one. */
function NoteForm({ l, onClose, onDone }: { l: Lead; onClose: () => void; onDone: () => void }) {
  const { t, toast } = useApp();
  const [note, setNote] = useState("");
  const [next, setNext] = useState(l.nextFollowUp ? l.nextFollowUp.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <span className="k">{t("whatWasSaid")}</span>
      <input value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 6 }} />
      <span className="k" style={{ marginTop: 9, display: "block" }}>{t("ringAgainOn")}</span>
      <input type="date" value={next} onChange={(e) => setNext(e.target.value)}
             style={{ marginTop: 6 }} />
      {/* Ringing somebody almost always ends in agreeing to ring again, and a
          lead with no next date is one nobody rings. */}
      <p className="note">{t("nextCallHint")}</p>
      <div className="row wrap" style={{ marginTop: 9 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle" disabled={busy || !note.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addLeadNote(l.id, {
                      note: note.trim(),
                      nextFollowUp: next ? new Date(next).toISOString() : null,
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

function LostForm({ l, onClose, onDone }: { l: Lead; onClose: () => void; onDone: () => void }) {
  const { t, toast } = useApp();
  const [reason, setReason] = useState<string>("PRICE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div style={{ marginTop: 10 }}>
      <span className="k">{t("whyLost")}</span>
      {LOST.map((r) => (
        <button key={r} className={`btn sm ${reason === r ? "dang" : "sec"}`}
                style={{ marginTop: 7 }} onClick={() => setReason(r)}>
          {t(`lost_${r}` as any)}
        </button>
      ))}
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
      <p className="note">{t("lostHint")}</p>
      <div className="row wrap" style={{ marginTop: 9 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn dang sm toggle" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.lostLead(l.id, { reason, note: note.trim() || undefined });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("markLost")}</button>
      </div>
    </div>
  );
}

function NewLead({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState({ name: "", phone: "", whatsapp: "", source: "WALK_IN",
                               interest: "", estimateValue: "", note: "" });
  const [next, setNext] = useState(iso(new Date(Date.now() + 3 * 86_400_000)));
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("newLead")}</span>
      <input placeholder={t("customerName")} value={f.name}
             onChange={(e) => set("name", e.target.value)} style={{ marginTop: 8 }} />
      <input className="mono" placeholder="+2010…" value={f.phone}
             onChange={(e) => set("phone", e.target.value)} style={{ marginTop: 8 }} />
      <select value={f.source} onChange={(e) => set("source", e.target.value)}
              style={{ marginTop: 8 }}>
        {SOURCES.map((s) => <option key={s} value={s}>{t(`src_${s}` as any)}</option>)}
      </select>
      <p className="note">{t("sourceHint")}</p>
      <input placeholder={t("whatTheyWant")} value={f.interest}
             onChange={(e) => set("interest", e.target.value)} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("roughly")}
             value={f.estimateValue} onChange={(e) => set("estimateValue", e.target.value)}
             style={{ marginTop: 8 }} />
      <input placeholder={t("whatWasSaid")} value={f.note}
             onChange={(e) => set("note", e.target.value)} style={{ marginTop: 8 }} />
      <span className="k" style={{ marginTop: 9, display: "block" }}>{t("ringAgainOn")}</span>
      <input type="date" value={next} onChange={(e) => setNext(e.target.value)}
             style={{ marginTop: 6 }} />

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle"
                disabled={busy || !f.name.trim() || f.phone.trim().length < 6}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addLead({
                      name: f.name.trim(), phone: f.phone.trim(),
                      whatsapp: f.whatsapp.trim() || undefined,
                      source: f.source, interest: f.interest.trim() || undefined,
                      estimateValue: Number(f.estimateValue) || undefined,
                      nextFollowUp: next ? new Date(next).toISOString() : undefined,
                      note: f.note.trim() || undefined,
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── عرض السعر */

/**
 * Writing a price.
 *
 * The discount ceiling bites here rather than at the order: a quote is a price
 * promise on paper, and letting a rep write more off than the business will
 * honour hands the customer a document that gets torn up at the counter.
 */
function QuoteForm({ lead, onClose, onDone }: {
  lead: Lead; onClose: () => void; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [lines, setLines] = useState([{ productId: "", qty: "1", unitPrice: "", discount: "" }]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ allowed: number; asked: number; limitPct: number } | null>(null);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api.products().then((p) => setProducts(p.filter((x) => x.isActive))).catch(() => setProducts([]));
  }, []);

  const priceOf = (id: string) => products.find((p) => p.id === id)?.basePrice ?? 0;
  const gross = (l: typeof lines[number]) =>
    (l.unitPrice.trim() === "" ? priceOf(l.productId) : Number(l.unitPrice) || 0)
    * (Number(l.qty) || 0);
  const total = lines.reduce((s, l) => s + gross(l) - (Number(l.discount) || 0), 0);
  const ready = lines.every((l) => l.productId && Number(l.qty) > 0);

  return (
    <div style={{ marginTop: 10 }}>
      <span className="k">{t("writeQuote")} — {lead.name}</span>

      {lines.map((l, i) => (
        <div key={i} style={{ marginTop: 9 }}>
          <select value={l.productId}
                  onChange={(e) => setLines(lines.map((x, k) =>
                    k === i ? { ...x, productId: e.target.value } : x))}>
            <option value="">{t("pickProduct")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {ar ? p.nameAr : p.nameEn} — {p.basePrice.toLocaleString()}
              </option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="mono" inputMode="numeric" placeholder={t("qty")} value={l.qty}
                   onChange={(e) => setLines(lines.map((x, k) =>
                     k === i ? { ...x, qty: e.target.value } : x))} />
            <input className="mono" inputMode="decimal"
                   placeholder={l.productId ? String(priceOf(l.productId)) : t("price")}
                   value={l.unitPrice}
                   onChange={(e) => setLines(lines.map((x, k) =>
                     k === i ? { ...x, unitPrice: e.target.value } : x))} />
            <input className="mono" inputMode="decimal" placeholder={t("discount")}
                   value={l.discount}
                   onChange={(e) => setLines(lines.map((x, k) =>
                     k === i ? { ...x, discount: e.target.value } : x))} />
            {lines.length > 1 && (
              <button className="btn dang sm toggle"
                      onClick={() => setLines(lines.filter((_, k) => k !== i))}>×</button>
            )}
          </div>
        </div>
      ))}

      <button className="btn sec sm" style={{ marginTop: 9 }}
              onClick={() => setLines([...lines, { productId: "", qty: "1", unitPrice: "", discount: "" }])}>
        {t("addLine")}
      </button>
      <input placeholder={t("note")} value={note}
             onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />

      <div className="between" style={{ marginTop: 10 }}>
        <span className="k">{t("total")}</span>
        <b className="mono" style={{ color: "var(--p)" }}>{total.toLocaleString()}</b>
      </div>
      <p className="note">{t("quoteHint")}</p>

      {blocked && (
        <div className="card" style={{ marginTop: 10, borderColor: "var(--warn)" }}>
          <span className="k" style={{ color: "var(--warn)" }}>{t("needsApprovalTitle")}</span>
          <div className="between" style={{ marginTop: 8 }}>
            <span className="k">{t("youMayTake")}</span>
            <b className="mono">{blocked.allowed.toLocaleString()} ({blocked.limitPct}%)</b>
          </div>
          <div className="between" style={{ marginTop: 5 }}>
            <span className="k">{t("youAsked")}</span>
            <b className="mono" style={{ color: "var(--warn)" }}>
              {blocked.asked.toLocaleString()}
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
                            kind: "ORDER_DISCOUNT", amount: blocked.asked,
                            gross: lines.reduce((s, l) => s + gross(l), 0),
                            subject: `${lead.name} — ${t("writeQuote")}`,
                            reason: reason.trim() || undefined,
                          });
                          setSent(true); toast(t("askSent"));
                        } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("askForIt")}</button>
            </>
          )}
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm toggle" disabled={busy || !ready}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addQuote({
                      leadId: lead.id, note: note.trim() || undefined,
                      lines: lines.map((l) => ({
                        productId: l.productId, qty: Number(l.qty),
                        unitPrice: l.unitPrice.trim() === "" ? undefined : Number(l.unitPrice),
                        discount: Number(l.discount) || 0,
                      })),
                    });
                    toast(t("saved")); onDone();
                  } catch (e: any) {
                    if (e instanceof ApiError && e.code === "discount_needs_approval") {
                      setBlocked({
                        allowed: e.detail.allowed ?? 0, asked: e.detail.asked ?? 0,
                        limitPct: e.detail.limitPct ?? 0,
                      });
                      setSent(false);
                    }
                    toast(e?.code ? t(e.code) : t("signInFailed"));
                  }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────── عروض الأسعار */

function Quotes() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const nav = useNavigate();
  const [rows, setRows] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.quotes()); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");

  if (loading) return <div className="empty">{t("loading")}</div>;
  if (rows.length === 0) return <p className="empty">{t("noQuotes")}</p>;

  return (
    <>
      {rows.map((q) => (
        <div className="card" key={q.id}
             style={{ opacity: q.status === "REJECTED" || q.expired ? 0.7 : 1 }}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm mono">{q.number}</span>
              <span className="sub">{q.who} · {when(q.createdAt)}</span>
              <span className="sub">
                {q.expired ? t("expiredOn") : t("goodUntil")} {when(q.validUntil)}
              </span>
            </span>
            <span style={{ textAlign: "end" }}>
              <span className={`pill ${q.status === "ACCEPTED" ? "ok"
                                     : q.status === "REJECTED" || q.status === "EXPIRED" ? "bad"
                                     : "warn"}`}>
                {t(`qs_${q.status}` as any)}
              </span>
              <div className="big mono" style={{ marginTop: 5 }}>{num(q.total)}</div>
            </span>
          </div>

          {q.lines.map((l) => (
            <div className="evt" key={l.id}>
              <span style={{ flex: 1 }}>
                <b>{ar ? l.product.nameAr : l.product.nameEn}</b>
                <span className="sub mono">
                  {num(l.qty)} × {num(l.unitPrice)}{l.discount > 0 && ` − ${num(l.discount)}`}
                </span>
              </span>
              <b className="mono">{num(l.lineTotal)}</b>
            </div>
          ))}
          {q.note && <p className="note">{q.note}</p>}
          {q.order && <p className="note mono">{q.order.code}</p>}

          <div className="row wrap" style={{ marginTop: 9 }}>
            <button className="btn sec sm toggle"
                    onClick={() => nav(`/quote/${q.id}`)}>{t("printQuote")}</button>
            {q.status === "DRAFT" && (
              <button className="btn sec sm toggle" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try { await api.quoteSent(q.id); toast(t("saved")); await load(); }
                        catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("markGiven")}</button>
            )}
            {/* An expired price is not a price: re-quote rather than let a
                document from March become an order in September. */}
            {!q.order && !q.expired && q.status !== "REJECTED" && (
              <button className="btn pri sm toggle" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const pre = await api.convertQuote(q.id);
                          const made = await api.createOrder({
                            customerId: pre.customerId, quotationId: pre.quotationId,
                            lines: pre.lines,
                          });
                          toast(`${t("orderCreated")} ${made.code}`);
                          nav(`/orders/${made.id}`);
                        } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("turnIntoOrder")}</button>
            )}
            {!q.order && q.status !== "REJECTED" && (
              <button className="btn dang sm toggle" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try { await api.quoteRejected(q.id); toast(t("saved")); await load(); }
                        catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("quoteRefused")}</button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

/* ─────────────────────────────────── التقرير */

/**
 * How many of the people who walked in bought something.
 *
 * The figure the showroom has never had. A month of orders says what was sold;
 * it says nothing about the four people who came in for the same bedroom and
 * went somewhere else, or why.
 */
function Report() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [r, setR] = useState<LeadReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.leadReport().then(setR).catch(() => setR(null)).finally(() => setLoading(false));
  }, []);

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 1 });
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!r) return <p className="empty">{t("noRows")}</p>;

  return (
    <>
      <div className="card">
        <span className="k">{t("conversion")}</span>
        <div className="big mono" style={{
          fontSize: "2rem", marginTop: 4,
          color: r.totals.conversion == null ? undefined
               : r.totals.conversion >= 40 ? "var(--ok)"
               : r.totals.conversion >= 20 ? "var(--warn)" : "var(--bad)",
        }}>
          {r.totals.conversion == null ? "—" : `${num(r.totals.conversion)}%`}
        </div>
        <p className="note">{t("conversionHint")}</p>
      </div>

      <div className="tiles g3">
        <div className="tile">
          <span className="k">{t("leads")}</span>
          <div className="big mono">{num(r.totals.leads)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("wonLeads")}</span>
          <div className="big mono" style={{ color: "var(--ok)" }}>{num(r.totals.won)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("lostLeads")}</span>
          <div className="big mono" style={{ color: r.totals.lost ? "var(--bad)" : undefined }}>
            {num(r.totals.lost)}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("openLeads")}</span>
          <div className="big mono">{num(r.totals.open)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("wonValue")}</span>
          <div className="big mono">{num(Math.round(r.totals.wonValue))}</div>
        </div>
        <div className="tile">
          <span className="k">{t("daysToWin")}</span>
          <div className="big mono">
            {r.totals.avgDaysToWin == null ? "—" : num(r.totals.avgDaysToWin)}
          </div>
        </div>
      </div>

      <Split title={t("bySource")} rows={r.bySource} num={num} label={(n) => t(`src_${n}` as any)} />
      <Split title={t("byRep")} rows={r.byRep} num={num} label={(n) => n} />

      {r.lostReasons.length > 0 && (
        <div className="card" style={{ marginTop: 11 }}>
          <span className="k">{t("whyLost")}</span>
          {r.lostReasons.map((x) => (
            <div className="evt" key={x.name}>
              <span style={{ flex: 1 }}>{t(`lost_${x.name}` as any)}</span>
              <b className="mono">{num(x.count)}</b>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Where they came from, and how many of each turned into money. */
function Split({ title, rows, num, label }: {
  title: string;
  rows: { name: string; total: number; won: number; value: number; rate: number | null }[];
  num: (n: number) => string; label: (n: string) => string;
}) {
  const { t } = useApp();
  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{title}</span>
      {rows.length === 0 && <p className="note">{t("noRows")}</p>}
      {rows.map((x) => (
        <div key={x.name} style={{ marginTop: 9 }}>
          <div className="between">
            <span style={{ flex: 1 }}>{label(x.name)}</span>
            <b className="mono" style={{
              color: x.rate == null ? undefined
                   : x.rate >= 40 ? "var(--ok)" : x.rate >= 20 ? "var(--warn)" : "var(--bad)",
            }}>
              {x.rate == null ? "—" : `${num(x.rate)}%`}
            </b>
          </div>
          <div style={{ height: 4, background: "var(--g2)", borderRadius: 100, marginTop: 5 }}>
            <div style={{
              height: "100%", borderRadius: 100, background: "var(--ok)",
              width: `${x.total > 0 ? Math.round((x.won / x.total) * 100) : 0}%`,
            }} />
          </div>
          <p className="note">
            {num(x.won)} / {num(x.total)}
            {x.value > 0 && ` · ${num(Math.round(x.value))}`}
          </p>
        </div>
      ))}
    </div>
  );
}
