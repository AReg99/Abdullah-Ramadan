import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type MarginReport, type PriceChange, type PriceList,
         type PriceRow, type ProductCosting } from "../api";

type Tab = "prices" | "margin" | "changes" | "rates";
const TABS: Tab[] = ["prices", "margin", "changes", "rates"];

/**
 * محاسبة التكاليف.
 *
 * `Product.cost` was a number somebody typed once. Nothing worked it out from
 * what the piece is actually made of, so when timber went up twenty per cent
 * nothing said the margin on a wardrobe had collapsed — it surfaced months
 * later in a profit report as a figure nobody could explain.
 *
 * Everything needed was already here and never multiplied together: the bill
 * of materials, each material's cost today, and the routing's standard minutes.
 */
export default function Costing() {
  const { t, me } = useApp();
  // The counter is told what a price did; it is not shown what anything costs.
  // Offering them the price list would hand them a tab that refuses them.
  const owns = ["OWNER", "COST_ACCOUNTANT", "ACCOUNTANT",
                "FACTORY_MANAGER", "PRODUCTION_MANAGER"].includes(me?.role ?? "");
  const canSetRates = ["OWNER", "COST_ACCOUNTANT"].includes(me?.role ?? "");
  const tabs = owns
    ? TABS.filter((x) => x !== "rates" || canSetRates)
    : (["changes"] as Tab[]);
  const [tab, setTab] = useState<Tab>(tabs[0]);

  return (
    <>
      {tabs.length > 1 && (
      <div className="tabs">
        {tabs.map((x) => (
          <button key={x} className={`btn sm ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`cost_${x}` as any)}
          </button>
        ))}
      </div>
      )}
      {tab === "prices" ? <Prices />
        : tab === "margin" ? <Margin />
        : tab === "changes" ? <Changes />
        : <Rates />}
    </>
  );
}

/* ─────────────────────────────────── قائمة الأسعار */

function Prices() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [l, setL] = useState<PriceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState("");
  const [only, setOnly] = useState<"" | "floor" | "drift" | "nobom">("");

  const load = async () => {
    setLoading(true);
    try { setL(await api.priceList()); }
    catch { setL(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 0 });
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!l) return <p className="empty">{t("noRows")}</p>;

  const rows = l.rows.filter((x) =>
    only === "floor" ? x.belowFloor
    : only === "drift" ? x.hasBom && x.drift > 1
    : only === "nobom" ? !x.hasBom
    : true);

  return (
    <>
      <div className="tiles g3">
        <Tile k={t("models")} v={num(l.totals.products)}
              on={() => setOnly("")} lit={only === ""} />
        <Tile k={t("belowFloor")} v={num(l.totals.belowFloor)}
              tone={l.totals.belowFloor ? "bad" : "ok"}
              on={() => setOnly(only === "floor" ? "" : "floor")} lit={only === "floor"} />
        <Tile k={t("costDrifted")} v={num(l.totals.driftedUp)}
              tone={l.totals.driftedUp ? "warn" : "ok"}
              on={() => setOnly(only === "drift" ? "" : "drift")} lit={only === "drift"} />
        <Tile k={t("noRecipe")} v={num(l.totals.noBom)}
              tone={l.totals.noBom ? "warn" : undefined}
              on={() => setOnly(only === "nobom" ? "" : "nobom")} lit={only === "nobom"} />
        <Tile k={t("soldBelowCost")} v={num(l.totals.belowCost)}
              tone={l.totals.belowCost ? "bad" : "ok"} />
        <Tile k={t("avgMargin")}
              v={l.totals.avgMargin == null ? "—" : `${num(l.totals.avgMargin)}%`} />
      </div>

      <p className="note" style={{ marginTop: 12 }}>{t("priceListHint")}</p>
      {rows.length === 0 && <p className="note">{t("nothingHere")}</p>}
      {rows.map((p) => (
        <Row key={p.id} p={p} ar={ar} open={open === p.id}
             onOpen={() => setOpen(open === p.id ? "" : p.id)} onDone={load} />
      ))}
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

/** One model. The breakdown opens underneath rather than on another screen. */
function Row({ p, ar, open, onOpen, onDone }: {
  p: PriceRow; ar: boolean; open: boolean; onOpen: () => void; onDone: () => void;
}) {
  const { t } = useApp();
  const [d, setD] = useState<ProductCosting | null>(null);

  useEffect(() => {
    if (!open) return;
    api.costOf(p.id).then(setD).catch(() => setD(null));
  }, [open, p.id]);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 0 });
  const tone = p.belowCost ? "var(--bad)"
             : p.belowFloor ? "var(--warn)"
             : p.margin != null ? "var(--ok)" : undefined;

  return (
    <div className="card" style={{
      borderInlineStartWidth: p.belowCost || p.belowFloor ? 3 : undefined,
      borderInlineStartColor: tone,
    }}>
      <div className="between" onClick={onOpen} style={{ cursor: "pointer" }}>
        <span style={{ flex: 1 }}>
          <span className="nm">{ar ? p.nameAr : p.nameEn}</span>
          <span className="sub mono">{p.sku} · {p.category}</span>
          <span className="sub">
            {t("price")} {num(p.price)}
            {p.hasBom && <> · {t("costs")} {num(p.computed.total)}</>}
          </span>
        </span>
        <span style={{ textAlign: "end" }}>
          {p.hasBom ? (
            <b className="mono" style={{ color: tone, fontSize: "1.1rem" }}>
              {p.margin == null ? "—" : `${num(p.margin)}%`}
            </b>
          ) : (
            <span className="pill warn">{t("noRecipe")}</span>
          )}
          {p.hasBom && Math.abs(p.drift) > 1 && (
            <span className="sub mono" style={{ color: "var(--warn)" }}>
              {p.drift > 0 ? "+" : ""}{num(p.drift)}
            </span>
          )}
        </span>
      </div>

      {/* The gap between what it is stored at and what it actually costs. The
          whole point of the screen. */}
      {p.hasBom && Math.abs(p.drift) > 1 && (
        <p className="note" style={{ color: "var(--warn)" }}>
          {t("storedAt")} {num(p.storedCost)} · {t("actuallyCosts")} {num(p.computed.total)}
        </p>
      )}
      {p.belowCost && <p className="note" style={{ color: "var(--bad)" }}>{t("belowCostWarn")}</p>}

      {open && (d ? <Detail d={d} ar={ar} onDone={onDone} /> : <p className="note">{t("loading")}</p>)}
    </div>
  );
}

function Detail({ d, ar, onDone }: { d: ProductCosting; ar: boolean; onDone: () => void }) {
  const { t, toast } = useApp();
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState(String(d.product.price));
  const [busy, setBusy] = useState(false);
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 2 });
  const when = (s: string) =>
    new Date(s).toLocaleDateString(ar ? "ar-EG" : "en-GB",
                                   { day: "2-digit", month: "short", year: "2-digit" });

  return (
    <div style={{ marginTop: 11 }}>
      {/* Dearest material first — "it costs 4,300 and 2,900 of that is timber"
          is a conversation with a supplier; the total on its own is not. */}
      <span className="k">{t("materials")}</span>
      {d.materials.length === 0 && <p className="note">{t("noRecipeHint")}</p>}
      {d.materials.map((m) => (
        <div className="evt" key={m.stockItemId}>
          <span style={{ flex: 1 }}>
            <b>{m.name}</b>
            <span className="sub mono">{num(m.qty)} {m.unit} × {num(m.unitCost)}</span>
          </span>
          <b className="mono">{num(m.total)}</b>
        </div>
      ))}

      <div className="between" style={{ marginTop: 10 }}>
        <span className="k">{t("materialsTotal")}</span>
        <b className="mono">{num(d.computed.materials)}</b>
      </div>
      <div className="between" style={{ marginTop: 5 }}>
        <span className="k">{t("labourCost")} · {num(d.computed.minutes)} {t("minutesShort")}</span>
        <b className="mono">{num(d.computed.labour)}</b>
      </div>
      <div className="between" style={{ marginTop: 5 }}>
        <span className="k">{t("overhead")} · {num(d.rates.overheadPct)}%</span>
        <b className="mono">{num(d.computed.overhead)}</b>
      </div>
      <div className="between" style={{ marginTop: 7, paddingTop: 7,
                                        borderTop: "1px solid var(--g3)" }}>
        <span className="k">{t("actuallyCosts")}</span>
        <b className="mono" style={{ fontSize: "1.05rem" }}>{num(d.computed.total)}</b>
      </div>
      {d.suggestedPrice != null && (
        <p className="note">
          {t("priceForFloor")} {num(d.rates.minMarginPct)}% — {num(d.suggestedPrice)}
        </p>
      )}

      <span className="k" style={{ marginTop: 11, display: "block" }}>{t("newPrice")}</span>
      <input className="mono" inputMode="decimal" value={price}
             onChange={(e) => setPrice(e.target.value)} style={{ marginTop: 6 }} />
      <input placeholder={t("whyPriceMoved")} value={reason}
             onChange={(e) => setReason(e.target.value)} style={{ marginTop: 8 }} />
      <p className="note">{t("priceMoveHint")}</p>

      <div className="row wrap" style={{ marginTop: 9 }}>
        {Number(price) !== d.product.price && (
          <button className="btn pri sm toggle" disabled={busy || !(Number(price) > 0)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.updateProduct(d.product.id, {
                        basePrice: Number(price), reason: reason.trim() || undefined,
                      });
                      toast(t("saved")); onDone();
                    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>{t("savePrice")}</button>
        )}
        {d.materials.length > 0 && Math.abs(d.drift) > 1 && (
          <>
            <button className="btn sec sm toggle" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.adoptCost(d.product.id, { reason: reason.trim() || undefined });
                        toast(t("saved")); onDone();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                      finally { setBusy(false); }
                    }}>{t("adoptCost")}</button>
            <button className="btn sec sm toggle" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.adoptCost(d.product.id, {
                          holdMargin: true, reason: reason.trim() || undefined });
                        toast(t("saved")); onDone();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                      finally { setBusy(false); }
                    }}>{t("passItOn")}</button>
          </>
        )}
      </div>

      {d.history.length > 0 && (
        <div style={{ marginTop: 11 }}>
          <span className="k">{t("priceHistory")}</span>
          {d.history.map((h) => (
            <div className="evt" key={h.id}>
              <span style={{ flex: 1 }}>
                <b className="mono">{num(h.oldPrice)} → {num(h.newPrice)}</b>
                <span className="sub">
                  {when(h.at)}{h.by && ` · ${h.by}`}
                </span>
                {h.reason && <span className="sub">{h.reason}</span>}
              </span>
              {h.newCost !== h.oldCost && (
                <span className="sub mono">{t("costs")} {num(h.newCost)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────── الربح الفعلي */

/**
 * What was actually made on what was actually sold.
 *
 * The price list says what a model should make. This says what it did: every
 * order line carries the price it went out at and the cost it was made at on
 * the day, so a discount given at the counter shows up here and nowhere else.
 */
function Margin() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [r, setR] = useState<MarginReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.realisedMargin().then(setR).catch(() => setR(null)).finally(() => setLoading(false));
  }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 0 });
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!r) return <p className="empty">{t("noRows")}</p>;

  return (
    <>
      <div className="card">
        <span className="k">{t("realisedMargin")}</span>
        <div className="big mono" style={{
          fontSize: "2rem", marginTop: 4,
          color: r.totals.margin == null ? undefined
               : r.totals.margin >= 30 ? "var(--ok)"
               : r.totals.margin >= 15 ? "var(--warn)" : "var(--bad)",
        }}>
          {r.totals.margin == null ? "—" : `${num(r.totals.margin)}%`}
        </div>
        <p className="note">{t("realisedHint")}</p>
      </div>

      <div className="tiles g3">
        <div className="tile">
          <span className="k">{t("revenue")}</span>
          <div className="big mono">{num(r.totals.revenue)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("costOfSales")}</span>
          <div className="big mono">{num(r.totals.cost)}</div>
        </div>
        <div className="tile">
          <span className="k">{t("profit")}</span>
          <div className="big mono" style={{
            color: r.totals.profit >= 0 ? "var(--ok)" : "var(--bad)" }}>
            {num(r.totals.profit)}
          </div>
        </div>
      </div>

      {r.totals.losingModels > 0 && (
        <p className="note" style={{ color: "var(--bad)", marginTop: 11 }}>
          {r.totals.losingModels} {t("losingModels")}
        </p>
      )}

      {r.rows.length === 0 && <p className="note">{t("noRows")}</p>}
      {r.rows.map((x) => (
        <div className="card" key={x.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm">{x.name}</span>
              <span className="sub mono">{x.sku} · {num(x.qty)} {t("piecesShort")}</span>
            </span>
            <b className="mono" style={{
              color: x.profit >= 0 ? "var(--ok)" : "var(--bad)", fontSize: "1.05rem" }}>
              {x.margin == null ? "—" : `${num(x.margin)}%`}
            </b>
          </div>
          <p className="note">
            {t("revenue")} {num(x.revenue)} · {t("costOfSales")} {num(x.cost)} · {" "}
            <b style={{ color: x.profit >= 0 ? "var(--ok)" : "var(--bad)" }}>
              {num(x.profit)}
            </b>
          </p>
        </div>
      ))}
    </>
  );
}

/* ─────────────────────────────────── التغييرات */

/**
 * What moved, and whether the counter has read it.
 *
 * The showroom used to find out a price had changed when a customer argued
 * about it. Every change is written by the product route itself, so this list
 * cannot be incomplete.
 */
function Changes() {
  const { t, lang, toast, me } = useApp();
  const ar = lang === "ar";
  const [rows, setRows] = useState<PriceChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const counter = ["SHOWROOM_MANAGER", "SALES_REP", "OWNER"].includes(me?.role ?? "");

  const load = async () => {
    setLoading(true);
    try { setRows(await api.priceChanges()); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 0 });
  const when = (s: string) =>
    new Date(s).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  if (loading) return <div className="empty">{t("loading")}</div>;
  if (rows.length === 0) return <p className="empty">{t("noPriceChanges")}</p>;
  const unseen = rows.filter((x) => !x.seenAt);

  return (
    <>
      <p className="note">{t("changesHint")}</p>
      {/* Marked in a batch: a rep who opened the list has read the list, and
          making them tap each row is how a badge stays lit for ever. */}
      {counter && unseen.length > 0 && (
        <button className="btn pri sm" style={{ marginBottom: 11 }} disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await api.markPricesSeen(); toast(t("saved")); await load(); }
                  catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("markAllRead")} · {unseen.length}</button>
      )}

      {rows.map((c) => (
        <div className="card" key={c.id} style={{
          opacity: c.seenAt ? 0.72 : 1,
          borderInlineStartWidth: c.seenAt ? undefined : 3,
          borderInlineStartColor: c.seenAt ? undefined : "var(--p)",
        }}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm">{ar ? c.product.nameAr : c.product.nameEn}</span>
              <span className="sub mono">{c.product.sku}</span>
              <span className="sub">{when(c.at)}{c.by && ` · ${c.by}`}</span>
            </span>
            <span style={{ textAlign: "end" }}>
              <b className="mono" style={{
                color: c.priceMoved > 0 ? "var(--warn)"
                     : c.priceMoved < 0 ? "var(--ok)" : undefined }}>
                {num(c.oldPrice)} → {num(c.newPrice)}
              </b>
              {c.newCost !== c.oldCost && (
                <span className="sub mono">
                  {t("costs")} {num(c.oldCost)} → {num(c.newCost)}
                </span>
              )}
            </span>
          </div>
          {c.reason && <p className="note">{c.reason}</p>}
          {c.seenAt && <p className="note">{t("readBy")} {c.seenBy ?? "—"}</p>}
        </div>
      ))}
    </>
  );
}

/* ─────────────────────────────────── المعدلات */

/** The three figures the whole calculation rests on. */
function Rates() {
  const { t, toast } = useApp();
  const [f, setF] = useState({ labourRate: "", overheadPct: "", minMarginPct: "" });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.priceList().then((l) => {
      setF({ labourRate: String(l.rates.labourRate),
             overheadPct: String(l.rates.overheadPct),
             minMarginPct: String(l.rates.minMarginPct) });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="empty">{t("loading")}</div>;

  return (
    <div className="card">
      <span className="k">{t("labourRate")}</span>
      <input className="mono" inputMode="decimal" value={f.labourRate}
             onChange={(e) => setF({ ...f, labourRate: e.target.value })}
             style={{ marginTop: 6 }} />
      <p className="note">{t("labourRateHint")}</p>

      <span className="k" style={{ marginTop: 11, display: "block" }}>{t("overhead")}</span>
      <input className="mono" inputMode="decimal" value={f.overheadPct}
             onChange={(e) => setF({ ...f, overheadPct: e.target.value })}
             style={{ marginTop: 6 }} />
      <p className="note">{t("overheadHint")}</p>

      <span className="k" style={{ marginTop: 11, display: "block" }}>{t("marginFloor")}</span>
      <input className="mono" inputMode="decimal" value={f.minMarginPct}
             onChange={(e) => setF({ ...f, minMarginPct: e.target.value })}
             style={{ marginTop: 6 }} />
      <p className="note">{t("marginFloorHint")}</p>

      <button className="btn pri" style={{ marginTop: 12 }} disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.costRates({
                    labourRate: Number(f.labourRate) || 0,
                    overheadPct: Number(f.overheadPct) || 0,
                    minMarginPct: Number(f.minMarginPct) || 0,
                  });
                  toast(t("saved"));
                } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                finally { setBusy(false); }
              }}>{t("save")}</button>
    </div>
  );
}
