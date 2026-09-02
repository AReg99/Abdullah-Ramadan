import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api, ApiError, type Approval, type LocationRow, type MyLimits,
         type ProductRow, type PromiseDate, type SpecFieldRow } from "../api";

type Line = { productId: string; qty: string; unitPrice: string; discount: string;
              warehouseId: string; specNotes: string; lineKind: "STANDARD" | "CUSTOM";
              /** Answers keyed by the product's own field codes. */
              specs: Record<string, string> };

const BLANK: Line = { productId: "", qty: "1", unitPrice: "", discount: "",
                      warehouseId: "", specNotes: "", lineKind: "STANDARD", specs: {} };

/**
 * Order entry. Confirming an order is the moment the factory gets work: it
 * creates the work order, every stage from the routing, and a scannable label
 * per unit, so the piece exists in the system before anyone touches it.
 */
export default function NewOrder() {
  const { t, lang, toast } = useApp();
  const nav = useNavigate();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [promisedDate, setPromisedDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...BLANK }]);
  const [files, setFiles] = useState<File[]>([]);
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<MyLimits | null>(null);
  /**
   * What each product on this order needs decided. Fetched per product as it is
   * picked, and cached, because a rep changing the quantity should not cost a
   * round trip.
   */
  const [specs, setSpecs] = useState<Record<string, SpecFieldRow[]>>({});
  const [slips, setSlips] = useState<Approval[]>([]);
  const [using, setUsing] = useState<Approval | null>(null);
  const [blocked, setBlocked] = useState<
    { allowed: number; asked: number; limitPct: number } | null>(null);
  const [soonest, setSoonest] = useState<PromiseDate | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => { api.products().then(setProducts).catch(() => toast("error")); }, []);
  // What this person may take off on their own, and any permission already
  // granted to them and not yet spent. Both are read up front so the rep is
  // told where the line is rather than finding out at the counter.
  const loadSlips = () => api.approvals({ mine: true, status: "APPROVED" })
    .then((a) => setSlips(a.filter((x) => x.kind === "ORDER_DISCOUNT")))
    .catch(() => setSlips([]));
  useEffect(() => {
    api.myLimits().then(setMine).catch(() => setMine(null));
    void loadSlips();
  }, []);
  // The invoice has to say which store the piece left, and a stock count later
  // cannot be reconstructed without it.
  useEffect(() => {
    api.locations()
      .then((ls) => setStores(ls.filter((l) => l.type !== "FACTORY")))
      .catch(() => setStores([]));
  }, []);

  /**
   * The soonest the factory could actually finish this basket.
   *
   * A promise date used to be a guess, or a fixed fourteen days that knew
   * nothing about the eleven days of work standing in front of cutting. This
   * is asked while the customer is at the counter, before anything is written.
   */
  const basket = lines.filter((l) => l.productId && Number(l.qty) > 0)
    .map((l) => `${l.productId}:${l.qty}`).join(",");
  useEffect(() => {
    if (!basket) { setSoonest(null); return; }
    let live = true;
    api.promiseFor(basket.split(",").map((x) => {
      const [productId, qty] = x.split(":");
      return { productId, qty: Number(qty) };
    })).then((d) => { if (live) setSoonest(d); }).catch(() => { if (live) setSoonest(null); });
    return () => { live = false; };
  }, [basket]);

  const priceOf = (id: string) => products.find((p) => p.id === id)?.basePrice ?? 0;
  const photosOf = (id: string) => products.find((p) => p.id === id)?.photos ?? [];
  // The catalogue price is a starting point, not the deal. What was actually
  // agreed goes in the box; leaving it blank keeps the list price.
  const lineGross = (l: Line) =>
    (l.unitPrice.trim() === "" ? priceOf(l.productId) : Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
  const lineTotal = (l: Line) => lineGross(l) - (Number(l.discount) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const grossTotal = lines.reduce((s, l) => s + lineGross(l), 0);
  const discountTotal = lines.reduce((s, l) => s + (Number(l.discount) || 0), 0);
  const ceiling = mine?.discountPct == null
    ? Infinity : Math.round(grossTotal * (mine.discountPct / 100) * 100) / 100;
  const overCeiling = discountTotal > ceiling + 0.005;
  const overdone = lines.some((l) => l.productId && (Number(l.discount) || 0) > lineGross(l));
  /**
   * Which required answers are still blank, per line.
   *
   * The server refuses the order over these too — this is the same rule said
   * early, at the counter, while the customer is still standing there and can
   * answer. A refusal at submit is correct but useless: by then the rep has
   * typed everything and the customer has gone.
   */
  const blanksOf = (l: Line) =>
    (specs[l.productId] ?? []).filter((f) => f.required && !(l.specs[f.code] ?? "").trim());
  const anyBlank = lines.some((l) => l.productId && blanksOf(l).length > 0);
  const valid = customerName.trim()
    && lines.some((l) => l.productId && Number(l.qty) > 0) && !overdone && !anyBlank;

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  useEffect(() => {
    for (const id of new Set(lines.map((l) => l.productId).filter(Boolean))) {
      if (specs[id]) continue;
      api.specFields(id)
        .then((f) => setSpecs((cur) => ({ ...cur, [id]: f })))
        // A product whose fields cannot be read is not a product that can be
        // sold blind: the server refuses it, and the rep sees that refusal.
        .catch(() => setSpecs((cur) => ({ ...cur, [id]: [] })));
    }
  }, [lines.map((l) => l.productId).join(",")]);

  const addFiles = (picked: FileList | null) => {
    if (!picked) return;
    const tooBig = [...picked].filter((f) => f.size > 8 * 1024 * 1024);
    if (tooBig.length) toast(t("fileTooBig"));
    setFiles((cur) => [...cur, ...[...picked].filter((f) => f.size <= 8 * 1024 * 1024)]);
  };

  return (
    <>
      <div className="card">
        <span className="k">{t("customer")}</span>
        <input placeholder={t("customerName")} value={customerName}
          onChange={(e) => setCustomerName(e.target.value)} style={{ marginTop: 8 }} />
        <input className="mono" placeholder="+2010…" value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)} style={{ marginTop: 8 }} />
        <div style={{ height: 11 }} />
        <span className="k">{t("promisedDate")}</span>
        <input type="date" value={promisedDate} onChange={(e) => setPromisedDate(e.target.value)} style={{ marginTop: 8 }} />

        {soonest?.date && (
          <>
            <p className="note" style={{ marginTop: 8 }}>
              {t("soonestIs")}{" "}
              <b>{new Date(soonest.date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB",
                    { day: "2-digit", month: "long", year: "numeric" })}</b>
              {" — "}{soonest.totalWorkingDays} {t("workingDaysShort")}
              {soonest.bottleneck && <> · {t("waitingOn")} {soonest.bottleneck}</>}
            </p>
            <div className="row wrap" style={{ marginTop: 7 }}>
              <button className="btn sec sm toggle"
                      onClick={() => setPromisedDate(soonest.date!.slice(0, 10))}>
                {t("useThisDate")}
              </button>
              <button className="btn sec sm toggle"
                      onClick={() => setShowSteps(!showSteps)}>
                {showSteps ? t("hideWorkings") : t("howItAdds")}
              </button>
            </div>
            {/* The rep is about to argue about a week either way; showing the
                arithmetic is what makes the date defensible at the counter. */}
            {showSteps && soonest.lines[0] && (
              <>
                {soonest.lines[0].steps.map((st, i) => (
                  <div className="evt" key={i}>
                    <span style={{ flex: 1 }}>
                      <b>{st.station ?? st.stage}</b>
                      <span className="sub">
                        {t("waits")} {st.waitDays} · {t("takes")} {st.ownDays}
                      </span>
                    </span>
                    <b className="mono">{st.readyDay}</b>
                  </div>
                ))}
                <p className="note">
                  {t("plusBuffer")} {soonest.bufferDays} {t("daysShort")}
                </p>
              </>
            )}
            {/* A rep can still promise sooner. They are told, not stopped —
                sometimes the owner has already decided to move something. */}
            {promisedDate && new Date(promisedDate) < new Date(soonest.date) && (
              <p className="note" style={{ color: "var(--warn)" }}>{t("earlierThanPossible")}</p>
            )}
          </>
        )}
      </div>

      {lines.map((l, i) => (
        <div className="card" key={i}>
          <div className="between">
            <span className="k">{t("item")} {i + 1}</span>
            {lines.length > 1 && (
              <button className="chip" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>{t("remove")}</button>
            )}
          </div>
          <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} style={{ marginTop: 8 }}>
            <option value="">{t("pickProduct")}</option>
            {/* Only what is switched on: a model still being set up has no
                price, and the server refuses it anyway. */}
            {products.filter((p) => p.isActive).map((p) => (
              <option key={p.id} value={p.id}>
                {lang === "ar" ? p.nameAr : p.nameEn} — {p.basePrice.toLocaleString()} EGP
              </option>
            ))}
          </select>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="mono" inputMode="numeric" placeholder={t("qty")} value={l.qty}
              onChange={(e) => setLine(i, { qty: e.target.value })} style={{ flex: 1 }} />
            <input className="mono" inputMode="decimal"
              placeholder={l.productId ? String(priceOf(l.productId)) : t("price")}
              value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              style={{ flex: 1.2 }} />
            <select value={l.lineKind} onChange={(e) => setLine(i, { lineKind: e.target.value as Line["lineKind"] })} style={{ flex: 1.4 }}>
              <option value="STANDARD">{t("kindStandard")}</option>
              <option value="CUSTOM">{t("kindCustom")}</option>
            </select>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {/* In pounds, not percent — that is how it is argued at a counter. */}
            <input className="mono" inputMode="decimal" placeholder={t("discount")}
              value={l.discount} onChange={(e) => setLine(i, { discount: e.target.value })}
              style={{ flex: 1 }} />
            <select value={l.warehouseId} onChange={(e) => setLine(i, { warehouseId: e.target.value })}
                    style={{ flex: 1.6 }}>
              <option value="">{t("pickWarehouse")}</option>
              {stores.map((w) => (
                <option key={w.id} value={w.id}>{lang === "ar" ? w.nameAr : w.nameEn}</option>
              ))}
            </select>
          </div>
          {Number(l.discount) > lineGross(l) && Number(l.discount) > 0 && (
            <p className="note" style={{ color: "var(--bad)" }}>{t("discount_exceeds_line")}</p>
          )}
          {/* What the piece is meant to be. Above the free-text note, because
              this is the part that has to be right and the note is the part
              that is only ever read if somebody remembers to. */}
          {(specs[l.productId] ?? []).length > 0 && (
            <div style={{ marginTop: 11 }}>
              <span className="k">{t("specOf")}</span>
              {(specs[l.productId] ?? []).map((f) => {
                const v = l.specs[f.code] ?? "";
                const blank = f.required && !v.trim();
                const label = lang === "ar" ? f.nameAr : f.nameEn;
                const put = (val: string) =>
                  setLine(i, { specs: { ...l.specs, [f.code]: val } });
                return (
                  <div key={f.code} style={{ marginTop: 8 }}>
                    <span className="sub">
                      {label}{f.unit ? ` (${f.unit})` : ""}
                      {!f.required && <span className="muted"> · {t("specOptional")}</span>}
                    </span>
                    {f.kind === "CHOICE" ? (
                      <select value={v} onChange={(e) => put(e.target.value)}
                              style={{ marginTop: 5,
                                       borderColor: blank ? "var(--bad)" : undefined }}>
                        <option value="">{`— ${label} —`}</option>
                        {f.options.map((o) => (
                          <option key={o.nameAr} value={lang === "ar" ? o.nameAr : o.nameEn}>
                            {lang === "ar" ? o.nameAr : o.nameEn}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value={v} onChange={(e) => put(e.target.value)}
                             inputMode={f.kind === "NUMBER" ? "numeric" : undefined}
                             placeholder={label}
                             style={{ marginTop: 5,
                                      borderColor: blank ? "var(--bad)" : undefined }} />
                    )}
                  </div>
                );
              })}
              {blanksOf(l).length > 0 && (
                <p className="note" style={{ color: "var(--bad)" }}>
                  {t("specMissing")}{" "}
                  {blanksOf(l).map((f) => (lang === "ar" ? f.nameAr : f.nameEn)).join(" · ")}
                </p>
              )}
            </div>
          )}
          <input placeholder={t("specNotes")} value={l.specNotes}
            onChange={(e) => setLine(i, { specNotes: e.target.value })} style={{ marginTop: 8 }} />
          {/* Show the customer what they are buying, from the seller's own screen. */}
          {photosOf(l.productId).length > 0 && (
            <div className="crew" style={{ marginTop: 9, gap: 8 }}>
              {photosOf(l.productId).map((ph) => (
                <a key={ph.id} href={`/uploads/${ph.path}`} target="_blank" rel="noreferrer">
                  <img src={`/uploads/${ph.path}`} alt=""
                       style={{ width: 74, height: 74, objectFit: "cover",
                                borderRadius: "var(--rs)", border: "1px solid var(--g3)" }} />
                </a>
              ))}
            </div>
          )}
        </div>
      ))}

      <button className="btn sec sm" style={{ marginTop: 4 }}
        onClick={() => setLines((ls) => [...ls, { ...BLANK }])}>
        {t("addItem")}
      </button>

      <div className="card" style={{ marginTop: 12 }}>
        <span className="k">{t("attachments")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("attachHint")}</p>
        <input type="file" multiple accept="image/*,application/pdf"
               onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
               style={{ marginTop: 8 }} />
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="evt">
            <span style={{ flex: 1 }}>{f.name}
              <span className="muted mono"> · {Math.round(f.size / 1024)} KB</span>
            </span>
            <button className="chip" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
              {t("remove")}
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12, background: "var(--muted)", borderColor: "var(--p)" }}>
        <div className="between">
          <span className="k">{t("total")}</span>
          <span className="big mono" style={{ color: "var(--p)" }}>{total.toLocaleString()}</span>
        </div>
        {/* Where the line is, before it is crossed. */}
        {mine?.discountPct != null && discountTotal > 0 && (
          <p className="note" style={{ color: overCeiling ? "var(--warn)" : undefined }}>
            {t("youMayTake")} {ceiling.toLocaleString()} ({mine.discountPct}%)
            {" · "}{t("youAsked")} {discountTotal.toLocaleString()}
          </p>
        )}
      </div>

      {/* A permission already granted and not yet spent. */}
      {slips.length > 0 && !using && overCeiling && (
        <div className="card">
          <span className="k">{t("usableApprovals")}</span>
          {slips.map((a) => (
            <div className="evt" key={a.id}>
              <span style={{ flex: 1 }}>
                <b className="mono">{a.amount.toLocaleString()}</b>
                <span className="sub">{a.subject}</span>
              </span>
              <button className="btn sec sm toggle"
                      onClick={() => { setUsing(a); setBlocked(null); }}>{t("useApproval")}</button>
            </div>
          ))}
        </div>
      )}
      {using && (
        <div className="card">
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="k">{t("usingApproval")}</span>
              <span className="sub mono">{using.number} · {using.amount.toLocaleString()}</span>
            </span>
            <button className="chip" onClick={() => setUsing(null)}>{t("clearApproval")}</button>
          </div>
        </div>
      )}

      {blocked && (
        <AskPanel blocked={blocked} gross={grossTotal}
                  subject={`${customerName.trim() || t("customer")} — ${
                    products.find((p) => p.id === lines[0]?.productId)?.nameAr ?? ""}`}
                  onClose={() => setBlocked(null)}
                  /* The panel stays up to say the question went — closing it on
                     send leaves the rep looking at the same refused sale with
                     no sign anything happened but a toast they may have missed. */
                  onSent={loadSlips} />
      )}

      <div style={{ height: 12 }} />
      <button className="btn pri" disabled={busy || !valid} onClick={async () => {
        setBusy(true);
        try {
          const r = await api.createOrder({
            customerName: customerName.trim(),
            customerPhone: customerPhone.trim() || undefined,
            promisedDate: promisedDate ? new Date(promisedDate).toISOString() : undefined,
            lines: lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({
              productId: l.productId, qty: Number(l.qty),
              unitPrice: l.unitPrice.trim() === "" ? undefined : Number(l.unitPrice),
              discount: Number(l.discount) || 0,
              warehouseId: l.warehouseId || undefined,
              specNotes: l.specNotes.trim() || undefined, lineKind: l.lineKind,
              specs: Object.keys(l.specs).length ? l.specs : undefined,
            })),
            approvalId: using?.id,
          });

          // The files can only be attached once the order exists. A failure
          // here must not read as a failure to take the order — the order is
          // already real, and telling the seller otherwise would have them
          // enter it twice.
          const failed: string[] = [];
          for (const f of files) {
            try { await api.addAttachment(r.id, f); } catch { failed.push(f.name); }
          }
          toast(failed.length
            ? `${t("orderCreated")} ${r.code} — ${t("attachFailed")}: ${failed.join(", ")}`
            : `${t("orderCreated")} ${r.code}`);
          nav(`/orders/${r.id}`);
        } catch (e: any) {
          // Not a failure to take the order — a limit, with the figures that
          // make it actionable. The rep asks from right here.
          if (e instanceof ApiError && e.code === "discount_needs_approval") {
            setBlocked({
              allowed: e.detail.allowed ?? 0,
              asked: e.detail.asked ?? discountTotal,
              limitPct: e.detail.limitPct ?? 0,
            });
            setUsing(null);
          }
          toast(e?.code ? t(e.code) : "error");
        } finally { setBusy(false); }
      }}>
        {t("createOrder")}
      </button>
      <p className="note">{t("createOrderHint")}</p>
    </>
  );
}

