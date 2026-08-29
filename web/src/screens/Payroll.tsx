import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type CashAccount, type Payroll as Pay } from "../api";

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * The week a date falls in, counted from the first Saturday on or before the
 * 1st of January — deliberately not ISO, which starts weeks on Monday and
 * would split every Egyptian working week across two pay periods.
 */
function weekKeyOf(d: Date) {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  for (const y of [day.getUTCFullYear(), day.getUTCFullYear() - 1, day.getUTCFullYear() + 1]) {
    const jan1 = new Date(Date.UTC(y, 0, 1, 12));
    const first = new Date(jan1.getTime() - ((jan1.getUTCDay() + 1) % 7) * 86_400_000);
    for (let w = 1; w <= 53; w++) {
      const st = new Date(first.getTime() + (w - 1) * 7 * 86_400_000);
      const en = new Date(st.getTime() + 6 * 86_400_000);
      if (day >= st && day <= en) return `${y}-W${String(w).padStart(2, "0")}`;
    }
  }
  return `${day.getUTCFullYear()}-W01`;
}
const thisWeek = () => weekKeyOf(new Date());

/**
 * The month's wages.
 *
 * The list is a view of who is on the payroll and what they are owed, not a
 * second list to be maintained — the two would drift the first time somebody
 * got a rise. Once a month is posted it stops being a view and becomes the
 * record: an old month reads back as it was paid, not as today's salaries.
 */
export default function Payroll() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  // The floor is paid weekly against days worked; the office monthly. The
  // screen opens on the week, because that is the one done every Thursday.
  const [kind, setKind] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const [week, setWeek] = useState(thisWeek());
  const [month, setMonth] = useState(thisMonth());
  const period = kind === "WEEKLY" ? week : month;
  const [pay, setPay] = useState<Pay | null>(null);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [editing, setEditing] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setPay(await api.payroll(period)); setSkip([]); }
    catch { setPay(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [period]);
  useEffect(() => { api.cashAccounts().then(setAccounts).catch(() => setAccounts([])); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });
  const due = pay ? pay.lines.filter((l) => !skip.includes(l.userId))
                             .reduce((s, l) => s + l.amount, 0) : 0;

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className={`btn sm ${kind === "WEEKLY" ? "pri" : "sec"}`}
                onClick={() => setKind("WEEKLY")}>{t("weekly")}</button>
        <button className={`btn sm ${kind === "MONTHLY" ? "pri" : "sec"}`}
                onClick={() => setKind("MONTHLY")}>{t("monthly")}</button>
      </div>

      <div className="card">
        {kind === "WEEKLY" ? (
          <>
            <span className="k">{t("payWeek")}</span>
            {/* A week is picked by naming any day in it, which is how people
                think about it — nobody knows what week number it is. */}
            <input type="date" onChange={(e) => e.target.value && setWeek(weekKeyOf(new Date(`${e.target.value}T12:00:00Z`)))}
                   style={{ marginTop: 6 }} />
            <p className="note">
              <span className="mono">{week}</span>
              {pay?.start && ` · ${new Date(pay.start).toLocaleDateString(ar ? "ar-EG" : "en-GB")}`}
              {pay?.end && ` — ${new Date(pay.end).toLocaleDateString(ar ? "ar-EG" : "en-GB")}`}
            </p>
          </>
        ) : (
          <>
            <span className="k">{t("payMonth")}</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                   style={{ marginTop: 6 }} />
          </>
        )}
      </div>

      {loading && <div className="empty">{t("loading")}</div>}

      {pay && !loading && (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="k">{t("onPayroll")}</span>
              <div className="big mono">{num(pay.lines.length)}</div>
            </div>
            <div className="tile">
              <span className="k">{pay.posted ? t("paidSoFar") : t("amountDue")}</span>
              <div className="big mono">{num(pay.posted ? pay.total : due)}</div>
            </div>
          </div>

          {pay.posted && (
            <p className="note">
              {t("alreadyPaid")}{pay.account ? ` · ${ar ? pay.account.nameAr : pay.account.nameEn}` : ""}
            </p>
          )}

          <div className="card" style={{ marginTop: 11 }}>
            {pay.lines.length === 0 && (
              <p className="note">
                {kind === "WEEKLY" ? t("nobodyOnDayRate") : t("nobodyOnPayroll")}
              </p>
            )}
            {pay.lines.map((l) => {
              const off = skip.includes(l.userId);
              // Only worth spelling out when something actually changed it.
              const parts = ([["overtime", l.overtime], ["bonus", l.bonus],
                              ["advance", l.advance], ["deduction", l.deduction],
                              ["insurance", l.insurance]] as const)
                .filter(([, v]) => (v ?? 0) > 0);
              return (
                <div key={l.userId} style={{ opacity: off ? 0.45 : 1 }}>
                  <div className="evt">
                    <span style={{ flex: 1 }}>
                      <b>{ar ? l.nameAr : l.nameEn}</b>
                      {l.role && <span className="sub">{t(l.role as any)}</span>}
                      {l.payType === "DAILY" && (
                        <span className="sub mono">
                          {num(l.daysWorked ?? 0)} {t("daysWorked")} × {num(l.dayRate ?? 0)}
                          {" = "}{num(l.baseSalary ?? 0)}
                        </span>
                      )}
                      {parts.length > 0 && (
                        <span className="sub mono">
                          {l.payType === "DAILY" ? "" : `${t("baseSalary")} ${num(l.baseSalary ?? 0)}`}
                          {parts.map(([k, v]) =>
                            ` · ${t(k as any)} ${["advance", "deduction", "insurance"].includes(k) ? "−" : "+"}${num(v ?? 0)}`)}
                        </span>
                      )}
                    </span>
                    <b className="mono">{num(l.amount)}</b>
                  </div>
                  {/* Leaving somebody out this month must not touch their
                      salary — they were away, not demoted. */}
                  {!pay.posted && (
                    <div className="row" style={{ marginBottom: 10 }}>
                      <button className="btn sec sm"
                              onClick={() => setSkip(off ? skip.filter((x) => x !== l.userId)
                                                         : [...skip, l.userId])}>
                        {off ? t("include") : t("skip")}
                      </button>
                      <button className="btn sec sm"
                              onClick={() => setEditing(editing === l.userId ? "" : l.userId)}>
                        {t("adjustPay")}
                      </button>
                    </div>
                  )}
                  {editing === l.userId && !pay.posted && (
                    <Adjust period={period} line={l} onDone={async () => { setEditing(""); await load(); }} />
                  )}
                </div>
              );
            })}
          </div>

          {!pay.posted && pay.lines.length > 0 && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("payFrom")}</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
                      style={{ marginTop: 8 }}>
                <option value="">{t("pickAccount")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{ar ? a.nameAr : a.nameEn}</option>
                ))}
              </select>
              <p className="note">{t("payrollHint")}</p>
              <button className="btn pri" style={{ marginTop: 10 }}
                      disabled={busy || !accountId || due <= 0}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const r = await api.postPayroll(period, { accountId, skip });
                          toast(`${t("saved")} · ${num(r.total)}`);
                          await load();
                        } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>
                {t("payWages")} · {num(due)}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}


