import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type OrderDetail as OD } from "../api";

export default function OrderDetail() {
  const { id = "" } = useParams();
  const { t, lang } = useApp();
  const [d, setD] = useState<OD | null>(null);
  useEffect(() => { api.order(id).then(setD).catch(() => {}); }, [id]);
  if (!d) return <div className="empty">{t("loading")}</div>;
  const when = (s: string) => new Date(s).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB",
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="card">
        <div className="between">
          <b className="mono" style={{ fontSize: "1.1rem" }}>{d.code}</b>
          <span className="pill pri">{d.status}</span>
        </div>
        <dl className="spec" style={{ marginTop: 11 }}>
          <dt>{t("customer")}</dt><dd>{d.customer.name}</dd>
          <dt>{t("total")}</dt><dd className="mono">{d.total.toLocaleString()} EGP</dd>
          {d.promisedDate && <><dt>{t("due")}</dt><dd>{when(d.promisedDate)}</dd></>}
        </dl>
      </div>

      {d.lines.map((l) => (
        <div className="card" key={l.id}>
          <div className="between">
            <b>{lang === "ar" ? l.productAr : l.productEn}</b>
            <span className="pill">{l.status}</span>
          </div>
          {l.workOrders.map((w) => (
            <div key={w.code} style={{ marginTop: 10 }}>
              <span className="k mono">{w.code}</span>
              <div style={{ marginTop: 6 }}>
                {w.stages.map((st) => (
                  <div key={st.seq} className="stage-row">
                    <span className={`dot${st.status === "DONE" ? " done" : st.status === "IN_PROGRESS" ? " now" : st.status === "PAUSED" ? " blocked" : ""}`} />
                    <span style={{ flex: 1 }}>{lang === "ar" ? st.nameAr : st.nameEn}</span>
                    {st.status === "DONE" && (
                      <span className="mono muted">{st.actualMinutes}/{st.stdMinutes} {t("min")}</span>
                    )}
                    {st.photos.length > 0 && (
                      <span style={{ display: "flex", gap: 4 }}>
                        {st.photos.map((p, i) => (
                          <img key={i} src={`/uploads/${p.path}`} alt=""
                            style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 5, border: "1px solid var(--g3)" }} />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="card">
        <span className="k">{t("timeline")}</span>
        <div style={{ marginTop: 8 }}>
          {d.events.map((e) => (
            <div key={e.id} className="evt">
              <span className="t">{when(e.occurredAt)}</span>
              <span>
                {t(e.code as any)}
                {e.actor && <span className="muted"> · {lang === "ar" ? e.actor.nameAr : e.actor.nameEn}</span>}
                {e.payload?.reason && <span className="muted"> · {t(e.payload.reason)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
