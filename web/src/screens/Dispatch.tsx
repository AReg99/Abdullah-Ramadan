import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type FlowLine } from "../api";

/**
 * The factory manager's outbound bench: what has been made and is still here.
 * Production used to end at the last station and nothing said whether a piece
 * had left the building — this is the missing handover.
 */
export default function Dispatch() {
  const { t, lang, toast } = useApp();
  const [rows, setRows] = useState<FlowLine[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.dispatchList().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const send = async (l: FlowLine) => {
    setBusy(l.id);
    try {
      await api.dispatchLine(l.id);
      toast(t("sentToShowroom"));
      await load();
    } catch { toast(t("errStart")); }
    finally { setBusy(null); }
  };

  if (!rows) return <div className="empty">{t("loading")}</div>;

  const waiting = rows.filter((l) => l.status === "FINISHED");
  const gone = rows.filter((l) => l.status === "IN_TRANSIT");

  return (
    <>
      <div className="tiles">
        <div className="tile"><span className="k">{t("awaitingDispatch")}</span><div className="big">{waiting.length}</div></div>
        <div className="tile"><span className="k">{t("inTransit")}</span><div className="big">{gone.length}</div></div>
      </div>

      {waiting.length === 0 && gone.length === 0 && <div className="empty">{t("nothingToDispatch")}</div>}

      {waiting.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="k">{t("awaitingDispatch")}</span>
          {waiting.map((l) => (
            <div className="card" key={l.id} style={{ marginTop: 8 }}>
              <div className="nm">{lang === "ar" ? l.productAr : l.productEn} × {l.qty}</div>
              <div className="sub">
                <span className="mono">{l.order.code}</span> · {l.order.customer}
                {l.promisedDate && <> · {t("due")} {new Date(l.promisedDate).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB")}</>}
              </div>
              {l.serials.length > 0 && <div className="sub mono">{l.serials.join(" · ")}</div>}
              <button className="btn pri sm" style={{ marginTop: 10 }}
                      disabled={busy === l.id} onClick={() => send(l)}>
                {t("sendToShowroom")}
              </button>
            </div>
          ))}
        </div>
      )}

      {gone.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span className="k">{t("inTransit")}</span>
          {gone.map((l) => (
            <div className="job" key={l.id}>
              <span style={{ flex: 1 }}>
                <span className="nm">{lang === "ar" ? l.productAr : l.productEn} × {l.qty}</span>
                <span className="sub"><span className="mono">{l.order.code}</span> · {l.order.customer}</span>
              </span>
              <span className="pill warn">{t("inTransit")}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
