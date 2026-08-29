import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type Summary as S } from "../api";

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * ملخص الحسابات — the whole business on one screen.
 *
 * Not another report. The answer to "how are we doing", which otherwise means
 * opening five tabs and holding four numbers in your head. What is in the
 * drawers, what the month did, who owes us, who we owe — and the names behind
 * each, because a total with nobody attached to it cannot be acted on.
 */
export default function Summary() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [month, setMonth] = useState(thisMonth());
  const [s, setS] = useState<S | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.summary(month).then(setS).catch(() => setS(null)).finally(() => setLoading(false));
  }, [month]);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 0 });
  const money = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });

  return (
    <>
      <div className="card">
        <span className="k">{t("payMonth")}</span>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
               style={{ marginTop: 6 }} />
      </div>

      {loading && <div className="empty">{t("loading")}</div>}

      {s && !loading && (
        <>
          {/* The one number an owner asks for, given room of its own. */}
          <div className="card" style={{ marginTop: 11 }}>
            <span className="k">{t("netPosition")}</span>
            <div className="big mono" style={{ fontSize: "2rem", marginTop: 4 }}>
              {money(s.totals.net)}
            </div>
            <p className="note">{t("netPositionHint")}</p>
          </div>

          <div className="tiles g3" style={{ marginTop: 11 }}>
            <div className="tile">
              <span className="k">{t("inHand")}</span>
              {/* A drawer cannot really hold less than nothing. When it reads
                  negative something was posted that never happened, or in the
                  wrong order — and it has to look wrong, not just be wrong. */}
              <div className="big mono" style={{ color: s.totals.inHand < 0 ? "var(--bad)" : undefined }}>
                {num(s.totals.inHand)}
              </div>
            </div>
            <div className="tile">
              <span className="k">{t("owedToUs")}</span>
              <div className="big mono" style={{ color: s.totals.receivable > 0 ? "var(--warn)" : undefined }}>
                {num(s.totals.receivable)}
              </div>
            </div>
            <div className="tile">
              <span className="k">{t("weOwe")}</span>
              <div className="big mono" style={{ color: s.totals.payable > 0 ? "var(--bad)" : undefined }}>
                {num(s.totals.payable)}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 11 }}>
            <span className="k">{t("theMonth")}</span>
            <div className="evt"><span style={{ flex: 1 }}>{t("tot_revenue")}</span>
              <b className="mono">{money(s.totals.sales)}</b></div>
            <div className="evt"><span style={{ flex: 1 }}>{t("tot_cogs")}</span>
              <b className="mono">− {money(s.totals.cogs)}</b></div>
            <div className="evt"><span style={{ flex: 1 }}>{t("tot_expenses")}</span>
              <b className="mono">− {money(s.totals.expenses)}</b></div>
            <div className="evt" style={{ borderTop: "1px solid var(--g3)", marginTop: 4, paddingTop: 9 }}>
              <span style={{ flex: 1 }}><b>{t("tot_net")}</b></span>
              <b className="mono" style={{ color: s.totals.profit >= 0 ? "var(--ok)" : "var(--bad)" }}>
                {money(s.totals.profit)}
              </b>
            </div>
            <div className="evt"><span style={{ flex: 1 }} className="muted">{t("tot_paid")}</span>
              <span className="mono muted">{money(s.totals.collected)}</span></div>
          </div>

          <div className="card" style={{ marginTop: 11 }}>
            <span className="k">{t("accounts")}</span>
            {s.cash.map((a) => (
              <div className="evt" key={a.id}>
                <span style={{ flex: 1 }}>{ar ? a.nameAr : a.nameEn}
                  <span className="muted"> · {t(a.kind as any)}</span></span>
                <b className="mono" style={{ color: a.balance < 0 ? "var(--bad)" : undefined }}>
                  {money(a.balance)}
                </b>
              </div>
            ))}
            {s.cash.some((a) => a.balance < 0) && <p className="note">{t("negativeBalance")}</p>}
          </div>

          <NameList title={t("topDebtors")} rows={s.topDebtors} empty={t("nobodyOwes")}
                    render={(r) => ({ to: `/orders/${r.id}`, name: r.customer,
                                      sub: `${r.code} · ${r.ageDays} ${t("day")}`,
                                      value: r.outstanding })} money={money} />
          <NameList title={t("oldestDebts")} rows={s.oldestDebts} empty={t("nobodyOwes")}
                    render={(r) => ({ to: `/orders/${r.id}`, name: r.customer,
                                      sub: `${r.code} · ${r.ageDays} ${t("day")}`,
                                      value: r.outstanding })} money={money} />
          <NameList title={t("topBills")} rows={s.topBills} empty={t("nothingOwed")}
                    render={(r) => ({ to: `/purchase/${r.id}`, name: r.supplier,
                                      sub: `${r.number} · ${r.ageDays} ${t("day")}`,
                                      value: r.outstanding })} money={money} />

          {Object.keys(s.byExpense).length > 0 && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("tot_expenses")}</span>
              {Object.entries(s.byExpense)
                .sort((a, b) => b[1] - a[1])
                .map(([c, v]) => (
                  <div className="evt" key={c}>
                    <span style={{ flex: 1 }}>{t(`cat_${c}` as any)}</span>
                    <b className="mono">{money(v)}</b>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** A total is not actionable until it has names under it. */
function NameList({ title, rows, empty, render, money }: {
  title: string; rows: any[]; empty: string; money: (n: number) => string;
  render: (r: any) => { to: string; name: string; sub: string; value: number };
}) {
  return (
    <div className="card" style={{ marginTop: 11 }}>
      <span className="k">{title}</span>
      {rows.length === 0 && <p className="note">{empty}</p>}
      {rows.map((r, i) => {
        const x = render(r);
        return (
          <Link key={i} to={x.to} className="evt" style={{ textDecoration: "none", color: "inherit" }}>
            <span style={{ flex: 1 }}>
              <b>{x.name}</b>
              <span className="sub mono">{x.sub}</span>
            </span>
            <b className="mono">{money(x.value)}</b>
          </Link>
        );
      })}
    </div>
  );
}
