import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type PurchaseDoc as PD } from "../api";

/**
 * The supplier's bill, laid out the way ours is.
 *
 * Same shape as the sales invoice on purpose: whoever checks one checks the
 * other, and a bill that reads differently from an invoice is a bill whose
 * total nobody re-adds.
 */
export default function PurchaseDoc() {
  const { id = "" } = useParams();
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [d, setD] = useState<PD | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.purchase(id).then(setD).catch((e: any) => setErr(e?.code ?? "not_found"));
  }, [id]);

  if (err) return <div className="empty">{t(err as any)}</div>;
  if (!d) return <div className="empty">{t("loading")}</div>;

  const num = (n: number) =>
    n.toLocaleString(ar ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (x: string) =>
    new Date(x).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn pri sm" onClick={() => window.print()}>{t("printInvoice")}</button>
      </div>

      <div className="invoice">
        <header className="inv-head">
          <div>
            <div className="inv-brand">{ar ? d.company.nameAr : d.company.nameEn || d.company.nameAr}</div>
            {d.company.address && <div className="inv-sub">{d.company.address}</div>}
            {d.company.vatNumber && <div className="inv-sub">{t("vatNumber")}: {d.company.vatNumber}</div>}
          </div>
          <div style={{ textAlign: ar ? "left" : "right" }}>
            <div className="inv-title">{t("rep_purchases")}</div>
            <div className="inv-sub mono">{d.invoice.number}</div>
            <div className="inv-sub">{date(d.invoice.date)}</div>
          </div>
        </header>

        <section className="inv-party">
          <span className="k">{t("col_supplier")}</span>
          <div><b>{d.supplier.name}</b></div>
          {d.supplier.phone && <div className="inv-sub mono">{d.supplier.phone}</div>}
          {d.invoice.warehouse && (
            <div className="inv-sub">{t("warehouse")}: {d.invoice.warehouse}</div>
          )}
        </section>

        {d.lines.length > 0 && (
          <table className="tbl inv-lines">
            <thead>
              <tr>
                <th>{t("item")}</th>
                <th>{t("warehouse")}</th>
                <th className="num">{t("qty")}</th>
                <th className="num">{t("unitPrice")}</th>
                <th className="num">{t("discount")}</th>
                <th className="num">{t("lineTotal")}</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td>{l.warehouse ?? d.invoice.warehouse ?? "—"}</td>
                  <td className="num mono">{l.qty}</td>
                  <td className="num mono">{num(l.unitPrice)}</td>
                  <td className="num mono">{l.discount > 0 ? num(l.discount) : "—"}</td>
                  <td className="num mono">{num(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="inv-totals">
          <div className="between"><span>{t("subtotal")}</span><b className="mono">{num(d.totals.subtotal)}</b></div>
          {d.totals.discount > 0 && (
            <div className="between"><span>{t("discount")}</span><b className="mono">− {num(d.totals.discount)}</b></div>
          )}
          {d.totals.taxTotal > 0 && (
            <div className="between">
              <span>{t("vat")} {num(d.totals.taxRate)}%</span>
              <b className="mono">{num(d.totals.taxTotal)}</b>
            </div>
          )}
          <div className="between inv-grand">
            <span>{t("grandTotal")}</span><b className="mono">{num(d.totals.total)}</b>
          </div>
          <div className="between"><span>{t("paidSoFar")}</span><b className="mono">{num(d.totals.paid)}</b></div>
          <div className="between inv-due">
            <span>{t("outstanding")}</span><b className="mono">{num(d.totals.outstanding)}</b>
          </div>
        </section>

        {d.payments.length > 0 && (
          <section className="inv-pay">
            <span className="k">{t("payments")}</span>
            {d.payments.map((p, i) => (
              <div className="between" key={i}>
                <span>
                  {p.voucherNo && <span className="mono">{p.voucherNo} · </span>}
                  {date(p.date)} · {t(p.method as any)}
                  {p.discount > 0 ? ` · ${t("discount")} ${num(p.discount)}` : ""}
                </span>
                <b className="mono">{num(p.amount)}</b>
              </div>
            ))}
          </section>
        )}

        {d.invoice.note && <footer className="inv-foot">{d.invoice.note}</footer>}
      </div>
    </>
  );
}