/**
 * Asking the owner, without leaving the sale.
 *
 * The showroom rings the owner for this already. What was missing was anywhere
 * for the answer to land — so a concession agreed on the phone had no name
 * against it, no amount, and nothing stopping the same yes being used again on
 * the next customer.
 */
function AskPanel({ blocked, gross, subject, onClose, onSent }: {
  blocked: { allowed: number; asked: number; limitPct: number };
  gross: number; subject: string; onClose: () => void; onSent: () => void;
}) {
  const { t, toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  return (
    <div className="card" style={{ borderColor: "var(--warn)" }}>
      <span className="k" style={{ color: "var(--warn)" }}>{t("needsApprovalTitle")}</span>
      <div className="between" style={{ marginTop: 8 }}>
        <span className="k">{t("youMayTake")}</span>
        <b className="mono">{blocked.allowed.toLocaleString()} ({blocked.limitPct}%)</b>
      </div>
      <div className="between" style={{ marginTop: 5 }}>
        <span className="k">{t("youAsked")}</span>
        <b className="mono" style={{ color: "var(--warn)" }}>{blocked.asked.toLocaleString()}</b>
      </div>

      {sent ? (
        <>
          <p className="note" style={{ color: "var(--ok)" }}>{t("askSent")}</p>
          <button className="btn sec sm" style={{ marginTop: 8 }} onClick={onClose}>
            {t("back")}
          </button>
        </>
      ) : (
        <>
          <input placeholder={t("approvalReason")} value={reason}
                 onChange={(e) => setReason(e.target.value)} style={{ marginTop: 10 }} />
          <div className="row wrap" style={{ marginTop: 9 }}>
            <button className="btn sec sm toggle" onClick={onClose}>{t("cancel")}</button>
            <button className="btn pri sm toggle" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.askApproval({
                          kind: "ORDER_DISCOUNT", amount: blocked.asked, gross,
                          subject: subject.trim() || "—",
                          reason: reason.trim() || undefined,
                        });
                        setSent(true); toast(t("askSent")); onSent();
                      } catch (e: any) { toast(e?.code ? t(e.code) : "error"); }
                      finally { setBusy(false); }
                    }}>{t("askForIt")}</button>
          </div>
        </>
      )}
    </div>
  );
}
