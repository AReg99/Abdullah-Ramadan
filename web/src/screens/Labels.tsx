import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type LabelRow } from "../api";
import QRCode from "qrcode";

/** The label carries the QR the worker scans. Print, attach, and it stays on the piece. */
export default function Labels() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  useEffect(() => { api.labels().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="empty">{t("loading")}</div>;

  return (
    <>
      <div className="no-print">
        <p className="note" style={{ marginTop: 0 }}>{t("labelHint")}</p>
        <button className="btn sec sm" onClick={() => window.print()}>{t("printAll")}</button>
        <div style={{ height: 12 }} />
      </div>
      <div className="labelsheet">
        {rows.map((l) => (
          <div className="label" key={l.id}>
            <Qr text={l.serial} />
            <div className="label-txt">
              <b className="mono">{l.serial}</b>
              <span>{lang === "ar" ? l.productAr : l.productEn}</span>
              <span className="mono muted">{l.orderCode} · {l.workOrderCode}</span>
              <span className="muted">{l.customer}</span>
            </div>
          </div>
        ))}
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
