import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Progress } from "../api";

/**
 * What the showroom tells the customer.
 *
 * The order page next door is the factory's record — every stage, every event,
 * minutes against standard. This is the other thing entirely: one screen a
 * sales rep can read from with a customer on the phone, and a message they can
 * send without retyping it. The stages a customer was never meant to hear about
 * are counted but not named; the server decides which those are.
 */
export default function Track() {
  const { id = "" } = useParams();
  const { t, lang, toast } = useApp();
  const [p, setP] = useState<Progress | null>(null);
  const ar = lang === "ar";

  useEffect(() => { api.orderProgress(id).then(setP).catch(() => setP(null)); }, [id]);
  if (!p) return <div className="empty">{t("loading")}</div>;

  const text = ar ? p.message.ar : p.message.en;
  const day = (s: string | null) => s
    ? new Date(s).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "long" })
    : "—";
  const ago = (s: string | null) => {
    if (!s) return null;
    const h = Math.round((Date.now() - new Date(s).getTime()) / 3_600_000);
    if (h < 1) return t("justNow");
    if (h < 24) return `${h} ${t("hoursAgo")}`;
    return `${Math.round(h / 24)} ${t("daysAgo")}`;
  };

  // wa.me wants digits only, with the country code and no leading zero.
  const wa = p.customer.phone.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^0/, "20");

  return (
    <>
      <div className="card">
        <div className="between">
          <span style={{ flex: 1 }}>
            <span className="nm"><span className="mono">{p.code}</span> · {p.customer.name}</span>
            <span className="sub">
              {p.customer.phone && <span className="mono">{p.customer.phone}</span>}
              {p.lastUpdate && <> · {t("updated")} {ago(p.lastUpdate)}</>}
            </span>
          </span>
          {p.late
            ? <span className="pill bad">{t("late")}</span>
            : <span className="pill ok">{t("onTrack")}</span>}
        </div>
        <div className="sub" style={{ marginTop: 8 }}>
          {t("due")}: <b>{day(p.promisedDate)}</b>
          {p.daysToPromise !== null && !p.late && p.daysToPromise >= 0 &&
            <span className="muted"> · {p.daysToPromise} {t("daysLeft")}</span>}
        </div>
      </div>

      {p.lines.map((l) => (
        <div className="card" key={l.id}>
          <div className="between">
            <b>{ar ? l.productAr : l.productEn}{l.qty > 1 && ` × ${l.qty}`}</b>
            <span className={`pill ${l.status === "DELIVERED" ? "ok" : l.blocked ? "bad" : "pri"}`}>
              {t(`st_${l.status}` as any)}
            </span>
          </div>

          <div className="bar" aria-hidden>
            <span style={{ width: `${l.percent}%` }} />
          </div>

          <div className="sub" style={{ marginTop: 7 }}>
            {(ar ? l.milestoneAr : l.milestoneEn)
              ? <>{t("nowAt")} <b>{ar ? l.milestoneAr : l.milestoneEn}</b></>
              : t(`st_${l.status}` as any)}
            <span className="muted"> · {l.stagesDone}/{l.stagesTotal} {t("stagesDone")}</span>
            {l.blocked && <span style={{ color: "var(--bad)" }}> · {t("blocked")}</span>}
          </div>
        </div>
      ))}

      <div className="card">
        <span className="k">{t("whatToTell")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("whatToTellHint")}</p>
        <pre className="msg">{text}</pre>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sec sm" onClick={() => {
            navigator.clipboard?.writeText(text).then(() => toast(t("copied")), () => toast(t("copyFailed")));
          }}>{t("copy")}</button>
          {wa && (
            <a className="btn pri sm" style={{ textDecoration: "none" }}
               href={`https://wa.me/${wa}?text=${encodeURIComponent(text)}`}
               target="_blank" rel="noreferrer">
              {t("sendWhatsapp")}
            </a>
          )}
        </div>
      </div>

      <Link to={`/orders/${p.id}`} className="btn sec sm" style={{ textDecoration: "none" }}>
        {t("fullDetail")}
      </Link>
    </>
  );
}
