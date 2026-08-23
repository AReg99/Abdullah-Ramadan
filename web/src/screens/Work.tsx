import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Stage } from "../api";

export default function Work() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<Stage[] | null>(null);

  useEffect(() => { api.workToday().then(setRows).catch(() => setRows([])); }, []);

  if (!rows) return <div className="empty">{t("loading")}</div>;
  if (!rows.length) return <div className="empty"><div style={{ fontSize: "2rem", marginBottom: 10 }}>✓</div>{t("noJobs")}</div>;

  return (
    <>
      {rows.map((s) => (
        <Link key={s.id} to={`/work/${s.id}`} className="job" style={{ textDecoration: "none", color: "inherit" }}>
          <span style={{ flex: 1 }}>
            <span className="nm">{lang === "ar" ? s.workOrder.product.nameAr : s.workOrder.product.nameEn}</span>
            <span className="sub">
              <span className="mono">{s.workOrder.order.code}</span> · {lang === "ar" ? s.stage.nameAr : s.stage.nameEn} · {t("qty")} {s.workOrder.qty}
            </span>
          </span>
          {s.status === "IN_PROGRESS" && <span className="pill pri">{t("running")}</span>}
          {s.status === "PAUSED" && <span className="pill warn">{t(s.blockedReason as any)}</span>}
        </Link>
      ))}
    </>
  );
}
