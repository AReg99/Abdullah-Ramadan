import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Invoice as Inv } from "../api";

/**
 * The printed sales invoice.
 *
 * Laid out in the browser rather than rendered on the server, which is what
 * gives a phone a PDF without a rendering service: both iOS and Android offer
 * "save as PDF" from the print sheet, and the same page is the one that comes
 * out of a shop printer.
 *
 * The figures are the order's own, tax rate included, so an invoice reprinted
 * next year is the invoice that was issued — not today's rate applied to last
 * year's sale.
 */
export default function Invoice() {
  const { id = "" } = useParams();
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [inv, setInv] = useState<Inv | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.invoice(id).then(setInv).catch((e: any) => setErr(e?.code ?? "not_found"));
  }, [id]);

  if (err) return <div className="empty">{t(err as any)}</div>;
  if (!inv) return <div className="empty">{t("loading")}</div>;

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const c = inv.company;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn pri sm" onClick={() => window.print()}>{t("printInvoice")}</button>
      </div>
      <p className="note no-print">{t("printHint")}</p>

      <div className="invoice">
        <header className="inv-head">
          <div>
            <div className="inv-brand">{ar ? c.nameAr : c.nameEn || c.nameAr}</div>
            {c.address && <div className="inv-sub">{c.address}</div>}
            {c.phone && <div className="inv-sub">{c.phone}</div>}
            {c.email && <div className="inv-sub">{c.email}</div>}
            {/* A registration number is what makes it a tax invoice rather
                than a receipt, so it prints whenever there is one. */}
            {c.vatNumber && <div className="inv-sub">{t("vatNumber")}: {c.vatNumber}</div>}
          </div>
          <div style={{ textAlign: ar ? "left" : "right" }}>
            <div className="inv-title">{inv.totals.taxTotal > 0 ? t("taxInvoice") : t("invoice")}</div>
            <div className="inv-sub mono">{inv.order.code}</div>
            <div className="inv-sub">{date(inv.order.date)}</div>
          </div>
        </header>

        <section className="inv-party">
          <span className="k">{t("customer")}</span>
          <div><b>{inv.customer.name}</b></div>
          {inv.customer.phone && <div className="inv-sub mono">{inv.customer.phone}</div>}
          {inv.order.showroom && <div className="inv-sub">{inv.order.showroom}</div>}
        </section>

        <table className="tbl inv-lines">
          <thead>
            <tr>
              <th>{t("item")}</th>
              <th className="num">{t("qty")}</th>
              <th className="num">{t("unitPrice")}</th>
              <th className="num">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  {ar ? l.nameAr : l.nameEn}
                  <span className="inv-sub mono"> {l.sku}</span>
                  {l.specNotes && <div className="inv-sub">{l.specNotes}</div>}
                </td>
                <td className="num mono">{l.qty}</td>
                <td className="num mono">{num(l.unitPrice)}</td>
                <td className="num mono">{num(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="inv-totals">
          <div className="between"><span>{t("subtotal")}</span><b className="mono">{num(inv.totals.subtotal)}</b></div>
          {inv.totals.taxTotal > 0 && (
            <div className="between">
              <span>{t("vat")} {num(inv.totals.taxRate)}%</span>
              <b className="mono">{num(inv.totals.taxTotal)}</b>
            </div>
          )}
          <div className="between inv-grand">
            <span>{t("grandTotal")}</span>
            <b className="mono">{num(inv.totals.total)} {inv.order.currency}</b>
          </div>
          <div className="between"><span>{t("paidSoFar")}</span><b className="mono">{num(inv.totals.paid)}</b></div>
          <div className="between inv-due">
            <span>{t("outstanding")}</span>
            <b className="mono">{num(inv.totals.outstanding)}</b>
          </div>
        </section>

        {inv.payments.length > 0 && (
          <section className="inv-pay">
            <span className="k">{t("payments")}</span>
            {inv.payments.map((p, i) => (
              <div className="between" key={i}>
                <span>{date(p.date)} · {t(p.method as any)}{p.reference ? ` · ${p.reference}` : ""}</span>
                <b className="mono">{num(p.amount)}</b>
              </div>
            ))}
          </section>
        )}

        <footer className="inv-foot">{t("invoiceFooter")}</footer>
      </div>
    </>
  );
}
