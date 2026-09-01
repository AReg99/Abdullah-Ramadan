import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Invoice, type Quote } from "../api";

/**
 * عرض السعر المطبوع — the page the customer walks out with.
 *
 * Laid out in the browser like the invoice, which is what gives a phone a PDF
 * with no rendering service: both iOS and Android offer "save as PDF" from the
 * print sheet, and the same page is what comes out of the shop printer.
 *
 * The date it stops being true is printed as large as the total. A quote whose
 * end date is buried in the footer is a quote the customer produces in
 * September expecting March's price.
 */
export default function QuoteDoc() {
  const { id = "" } = useParams();
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [q, setQ] = useState<(Quote & { company: Invoice["company"] }) | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.quote(id).then(setQ).catch((e: any) => setErr(e?.code ?? "not_found"));
  }, [id]);

  if (err) return <div className="empty">{t(err as any)}</div>;
  if (!q) return <div className="empty">{t("loading")}</div>;

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB",
                     { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB",
                                   { day: "2-digit", month: "long", year: "numeric" });
  const c = q.company;
  const gross = q.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn pri sm" onClick={() => window.print()}>{t("printQuote")}</button>
      </div>
      <p className="note no-print">{t("printHint")}</p>

      <div className="invoice">
        <header className="inv-head">
          <div>
            <div className="inv-brand">{ar ? c.nameAr : c.nameEn || c.nameAr}</div>
            {c.address && <div className="inv-sub">{c.address}</div>}
            {c.phone && <div className="inv-sub">{c.phone}</div>}
            {c.email && <div className="inv-sub">{c.email}</div>}
          </div>
          <div style={{ textAlign: ar ? "left" : "right" }}>
            <div className="inv-title">{t("quotation")}</div>
            <div className="inv-sub mono">{q.number}</div>
            <div className="inv-sub">{date(q.createdAt)}</div>
          </div>
        </header>

        <section className="inv-party">
          <span className="k">{t("quotationFor")}</span>
          <div><b>{q.who}</b></div>
          {q.phone && <div className="inv-sub mono">{q.phone}</div>}
        </section>

        <table className="tbl inv-lines">
          <thead>
            <tr>
              <th>{t("item")}</th>
              <th className="num">{t("qty")}</th>
              <th className="num">{t("unitPrice")}</th>
              <th className="num">{t("discount")}</th>
              <th className="num">{t("lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {ar ? l.product.nameAr : l.product.nameEn}
                  <span className="inv-sub mono"> {l.product.sku}</span>
                  {l.specNotes && <div className="inv-sub">{l.specNotes}</div>}
                </td>
                <td className="num mono">{l.qty}</td>
                <td className="num mono">{num(l.unitPrice)}</td>
                <td className="num mono">{l.discount > 0 ? num(l.discount) : "—"}</td>
                <td className="num mono">{num(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="inv-totals">
          {q.discountTotal > 0 && (
            <>
              <div className="between">
                <span>{t("beforeDiscount")}</span><b className="mono">{num(gross)}</b>
              </div>
              <div className="between">
                <span>{t("discount")}</span><b className="mono">− {num(q.discountTotal)}</b>
              </div>
            </>
          )}
          <div className="between">
            <span>{t("subtotal")}</span><b className="mono">{num(q.subtotal)}</b>
          </div>
          {q.taxTotal > 0 && (
            <div className="between">
              <span>{t("vat")} {num(q.taxRate)}%</span>
              <b className="mono">{num(q.taxTotal)}</b>
            </div>
          )}
          <div className="between inv-grand">
            <span>{t("grandTotal")}</span>
            <b className="mono">{num(q.total)} EGP</b>
          </div>
          {/* As large as the total on purpose. An end date buried in the
              footer is one the customer produces in September expecting
              March's price. */}
          <div className="between inv-due">
            <span>{t("validUntilLabel")}</span>
            <b className="mono">{date(q.validUntil)}</b>
          </div>
        </section>

        {q.note && <section className="inv-pay"><p>{q.note}</p></section>}

        <footer className="inv-foot">{t("quoteFooter")}</footer>
      </div>
    </>
  );
}
