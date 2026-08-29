import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type CashAccount, type Report } from "../api";

type Tab = "cashbox" | "sales" | "purchases" | "collections" | "receivables";
const TABS: Tab[] = ["cashbox", "sales", "purchases", "collections", "receivables"];

type Row = Record<string, any>;
/** What can be done to the row in front of you, if anything. */
type Act = { kind: "collect" | "pay" | "reverse"; row: Row };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The books.
 *
 * Five reports over one ledger, each with the same shape: a few totals a person
 * can read at a glance, then the rows behind them, then the same thing as a
 * spreadsheet. Receivables has no date range — money owed is owed today,
 * whatever window you were looking at.
 *
 * The work happens on the rows. Chasing a debt, taking the payment and seeing it
 * land are one motion here rather than three screens, because that is how the
 * job is actually done: you look at who owes, you ring them, you write it down.
 */
export default function Money() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [tab, setTab] = useState<Tab>("cashbox");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [act, setAct] = useState<Act | null>(null);

  const dated = tab !== "receivables";

  const load = async () => {
    setLoading(true);
    try { setR(await api.report(tab, dated ? from : undefined, dated ? to : undefined)); }
    catch { toast(t("signInFailed")); setR(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [tab, from, to]);
  // A panel left open over a table it no longer belongs to is how the wrong
  // order gets the payment.
  useEffect(() => { setAct(null); }, [tab]);

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });

  const done = async () => { setAct(null); await load(); };

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

      {act?.kind === "collect" && <CollectPanel row={act.row} onDone={done} onClose={() => setAct(null)} />}
      {act?.kind === "pay" && <PayPanel row={act.row} onDone={done} onClose={() => setAct(null)} />}
      {act?.kind === "reverse" && <ReversePanel row={act.row} onDone={done} onClose={() => setAct(null)} />}

      {tab === "purchases" && <PurchaseDesk onDone={load} />}

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
                  <tr>
                    {Object.keys(r.rows[0] ?? {}).filter((c) => c !== "id")
                      .map((c) => <th key={c}>{t(`col_${c}` as any)}</th>)}
                    {r.rows.length > 0 && <th />}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={row.id ?? i}>
                      {Object.keys(r.rows[0]).filter((c) => c !== "id").map((c) => (
                        <td key={c} className={typeof row[c] === "number" ? "mono num" : undefined}>
                          {render(row[c], c, ar, t)}
                        </td>
                      ))}
                      <td><RowAction tab={tab} row={row} onPick={setAct} /></td>
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

/**
 * The one thing this row lets you do. A row that owes money can be collected
 * against; a bill that is not settled can be paid; an entry that is already on
 * the record can only be reversed. Anything else gets no button, which is the
 * point — a button that does nothing is worse than no button.
 */
function RowAction({ tab, row, onPick }: { tab: Tab; row: Row; onPick: (a: Act) => void }) {
  const { t } = useApp();
  const owes = Number(row.outstanding ?? 0) > 0.005;

  if ((tab === "receivables" || tab === "sales") && owes) {
    return <button className="btn pri sm" onClick={() => onPick({ kind: "collect", row })}>
      {t("act_collect")}
    </button>;
  }
  if (tab === "purchases" && owes) {
    return <button className="btn pri sm" onClick={() => onPick({ kind: "pay", row })}>
      {t("act_pay")}
    </button>;
  }
  // A reversal cannot itself be reversed, so it is not offered one.
  if ((tab === "collections" || tab === "cashbox") && !row.reversal) {
    return <button className="btn sec sm" onClick={() => onPick({ kind: "reverse", row })}>
      {t("act_reverse")}
    </button>;
  }
  return null;
}

/** The account picker, which every one of these panels needs. */
function useAccounts() {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const refresh = () => api.cashAccounts().then(setAccounts).catch(() => setAccounts([]));
  useEffect(() => { refresh(); }, []);
  return accounts;
}

function AccountPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t, lang } = useApp();
  const accounts = useAccounts();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 8 }}>
      <option value="">{t("pickAccount")}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{lang === "ar" ? a.nameAr : a.nameEn}</option>
      ))}
    </select>
  );
}

const METHODS = ["CASH", "BANK_TRANSFER", "INSTAPAY", "CHEQUE", "CARD"];

function MethodPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useApp();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 8 }}>
      {METHODS.map((m) => <option key={m} value={m}>{t(m as any)}</option>)}
    </select>
  );
}

function PanelHead({ title, subtitle, due }: { title: string; subtitle?: string; due?: number }) {
  const { t, lang } = useApp();
  return (
    <div className="between">
      <span style={{ flex: 1 }}>
        <span className="k">{title}</span>
        {subtitle && <div><b>{subtitle}</b></div>}
      </span>
      {due !== undefined && (
        <span style={{ textAlign: "end" }}>
          <span className="k">{t("amountDue")}</span>
          <div><b className="mono">
            {due.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 })}
          </b></div>
        </span>
      )}
    </div>
  );
}

/** Money in, against an order that still owes. */
function CollectPanel({ row, onDone, onClose }: { row: Row; onDone: () => void; onClose: () => void }) {
  const { t, toast } = useApp();
  const due = Number(row.outstanding ?? 0);
  // Pre-filled with the full amount because settling in full is the common
  // case; a part payment is one edit away.
  const [f, setF] = useState({ accountId: "", amount: String(due), method: "CASH", reference: "" });
  const [busy, setBusy] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <PanelHead title={t("collectFor")} subtitle={`${row.customer ?? ""} · ${row.code ?? ""}`} due={due} />
      <AccountPicker value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      <MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} />
      <input placeholder={t("reference")} value={f.reference}
             onChange={(e) => setF({ ...f, reference: e.target.value })} style={{ marginTop: 8 }} />
      <p className="note">{t("prefillHint")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !f.accountId || !(Number(f.amount) > 0)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.collect({ orderId: row.id, accountId: f.accountId,
                                        amount: Number(f.amount), method: f.method,
                                        reference: f.reference.trim() || undefined });
                    toast(t("collected"));
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

/** Money out, against a supplier's bill. */
function PayPanel({ row, onDone, onClose }: { row: Row; onDone: () => void; onClose: () => void }) {
  const { t, toast } = useApp();
  const due = Number(row.outstanding ?? 0);
  const [f, setF] = useState({ accountId: "", amount: String(due), method: "CASH", reference: "" });
  const [busy, setBusy] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <PanelHead title={t("payFor")} subtitle={`${row.supplier ?? ""} · ${row.number ?? ""}`} due={due} />
      <AccountPicker value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      <MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} />
      <input placeholder={t("reference")} value={f.reference}
             onChange={(e) => setF({ ...f, reference: e.target.value })} style={{ marginTop: 8 }} />
      <p className="note">{t("prefillHint")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !f.accountId || !(Number(f.amount) > 0)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    // Category MATERIALS: a supplier bill is what the factory
                    // buys. It is on the expense form if it was something else.
                    await api.spend({ accountId: f.accountId, amount: Number(f.amount),
                                      method: f.method, category: "MATERIALS",
                                      purchaseInvoiceId: row.id,
                                      reference: f.reference.trim() || undefined });
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

/** Undo, the only way the books allow it. */
function ReversePanel({ row, onDone, onClose }: { row: Row; onDone: () => void; onClose: () => void }) {
  const { t, toast } = useApp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const what = [row.customer, row.orderCode, row.party, row.account].filter(Boolean).join(" · ");

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <PanelHead title={t("reverseEntry")} subtitle={what} due={Number(row.amount ?? 0)} />
      <input placeholder={t("reverseWhy")} value={reason}
             onChange={(e) => setReason(e.target.value)} style={{ marginTop: 8 }} />
      <p className="note">{t("reverseHint")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || reason.trim().length < 3}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.reverseEntry(row.id, reason.trim());
                    toast(t("reversed"));
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

/**
 * Suppliers and their bills. Shown on the purchases tab only, where a person
 * looking at what is owed to suppliers is the person about to record another
 * one.
 */
function PurchaseDesk({ onDone }: { onDone: () => void }) {
  const { t, toast } = useApp();
  const [open, setOpen] = useState<"" | "supplier" | "invoice">("");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [sup, setSup] = useState({ name: "", phone: "" });
  const [inv, setInv] = useState({ supplierId: "", number: "", issuedOn: iso(new Date()), amount: "", note: "" });
  const [busy, setBusy] = useState(false);

  const refresh = () => api.suppliers().then(setSuppliers).catch(() => setSuppliers([]));
  useEffect(() => { refresh(); }, []);

  if (!open) {
    return (
      <div className="row" style={{ marginBottom: 11 }}>
        <button className="btn sec sm" onClick={() => setOpen("supplier")}>{t("newSupplier")}</button>
        <button className="btn sec sm" onClick={() => setOpen("invoice")}>{t("newPurchase")}</button>
      </div>
    );
  }

  if (open === "supplier") {
    return (
      <div className="card" style={{ marginBottom: 11 }}>
        <span className="k">{t("newSupplier")}</span>
        <input placeholder={t("supplierName")} value={sup.name}
               onChange={(e) => setSup({ ...sup, name: e.target.value })} style={{ marginTop: 8 }} />
        <input inputMode="tel" placeholder={t("supplierPhone")} value={sup.phone}
               onChange={(e) => setSup({ ...sup, phone: e.target.value })} style={{ marginTop: 8 }} />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
          <button className="btn pri sm" disabled={busy || !sup.name.trim()}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.addSupplier({ name: sup.name.trim(), phone: sup.phone.trim() || undefined });
                      toast(t("addedSupplier"));
                      setSup({ name: "", phone: "" });
                      setOpen("");
                      refresh();
                    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>
            {t("save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("newPurchase")}</span>
      {suppliers.length === 0 ? (
        <p className="note">{t("noSuppliers")}</p>
      ) : (
        <select value={inv.supplierId} onChange={(e) => setInv({ ...inv, supplierId: e.target.value })}
                style={{ marginTop: 8 }}>
          <option value="">{t("pickSupplier")}</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <input placeholder={t("invoiceNumber")} value={inv.number}
             onChange={(e) => setInv({ ...inv, number: e.target.value })} style={{ marginTop: 8 }} />
      <input type="date" value={inv.issuedOn}
             onChange={(e) => setInv({ ...inv, issuedOn: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={inv.amount}
             onChange={(e) => setInv({ ...inv, amount: e.target.value })} style={{ marginTop: 8 }} />
      <input placeholder={t("note")} value={inv.note}
             onChange={(e) => setInv({ ...inv, note: e.target.value })} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !inv.supplierId || !inv.number.trim() || !(Number(inv.amount) > 0)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addPurchase({
                      supplierId: inv.supplierId, number: inv.number.trim(),
                      // The date input gives a day; the API wants an instant.
                      issuedOn: new Date(`${inv.issuedOn}T12:00:00`).toISOString(),
                      amount: Number(inv.amount), note: inv.note.trim() || undefined,
                    });
                    toast(t("addedInvoice"));
                    setInv({ supplierId: "", number: "", issuedOn: iso(new Date()), amount: "", note: "" });
                    setOpen("");
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
  const { t, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ accountId: "", amount: "", category: "OTHER", method: "CASH", note: "" });
  const [busy, setBusy] = useState(false);

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
      <AccountPicker value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}
              style={{ marginTop: 8 }}>
        {["MATERIALS","SALARIES","RENT","UTILITIES","TRANSPORT","MAINTENANCE","MARKETING","OTHER"]
          .map((c) => <option key={c} value={c}>{t(`cat_${c}` as any)}</option>)}
      </select>
      <MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} />
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
