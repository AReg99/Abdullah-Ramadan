import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type ProductRow } from "../api";

type Line = { productId: string; qty: string; unitPrice: string; specNotes: string;
              lineKind: "STANDARD" | "CUSTOM" };

const BLANK: Line = { productId: "", qty: "1", unitPrice: "", specNotes: "", lineKind: "STANDARD" };

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
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.products().then(setProducts).catch(() => toast("error")); }, []);

  const priceOf = (id: string) => products.find((p) => p.id === id)?.basePrice ?? 0;
  const photosOf = (id: string) => products.find((p) => p.id === id)?.photos ?? [];
  // The catalogue price is a starting point, not the deal. What was actually
  // agreed goes in the box; leaving it blank keeps the list price.
  const lineTotal = (l: Line) =>
    (l.unitPrice.trim() === "" ? priceOf(l.productId) : Number(l.unitPrice) || 0) * (Number(l.qty) || 0);
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const valid = customerName.trim() && lines.some((l) => l.productId && Number(l.qty) > 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

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
            {products.map((p) => (
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
      </div>

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
              specNotes: l.specNotes.trim() || undefined, lineKind: l.lineKind,
            })),
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
          toast(e?.code ?? "error");
        } finally { setBusy(false); }
      }}>
        {t("createOrder")}
      </button>
      <p className="note">{t("createOrderHint")}</p>
    </>
  );
}
