import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type Stage } from "../api";

export default function MyDay() {
  const { t } = useApp();
  const [rows, setRows] = useState<Stage[] | null>(null);
  useEffect(() => { api.workToday().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="empty">{t("loading")}</div>;

  const open = rows.length;
  const mins = rows.reduce((a, r) => a + r.actualMinutes, 0);
  const std = rows.reduce((a, r) => a + r.stage.stdMinutes, 0);

  return (
    <>
      <div className="tiles">
        <div className="tile"><span className="k">{t("openLines")}</span><div className="big">{open}</div></div>
        <div className="tile"><span className="k">{t("std")}</span><div className="big">{std}</div></div>
      </div>
      <div className="card" style={{ marginTop: 11 }}>
        <span className="k">{t("running")}</span>
        <div className="big">{mins} {t("min")}</div>
      </div>
    </>
  );
}
