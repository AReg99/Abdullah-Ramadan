import { useEffect, useMemo, useState } from "react";
import { useApp } from "../app-context";
import { api, type LabelRow } from "../api";
import QRCode from "qrcode";

type State = "all" | "new" | "done";

/**
 * The label carries the QR the worker scans. Print, attach, and it stays on the
 * piece.
 *
 * Printing is a choice, not a batch of everything: a workshop prints the six
 * labels for the order that just went into production, or the one that came
 * back soaked in lacquer. Sending the whole book to the printer wastes a roll
 * of label stock and buries the six that were wanted.
 */
export default function Labels() {
  const { t, lang, toast } = useApp();
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [order, setOrder] = useState("");
  const [state, setState] = useState<State>("all");
  // The browser cannot tell us whether paper came out, so we ask.
  const [ask, setAsk] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.labels().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const orders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of rows ?? []) if (!seen.has(l.orderCode)) seen.set(l.orderCode, l.customer);
    return [...seen].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((l) => {
      if (order && l.orderCode !== order) return false;
      if (state === "new" && l.printedAt) return false;
      if (state === "done" && !l.printedAt) return false;
      if (!needle) return true;
      return [l.serial, l.customer, l.productAr, l.productEn, l.orderCode, l.workOrderCode]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, order, state]);

  // Ticked, but filtered off the screen. They print, so the screen has to say
  // they are there.
  const hiddenChosen = (rows ?? []).filter(
    (l) => chosen.has(l.id) && !shown.includes(l)).length;

  if (!rows) return <div className="empty">{t("loading")}</div>;

  const toggle = (id: string) => setChosen((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectShown = () => setChosen((cur) => new Set([...cur, ...shown.map((l) => l.id)]));

  const print = () => {
    const ids = [...chosen];
    if (!ids.length) return;
    window.print();
    setAsk(ids);
  };

  const markPrinted = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      await api.labelsPrinted(ask);
      toast(t("labelMarked"));
      setChosen(new Set());
      setAsk(null);
      await load();
    // Show the message, not the machine's code for it.
    } catch (e: any) {
      toast(e?.code ? t(e.code) : "error");
    } finally { setBusy(false); }
  };

  const date = (s: string) =>
    new Date(s).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB",
                                  { day: "2-digit", month: "short" });

  return (
    <>
      <div className="no-print">
        <p className="note" style={{ marginTop: 0 }}>{t("labelHint")}</p>

        <div className="card" style={{ marginBottom: 12 }}>
          <span className="k">{t("labelPick")}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={t("labelSearch")} style={{ marginTop: 8 }} />
          <select value={order} onChange={(e) => setOrder(e.target.value)}
                  style={{ marginTop: 8 }}>
            <option value="">{t("labelAllOrders")}</option>
            {orders.map(([code, customer]) => (
              <option key={code} value={code}>{code} · {customer}</option>
            ))}
          </select>
          <div className="tabs" style={{ marginTop: 10, marginBottom: 0 }}>
            {(["all", "new", "done"] as State[]).map((s) => (
              <button key={s} className={`btn sm ${state === s ? "pri" : "sec"}`}
                      onClick={() => setState(s)}>
                {t(s === "all" ? "labelStateAll" : s === "new" ? "labelStateNew" : "labelStateDone")}
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 10, alignItems: "center" }}>
            <button className="btn sec sm toggle" onClick={selectShown} disabled={!shown.length}>
              {t("labelSelectShown")}
            </button>
            <button className="btn sec sm toggle" onClick={() => setChosen(new Set())}
                    disabled={!chosen.size}>
              {t("labelClear")}
            </button>
            <span className="muted" style={{ fontSize: ".84rem" }}>
              {t("labelChosen")} · {chosen.size}
            </span>
          </div>
        </div>

        {/* Asked after the print dialog closes, because nothing else can tell
            us whether the paper actually came out. */}
        {ask ? (
          <div className="card" style={{ marginBottom: 12 }}>
            <span className="k">{t("labelMarkAsk")}</span>
            <div className="row wrap" style={{ marginTop: 9 }}>
              <button className="btn pri sm toggle" onClick={markPrinted} disabled={busy}>
                {t("labelMarkYes")}
              </button>
              <button className="btn sec sm toggle" onClick={() => setAsk(null)} disabled={busy}>
                {t("labelMarkNo")}
              </button>
            </div>
          </div>
        ) : (
          <button className="btn pri" onClick={print} disabled={!chosen.size}>
            {t("labelPrintChosen")} {chosen.size ? `· ${chosen.size}` : ""}
          </button>
        )}

        {!chosen.size && <p className="note">{t("labelNoneChosen")}</p>}
        {hiddenChosen > 0 && (
          <p className="note">{hiddenChosen} {t("labelHiddenChosen")}</p>
        )}
        <div style={{ height: 12 }} />
      </div>

      {shown.length === 0 && <p className="empty no-print">{t("labelNoneMatch")}</p>}

      <div className="labelsheet">
        {rows.map((l) => {
          const on = chosen.has(l.id);
          // Hidden by the filter on screen, but a chosen label still prints:
          // narrowing the list after ticking must not silently drop them.
          const hide = !shown.includes(l);
          return (
            <div className={`labelpick${on ? " on" : ""}${hide ? " hide" : ""}`} key={l.id}>
              <button type="button" className="labelbar no-print" aria-pressed={on}
                      onClick={() => toggle(l.id)}>
                <span className="box">{on ? "✓" : ""}</span>
                <span className="mono" style={{ flex: 1, textAlign: "start" }}>{l.serial}</span>
                {l.printedAt
                  ? <span className="pill ok">{t("labelPrintedOn")} {date(l.printedAt)}</span>
                  : <span className="pill pri">{t("notPrinted")}</span>}
              </button>
              <div className="label">
                <Qr text={l.serial} />
                <div className="label-txt">
                  <b className="mono">{l.serial}</b>
                  <span>{lang === "ar" ? l.productAr : l.productEn}</span>
                  <span className="mono muted">{l.orderCode} · {l.workOrderCode}</span>
                  <span className="muted">{l.customer}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * Rendered with node-qrcode rather than anything hand-rolled: a label that does
 * not scan is worse than no label, and correctness here is not worth inventing.
 * Error correction M survives the dust and scuffing a workshop puts on a label.
 */
function Qr({ text }: { text: string }) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    QRCode.toString(text, {
      type: "svg", errorCorrectionLevel: "M", margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [text]);
  if (!svg) return <div className="thumb" style={{ width: 92, height: 92, flex: "none" }}>QR</div>;
  return <div className="qr" style={{ width: 92, height: 92, flex: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
