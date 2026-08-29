import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type CashAccount, type Report } from "../api";

type Tab = "cashbox" | "sales" | "purchases" | "collections" | "receivables";
const TABS: Tab[] = ["cashbox", "sales", "purchases", "collections", "receivables"];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The books.
 *
 * Five reports over one ledger, each with the same shape: a few totals a person
 * can read at a glance, then the rows behind them, then the same thing as a
 * spreadsheet. Receivables has no date range — money owed is owed today,
 * whatever window you were looking at.
 */
export default function Money() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [tab, setTab] = useState<Tab>("cashbox");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const dated = tab !== "receivables";

  const load = async () => {
    setLoading(true);
    try { setR(await api.report(tab, dated ? from : undefined, dated ? to : undefined)); }
    catch { toast(t("signInFailed")); setR(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tab, from, to]);

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });

  return (
    <>
      <div className="row scroll-x" style={{ marginBottom: 14 }}>
        {TABS.map((x) => (
          <button key={x} className={`btn sm ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`rep_${x}` as any)}
          </button>
        ))}
      </div>

      {dated && (
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
      )}

      {loading && <div className="empty">{t("loading")}</div>}

      {r && !loading && (
        <>
          <div className="tiles g3">
            {Object.entries(r.totals).map(([k, v]) => (
              <div className="tile" key={k}>
                <span className="k">{t(`tot_${k}` as any)}</span>
                <div className="big mono">{num(v)}</div>
              </div>
            ))}
          </div>

          {r.accounts && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("accounts")}</span>
              {r.accounts.map((a) => (
                <div className="evt" key={a.id}>
                  <span style={{ flex: 1 }}>
                    <b>{ar ? a.nameAr : a.nameEn}</b>
                    <span className="muted"> · {t(a.kind as any)}</span>
                    <span className="sub">
                      {t("tot_opening")} {num(a.opening)} · +{num(a.in)} · −{num(a.out)}
                    </span>
                  </span>
                  <b className="mono">{num(a.closing)}</b>
                </div>
              ))}
            </div>
          )}

          {r.byMethod && Object.keys(r.byMethod).length > 0 && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("byMethod")}</span>
              {Object.entries(r.byMethod).map(([m, v]) => (
                <div className="evt" key={m}>
                  <span style={{ flex: 1 }}>{t(m as any)}</span>
                  <b className="mono">{num(v)}</b>
                </div>
              ))}
            </div>
          )}

          {r.buckets && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("ageing")}</span>
              {Object.entries(r.buckets).map(([b, v]) => (
                <div className="evt" key={b}>
                  <span style={{ flex: 1 }}>{t(`age_${b}` as any)}</span>
                  <b className="mono" style={{ color: b === "d90plus" && v > 0 ? "var(--bad)" : undefined }}>
                    {num(v)}
                  </b>
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ marginTop: 11 }}>
            <div className="between">
              <span className="k">{t("rows")} · {r.rows.length}</span>
              <a className="chip" href={api.exportUrl(tab, dated ? from : undefined, dated ? to : undefined)}
                 target="_blank" rel="noreferrer">{t("exportCsv")}</a>
            </div>
            {r.rows.length === 0 && <p className="note">{t("noRows")}</p>}
            <div className="scroll-x" style={{ marginTop: 9 }}>
              <table className="tbl">
                <thead>
                  <tr>{Object.keys(r.rows[0] ?? {}).filter((c) => c !== "id")
                    .map((c) => <th key={c}>{t(`col_${c}` as any)}</th>)}</tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={row.id ?? i}>
                      {Object.keys(r.rows[0]).filter((c) => c !== "id").map((c) => (
                        <td key={c} className={typeof row[c] === "number" ? "mono num" : undefined}>
                          {render(row[c], c, ar, t)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <CashDesk onDone={load} />
    </>
  );
}

function render(v: any, col: string, ar: boolean, t: (k: any) => string) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "number") return v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short", year: "2-digit" });
  }
  // Enum-ish columns have their own words. Expense categories are namespaced,
  // because OTHER already means "another reason" on the shop floor.
  if (typeof v === "string" && /^[A-Z_]+$/.test(v)) {
    const key = col === "category" ? `cat_${v}` : v;
    const word = t(key as any);
    return word === key ? v : word;
  }
  return String(v);
}

/**
 * Money out of the drawer, and the drawer itself. Kept at the bottom of the
 * screen because it is a daily action, not a report — the accountant is here
 * anyway when they pay a bill.
 */
function CashDesk({ onDone }: { onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ accountId: "", amount: "", category: "OTHER", method: "CASH", note: "" });
  const [busy, setBusy] = useState(false);

  const refresh = () => api.cashAccounts().then(setAccounts).catch(() => setAccounts([]));
  useEffect(() => { refresh(); }, []);

  if (!open) {
    return (
      <button className="btn sec sm" style={{ marginTop: 14 }} onClick={() => setOpen(true)}>
        {t("recordSpend")}
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <span className="k">{t("recordSpend")}</span>
      <select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}
              style={{ marginTop: 8 }}>
        <option value="">{t("pickAccount")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>{ar ? a.nameAr : a.nameEn}</option>
        ))}
      </select>
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}
              style={{ marginTop: 8 }}>
        {["MATERIALS","SALARIES","RENT","UTILITIES","TRANSPORT","MAINTENANCE","MARKETING","OTHER"]
          .map((c) => <option key={c} value={c}>{t(`cat_${c}` as any)}</option>)}
      </select>
      <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}
              style={{ marginTop: 8 }}>
        {["CASH","BANK_TRANSFER","INSTAPAY","CHEQUE","CARD"]
          .map((m) => <option key={m} value={m}>{t(m as any)}</option>)}
      </select>
      <input placeholder={t("note")} value={f.note}
             onChange={(e) => setF({ ...f, note: e.target.value })} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !f.accountId || !(Number(f.amount) > 0)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.spend({ accountId: f.accountId, amount: Number(f.amount),
                                      category: f.category, method: f.method,
                                      note: f.note.trim() || undefined });
                    toast(t("saved"));
                    setF({ accountId: "", amount: "", category: "OTHER", method: "CASH", note: "" });
                    setOpen(false);
                    refresh(); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>
          {t("save")}
        </button>
      </div>
    </div>
  );
}
