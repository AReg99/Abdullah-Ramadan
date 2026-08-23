import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type StationCard } from "../api";

export default function Floor() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<StationCard[] | null>(null);
  useEffect(() => {
    const load = () => api.floor().then(setRows).catch(() => {});
    load();
    const h = setInterval(load, 5000);
    return () => clearInterval(h);
  }, []);
  if (!rows) return <div className="empty">{t("loading")}</div>;

  return (
    <div className="grid2">
      {rows.map((s) => (
        <div key={s.id} className={`stationcard${s.blocked.length ? " blocked" : s.active.length ? " busy" : ""}`}>
          <div className="between">
            <b>{lang === "ar" ? s.nameAr : s.nameEn}</b>
            <span className="chip mono">{s.code}</span>
          </div>
          <div className="row" style={{ marginTop: 9, gap: 6, flexWrap: "wrap" }}>
            <span className="pill">{t("waiting")} {s.waiting}</span>
            {s.active.length > 0 && <span className="pill pri">{t("active")} {s.active.length}</span>}
            {s.blocked.length > 0 && <span className="pill bad">{t("blocked")} {s.blocked.length}</span>}
          </div>
          {s.active.map((a) => (
            <div key={a.stageId} className="evt">
              <span>
                <b className="mono">{a.orderCode}</b> · {lang === "ar" ? a.productAr : a.productEn}
                {a.worker && <span className="muted"> · {lang === "ar" ? a.worker.nameAr : a.worker.nameEn}</span>}
                <span className="muted mono"> · {a.minutes}/{a.stdMinutes} {t("min")}</span>
              </span>
            </div>
          ))}
          {s.blocked.map((b) => (
            <div key={b.stageId} className="evt">
              <span className="pill bad">{t(b.reason as any)}</span>
              <span className="mono muted">{b.orderCode} · {b.minutes} {t("min")}</span>
            </div>
          ))}
          {!s.active.length && !s.blocked.length && !s.waiting && <p className="note">{t("noneOnFloor")}</p>}
        </div>
      ))}
    </div>
  );
}
