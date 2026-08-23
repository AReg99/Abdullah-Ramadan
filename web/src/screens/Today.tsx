import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type Dashboard } from "../api";

export default function Today() {
  const { t, lang } = useApp();
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => {
    const load = () => api.today().then(setD).catch(() => {});
    load();
    const h = setInterval(load, 5000); // the floor changes while you watch it
    return () => clearInterval(h);
  }, []);
  if (!d) return <div className="empty">{t("loading")}</div>;
  const clock = (s: string) => new Date(s).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="tiles g3">
        <div className="tile"><span className="k">{t("ordersToday")}</span><div className="big">{d.ordersToday.count}</div>
          <div className="k muted mono">{d.ordersToday.value.toLocaleString()} EGP</div></div>
        <div className="tile"><span className="k">{t("unitsFinished")}</span><div className="big">{d.unitsFinished}</div></div>
        <div className="tile"><span className="k">{t("openLines")}</span><div className="big">{d.openLines}</div></div>
        <div className="tile"><span className="k">{t("late")}</span>
          <div className="big" style={{ color: d.late ? "var(--bad)" : undefined }}>{d.late}</div></div>
        <div className="tile"><span className="k">{t("atRisk")}</span>
          <div className="big" style={{ color: d.atRisk ? "var(--warn)" : undefined }}>{d.atRisk}</div></div>
        <div className="tile"><span className="k">{t("blockedNow")}</span>
          <div className="big" style={{ color: d.blocked.length ? "var(--bad)" : undefined }}>{d.blocked.length}</div></div>
      </div>

      {d.blocked.length > 0 && (
        <div className="card" style={{ marginTop: 11 }}>
          <span className="k">{t("blockedNow")}</span>
          <div style={{ marginTop: 8 }}>
            {d.blocked.map((b) => (
              <div key={b.stageId} className="evt">
                <span className="pill bad">{t(b.reason as any)}</span>
                <span>
                  <b className="mono">{b.orderCode}</b> · {lang === "ar" ? b.stationAr : b.station}
                  <span className="muted"> · {b.minutes} {t("min")}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 11 }}>
        <span className="k">{t("events")}</span>
        <div style={{ marginTop: 8 }}>
          {d.events.length === 0 && <p className="note">{t("noEvents")}</p>}
          {d.events.map((e) => (
            <div key={e.id} className="evt">
              <span className="t">{clock(e.occurredAt)}</span>
              <span>
                {t(e.code as any)}
                {e.actor && <span className="muted"> · {lang === "ar" ? e.actor.nameAr : e.actor.nameEn}</span>}
                {e.station && <span className="muted"> · {lang === "ar" ? e.station.nameAr : e.station.nameEn}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
