import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type FlowLine } from "../api";

/**
 * The showroom's own board — the half of the journey that happens after the
 * factory gate. Three columns of the same list: on its way here, standing here
 * waiting for the customer, and gone home with them.
 */
export default function Showroom() {
  const { t, lang, toast } = useApp();
  const [rows, setRows] = useState<FlowLine[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.showroomList().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
    const h = setInterval(load, 15000);
    return () => clearInterval(h);
  }, []);

  const act = async (l: FlowLine, what: "receive" | "deliver") => {
    // Handing a sofa to a customer is not undoable in the app, so make the
    // person say so twice rather than lose a delivery to a mis-tap.
    if (what === "deliver" && !confirm(`${t("confirmDeliver")}\n\n${l.order.customer} · ${l.order.code}`)) return;
    setBusy(l.id);
    try {
      await (what === "receive" ? api.receiveLine(l.id) : api.deliverLine(l.id));
      toast(what === "receive" ? t("markedArrived") : t("markedDelivered"));
      await load();
    } catch { toast(t("errStart")); }
    finally { setBusy(null); }
  };

  if (!rows) return <div className="empty">{t("loading")}</div>;

  const arriving = rows.filter((l) => l.status === "IN_TRANSIT");
  const here = rows.filter((l) => l.status === "READY");
  const done = rows.filter((l) => l.status === "DELIVERED");

  const days = (iso: string | null) =>
    iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : 0;

  const head = (l: FlowLine) => (
    <>
      {/* Straight to what the customer needs to be told about this piece. */}
      <Link to={`/track/${l.order.id}`} style={{ textDecoration: "none", color: "inherit" }}>
        <div className="nm">{lang === "ar" ? l.productAr : l.productEn} × {l.qty}</div>
        <div className="sub">
          <span className="mono">{l.order.code}</span> · {l.order.customer}
          {l.order.phone && <> · <span className="mono">{l.order.phone}</span></>}
        </div>
      </Link>
    </>
  );

  return (
    <>
      <div className="tiles g3">
        <div className="tile"><span className="k">{t("arriving")}</span><div className="big">{arriving.length}</div></div>
        <div className="tile"><span className="k">{t("atShowroom")}</span><div className="big">{here.length}</div></div>
        <div className="tile"><span className="k">{t("deliveredWeek")}</span><div className="big">{done.length}</div></div>
      </div>

      {rows.length === 0 && <div className="empty">{t("showroomEmpty")}</div>}

      {arriving.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <span className="k">{t("arriving")}</span>
          {arriving.map((l) => (
            <div className="card" key={l.id} style={{ marginTop: 8 }}>
              {head(l)}
              <button className="btn sec sm" style={{ marginTop: 10 }}
                      disabled={busy === l.id} onClick={() => act(l, "receive")}>
                {t("markArrived")}
              </button>
            </div>
          ))}
        </div>
      )}

      {here.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span className="k">{t("atShowroom")}</span>
          {here.map((l) => {
            const d = days(l.receivedAt);
            return (
              <div className="card" key={l.id} style={{ marginTop: 8 }}>
                {head(l)}
                {d >= 1 && (
                  <div className="sub" style={{ color: d >= 7 ? "var(--warn)" : undefined }}>
                    {t("waitingHere")} {d} {t("daysShort")}
                  </div>
                )}
                <button className="btn pri sm" style={{ marginTop: 10 }}
                        disabled={busy === l.id} onClick={() => act(l, "deliver")}>
                  {t("markDelivered")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <span className="k">{t("deliveredWeek")}</span>
          {done.map((l) => (
            <div className="job" key={l.id}>
              <span style={{ flex: 1 }}>
                <span className="nm">{lang === "ar" ? l.productAr : l.productEn} × {l.qty}</span>
                <span className="sub"><span className="mono">{l.order.code}</span> · {l.order.customer}</span>
              </span>
              <span className="pill ok">{t("delivered")}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