/**
 * What changes about one person's pay this month.
 *
 * Kept apart from their salary, because next month starts clean: an advance
 * taken in July must not quietly repeat in August, which is exactly what
 * happens when the only place to put it is the wage itself.
 */
function Adjust({ period, line, onDone }: { period: string; line: any; onDone: () => void }) {
  const { t, toast } = useApp();
  const [f, setF] = useState({
    overtime: String(line.overtime ?? 0), bonus: String(line.bonus ?? 0),
    advance: String(line.advance ?? 0), deduction: String(line.deduction ?? 0),
    insurance: String(line.insurance ?? 0),
  });
  const [busy, setBusy] = useState(false);
  const n = (v: string) => Number(v) || 0;
  const net = Math.max(0, (line.baseSalary ?? 0) + n(f.overtime) + n(f.bonus)
                          - n(f.advance) - n(f.deduction) - n(f.insurance));

  const field = (k: keyof typeof f) => (
    <span style={{ flex: 1 }}>
      <span className="k">{t(k as any)}</span>
      <input className="mono" inputMode="decimal" value={f[k]}
             onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ marginTop: 4 }} />
    </span>
  );

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <div className="row">{field("overtime")}{field("bonus")}</div>
      <div className="row" style={{ marginTop: 8 }}>{field("advance")}{field("deduction")}</div>
      <div className="row" style={{ marginTop: 8 }}>{field("insurance")}</div>
      <div className="evt" style={{ marginTop: 10 }}>
        <span style={{ flex: 1 }}><b>{t("netPay")}</b></span>
        <b className="mono">{net.toLocaleString()}</b>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onDone}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.savePayrollAdjustment(period, line.userId, {
                      overtime: n(f.overtime), bonus: n(f.bonus), advance: n(f.advance),
                      deduction: n(f.deduction), insurance: n(f.insurance),
                    });
                    toast(t("saved"));
                    onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
