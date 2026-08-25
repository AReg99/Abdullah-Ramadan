import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type OrderRow } from "../api";

export default function Orders() {
  const { t, lang } = useApp();
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  useEffect(() => { api.orders().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="empty">{t("loading")}</div>;

  return (
    <>
      {rows.map((o) => {
        const late = o.promisedDate && new Date(o.promisedDate) < new Date() && o.status !== "DELIVERED";
        return (
          <Link key={o.id} to={`/orders/${o.id}`} className="job" style={{ textDecoration: "none", color: "inherit" }}>
            <span style={{ flex: 1 }}>
              <span className="nm"><span className="mono">{o.code}</span> · {o.customer}</span>
              <span className="sub">
                {o.lines.map((l) => (lang === "ar" ? l.productAr : l.productEn)).join(" · ")}
                {o.total !== undefined && <span className="mono"> · {o.total.toLocaleString()} EGP</span>}
              </span>
            </span>
            {late ? <span className="pill bad">{t("late")}</span> : <span className="pill ok">{o.status}</span>}
          </Link>
        );
      })}
    </>
  );
}
