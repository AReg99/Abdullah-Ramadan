import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Voucher as V } from "../api";

/**
 * سند قبض / سند صرف — the slip somebody signs.
 *
 * One page for both directions, because they are the same document with the
 * name changed: a date, a party, an amount, what was allowed off, how it was
 * paid, and room for a note. Two near-identical pages would drift apart, and
 * the one nobody looked at would be the one that got printed.
 */
export default function Voucher() {
  const { id = "" } = useParams();
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [v, setV] = useState<V | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.voucher(id).then(setV).catch((e: any) => setErr(e?.code ?? "not_found"));
  }, [id]);

  if (err) return <div className="empty">{t(err as any)}</div>;
  if (!v) return <div className="empty">{t("loading")}</div>;

  const num = (n: number) =>
    n.toLocaleString(ar ? "ar-EG" : "en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const date = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "long", year: "numeric" });

  const receipt = v.voucher.kind === "RECEIPT";
  const against = v.against.orderInvoiceNo ?? v.against.orderCode ?? v.against.purchaseNumber;

  return (
    <>
      <div className="row no-print" style={{ marginBottom: 14 }}>
        <button className="btn pri sm" onClick={() => window.print()}>{t("printVoucher")}</button>
      </div>
      <p className="note no-print">{t("printHint")}</p>

      <div className="invoice">
        <header className="inv-head">
          <div>
            <div className="inv-brand">{ar ? v.company.nameAr : v.company.nameEn || v.company.nameAr}</div>
            {v.company.address && <div className="inv-sub">{v.company.address}</div>}
            {v.company.phone && <div className="inv-sub">{v.company.phone}</div>}
          </div>
          <div style={{ textAlign: ar ? "left" : "right" }}>
            <div className="inv-title">{receipt ? t("receiptVoucher") : t("paymentVoucher")}</div>
            {v.voucher.number && <div className="inv-sub mono">{v.voucher.number}</div>}
            <div className="inv-sub">{date(v.voucher.date)}</div>
          </div>
        </header>

        {/* A reversal printed as an ordinary voucher is a second receipt for
            money that came back. It has to say what it is. */}
        {v.voucher.isReversal && <p className="note">⚠︎ {t("thisIsAReversal")}</p>}

        <section className="inv-party">
          <span className="k">{receipt ? t("receivedFrom") : t("paidTo")}</span>
          <div><b>{v.party.name ?? "—"}</b></div>
          {v.party.phone && <div className="inv-sub mono">{v.party.phone}</div>}
        </section>

        <section className="inv-totals" style={{ maxWidth: "none", marginTop: 18 }}>
          <div className="between inv-grand">
            <span>{receipt ? t("amountReceived") : t("amountPaid")}</span>
            <b className="mono">{num(v.voucher.amount)}</b>
          </div>
          {v.voucher.discount > 0 && (
            <>
              <div className="between">
                <span>{t("settlementDiscount")}</span>
                <b className="mono">{num(v.voucher.discount)}</b>
              </div>
              <div className="between">
                <span>{t("totalSettled")}</span>
                <b className="mono">{num(v.voucher.settled)}</b>
              </div>
            </>
          )}
          <div className="between"><span>{t("method")}</span><b>{t(v.voucher.method as any)}</b></div>
          <div className="between">
            <span>{t("intoAccount")}</span><b>{ar ? v.account.nameAr : v.account.nameEn}</b>
          </div>
          {against && (
            <div className="between"><span>{t("against")}</span><b className="mono">{against}</b></div>
          )}
          {v.voucher.reference && (
            <div className="between"><span>{t("reference")}</span><b className="mono">{v.voucher.reference}</b></div>
          )}
        </section>

        {/* Room to write on. A voucher with nowhere for the reason is a
            voucher that gets one scrawled across the total. */}
        <section className="inv-pay">
          <span className="k">{t("note")}</span>
          <div className="voucher-note">{v.voucher.note ?? ""}</div>
        </section>

        <section className="voucher-signs">
          <div><span className="k">{receipt ? t("receivedBy") : t("paidBy")}</span><div className="sign-line" />
            <div className="inv-sub">{v.by ?? ""}</div></div>
          <div><span className="k">{receipt ? t("payerSignature") : t("payeeSignature")}</span>
            <div className="sign-line" /></div>
        </section>

        <footer className="inv-foot">{ar ? v.company.nameAr : v.company.nameEn}</footer>
      </div>
    </>
  );
}
