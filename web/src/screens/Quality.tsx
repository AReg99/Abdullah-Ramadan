import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type QualityReport } from "../api";

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * تقرير الجودة — where faults come from.
 *
 * The point of the whole module: not how many failed, but which station, which
 * crew and which model they came from. A count with nobody attached to it
 * changes nothing on the floor.
 */
export default function Quality() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [r, setR] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.qualityReport(from, to).then(setR).catch(() => setR(null)).finally(() => setLoading(false));
  }, [from, to]);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 1 });
  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  return (
    <>
      <div className="card">
        <div className="row">
          <span style={{ flex: 1 }}>
            <span className="k">{t("from")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                   style={{ marginTop: 6 }} />
          </span>
          <span style={{ flex: 1 }}>
            <span className="k">{t("to")}</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                   style={{ marginTop: 6 }} />
          </span>
        </div>
      </div>

      {loading && <div className="empty">{t("loading")}</div>}

      {r && !loading && (
        <>
          <div className="card" style={{ marginTop: 11 }}>
            <span className="k">{t("passRate")}</span>
            <div className="big mono" style={{
              fontSize: "2rem", marginTop: 4,
              color: r.totals.passRate >= 90 ? "var(--ok)"
                   : r.totals.passRate >= 75 ? "var(--warn)" : "var(--bad)",
            }}>
              {num(r.totals.passRate)}%
            </div>
            <p className="note">
              {num(r.totals.checked)} {t("piecesChecked")}
            </p>
          </div>

          <div className="tiles g3">
            <div className="tile">
              <span className="k">{t("qc_PASS")}</span>
              <div className="big mono" style={{ color: "var(--ok)" }}>{num(r.totals.passed)}</div>
            </div>
            <div className="tile">
              <span className="k">{t("qc_REWORK")}</span>
              <div className="big mono" style={{ color: r.totals.rework ? "var(--warn)" : undefined }}>
                {num(r.totals.rework)}
              </div>
            </div>
            <div className="tile">
              <span className="k">{t("qc_SCRAP")}</span>
              <div className="big mono" style={{ color: r.totals.scrap ? "var(--bad)" : undefined }}>
                {num(r.totals.scrap)}
              </div>
            </div>
          </div>

          <Rank title={t("byDefect")} rows={r.byDefect} empty={t("noDefects")} num={num} />
          <Rank title={t("byStation")} rows={r.byStation} empty={t("noDefects")} num={num} />
          <Rank title={t("byCrew")} rows={r.byCrew} empty={t("noDefects")} num={num} />

          {r.byProduct.length > 0 && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("byProduct")}</span>
              {r.byProduct.map((p) => (
                <div className="evt" key={p.name}>
                  <span style={{ flex: 1 }}>
                    <b>{p.name}</b>
                    <span className="sub mono">
                      {num(p.failed)} / {num(p.checked)}
                    </span>
                  </span>
                  <b className="mono" style={{ color: p.failRate > 10 ? "var(--bad)" : undefined }}>
                    {num(p.failRate)}%
                  </b>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ marginTop: 11 }}>
            <span className="k">{t("rows")} · {r.rows.length}</span>
            {r.rows.length === 0 && <p className="note">{t("noRows")}</p>}
            {r.rows.map((x) => (
              <div className="evt" key={x.id}>
                <span style={{ flex: 1 }}>
                  <b style={{ color: x.result === "PASS" ? "var(--ok)" : "var(--bad)" }}>
                    {t(`qc_${x.result}` as any)}
                  </b>
                  <span className="sub">
                    {when(x.at)} · {x.product} · <span className="mono">{x.workOrder}</span>
                  </span>
                  {x.defects && <span className="sub">{x.defects}</span>}
                  {x.note && <span className="sub">{x.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** A ranked tally. Worst first, because that is the only order worth reading. */
function Rank({ title, rows, empty, num }: {
  title: string; rows: { name: string; qty: number }[]; empty: string;
  num: (n: number) => string;
}) {
  const top = rows[0]?.qty ?? 0;
  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{title}</span>
      {rows.length === 0 && <p className="note">{empty}</p>}
      {rows.map((x) => (
        <div key={x.name} style={{ marginTop: 9 }}>
          <div className="between">
            <span style={{ flex: 1 }}>{x.name}</span>
            <b className="mono">{num(x.qty)}</b>
          </div>
          {/* The bar is the comparison — the number alone hides how far ahead
              the worst offender is. */}
          <div style={{ height: 4, background: "var(--g2)", borderRadius: 100, marginTop: 5 }}>
            <div style={{
              height: "100%", borderRadius: 100, background: "var(--bad)",
              width: `${top > 0 ? Math.round((x.qty / top) * 100) : 0}%`,
            }} />
          </div>
        </div>
      ))}
    </div>
  );
}
