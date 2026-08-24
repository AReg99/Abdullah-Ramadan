import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type ProductRow } from "../api";

type Line = { productId: string; qty: string; specNotes: string; lineKind: "STANDARD" | "CUSTOM" };

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
  const [lines, setLines] = useState<Line[]>([{ productId: "", qty: "1", specNotes: "", lineKind: "STANDARD" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.products().then(setProducts).catch(() => toast("error")); }, []);

  const priceOf = (id: string) => products.find((p) => p.id === id)?.basePrice ?? 0;
  const total = lines.reduce((s, l) => s + priceOf(l.productId) * (Number(l.qty) || 0), 0);
  const valid = customerName.trim() && lines.some((l) => l.productId && Number(l.qty) > 0);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

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
            <select value={l.lineKind} onChange={(e) => setLine(i, { lineKind: e.target.value as Line["lineKind"] })} style={{ flex: 1.4 }}>
              <option value="STANDARD">{t("kindStandard")}</option>
              <option value="CUSTOM">{t("kindCustom")}</option>
            </select>
          </div>
          <input placeholder={t("specNotes")} value={l.specNotes}
            onChange={(e) => setLine(i, { specNotes: e.target.value })} style={{ marginTop: 8 }} />
        </div>
      ))}

      <button className="btn sec sm" style={{ marginTop: 4 }}
        onClick={() => setLines((ls) => [...ls, { productId: "", qty: "1", specNotes: "", lineKind: "STANDARD" }])}>
        {t("addItem")}
      </button>

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
              specNotes: l.specNotes.trim() || undefined, lineKind: l.lineKind,
            })),
          });
          toast(`${t("orderCreated")} ${r.code}`);
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
