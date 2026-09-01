import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type CashAccount, type LocationRow, type Report } from "../api";

type Tab = "cashbox" | "sales" | "purchases" | "collections" | "receivables" | "profit" | "vat";
const TABS: Tab[] = ["cashbox", "sales", "purchases", "collections", "receivables", "profit", "vat"];

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
      <div className="tabs">
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
      {tab === "cashbox" && <CashBoxDesk onDone={load} />}

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
                  <b className="mono" style={{ color: a.closing < 0 ? "var(--bad)" : undefined }}>
                    {num(a.closing)}
                  </b>
                </div>
              ))}
              {r.accounts.some((a) => a.closing < 0) && <p className="note">{t("negativeBalance")}</p>}
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
  // The printed copy is one tap from the row it belongs to, which is where
  // somebody standing at the counter actually wants it.
  const doc = (to: string, label: string) => (
    <Link to={to} className="chip" style={{ marginInlineEnd: 7 }}>{label}</Link>
  );

  if (tab === "sales" || tab === "receivables") {
    return (
      <span style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {doc(`/invoice/${row.id}`, t("invoice"))}
        {owes && (
          <button className="btn pri sm" onClick={() => onPick({ kind: "collect", row })}>
            {t("act_collect")}
          </button>
        )}
      </span>
    );
  }
  if (tab === "purchases") {
    return (
      <span style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {doc(`/purchase/${row.id}`, t("invoice"))}
        {owes && (
          <button className="btn pri sm" onClick={() => onPick({ kind: "pay", row })}>
            {t("act_pay")}
          </button>
        )}
      </span>
    );
  }
  if (tab === "collections" || tab === "cashbox") {
    return (
      <span style={{ display: "flex", alignItems: "center", whiteSpace: "nowrap" }}>
        {/* A transfer is a movement, not something anybody signs for. */}
        {row.category !== "TRANSFER" && doc(`/voucher/${row.id}`, t("voucher"))}
        {/* A reversal cannot itself be reversed, so it is not offered one. */}
        {!row.reversal && (
          <button className="btn sec sm" onClick={() => onPick({ kind: "reverse", row })}>
            {t("act_reverse")}
          </button>
        )}
      </span>
    );
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
  const nav = useNavigate();
  const due = Number(row.outstanding ?? 0);
  // Pre-filled with the full amount because settling in full is the common
  // case; a part payment is one edit away.
  const [f, setF] = useState({ accountId: "", amount: String(due), discount: "",
                              method: "CASH", reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const settles = (Number(f.amount) || 0) + (Number(f.discount) || 0);

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <PanelHead title={t("collectFor")} subtitle={`${row.customer ?? ""} · ${row.code ?? ""}`} due={due} />
      <AccountPicker value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      {/* Money written off to close the balance. Without it the difference
          sits for ever as a debt nobody intends to chase. */}
      <input className="mono" inputMode="decimal" placeholder={t("settlementDiscount")}
             value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })}
             style={{ marginTop: 8 }} />
      <MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} />
      <input placeholder={t("reference")} value={f.reference}
             onChange={(e) => setF({ ...f, reference: e.target.value })} style={{ marginTop: 8 }} />
      <input placeholder={t("note")} value={f.note}
             onChange={(e) => setF({ ...f, note: e.target.value })} style={{ marginTop: 8 }} />
      <p className="note">
        {t("prefillHint")}
        {Number(f.discount) > 0 && ` · ${t("totalSettled")} ${settles.toLocaleString()}`}
      </p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !f.accountId || !(Number(f.amount) > 0) || settles > due + 0.005}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.collect({ orderId: row.id, accountId: f.accountId,
                                        amount: Number(f.amount),
                                        discount: Number(f.discount) || 0, method: f.method,
                                        reference: f.reference.trim() || undefined,
                                        note: f.note.trim() || undefined });
                    toast(t("collected"));
                    // Straight to the slip the customer signs.
                    nav(`/voucher/${r.id}`);
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
  const nav = useNavigate();
  const due = Number(row.outstanding ?? 0);
  const [f, setF] = useState({ accountId: "", amount: String(due), discount: "",
                              method: "CASH", reference: "", note: "" });
  const [busy, setBusy] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <PanelHead title={t("payFor")} subtitle={`${row.supplier ?? ""} · ${row.number ?? ""}`} due={due} />
      <AccountPicker value={f.accountId} onChange={(v) => setF({ ...f, accountId: v })} />
      <input className="mono" inputMode="decimal" placeholder={t("amount")} value={f.amount}
             onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("settlementDiscount")}
             value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })}
             style={{ marginTop: 8 }} />
      <MethodPicker value={f.method} onChange={(v) => setF({ ...f, method: v })} />
      <input placeholder={t("reference")} value={f.reference}
             onChange={(e) => setF({ ...f, reference: e.target.value })} style={{ marginTop: 8 }} />
      <input placeholder={t("note")} value={f.note}
             onChange={(e) => setF({ ...f, note: e.target.value })} style={{ marginTop: 8 }} />
      <p className="note">{t("prefillHint")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={onClose}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !f.accountId || !(Number(f.amount) > 0)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    // Category MATERIALS: a supplier bill is what the factory
                    // buys. It is on the expense form if it was something else.
                    const r = await api.spend({ accountId: f.accountId, amount: Number(f.amount),
                                      discount: Number(f.discount) || 0,
                                      method: f.method, category: "MATERIALS",
                                      purchaseInvoiceId: row.id,
                                      reference: f.reference.trim() || undefined,
                                      note: f.note.trim() || undefined });
                    toast(t("saved"));
                    nav(`/voucher/${r.id}`);
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
type PLine = { description: string; qty: string; unitPrice: string; discount: string };
const BLANK_LINE: PLine = { description: "", qty: "1", unitPrice: "", discount: "" };
const BLANK_INVOICE = () => ({
  supplierId: "", number: "", issuedOn: iso(new Date()), warehouseId: "",
  amount: "", discount: "", taxRate: "", note: "", lines: [{ ...BLANK_LINE }],
});

function PurchaseDesk({ onDone }: { onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [open, setOpen] = useState<"" | "supplier" | "invoice">("");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [sup, setSup] = useState({ name: "", phone: "" });
  const [inv, setInv] = useState(BLANK_INVOICE());
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<PLine>) =>
    setInv((v) => ({ ...v, lines: v.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  const refresh = () => api.suppliers().then(setSuppliers).catch(() => setSuppliers([]));
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    api.locations().then((ls) => setStores(ls.filter((l) => l.type !== "FACTORY")))
      .catch(() => setStores([]));
  }, []);

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

  const lineTotal = (l: PLine) =>
    (Number(l.unitPrice) || 0) * (Number(l.qty) || 0) - (Number(l.discount) || 0);
  const fromLines = inv.lines.reduce((s, l) => s + lineTotal(l), 0);
  const hasLines = inv.lines.some((l) => l.description.trim() && Number(l.unitPrice) > 0);
  const net = (hasLines ? fromLines : Number(inv.amount) || 0) - (Number(inv.discount) || 0);
  const tax = Math.round(net * ((Number(inv.taxRate) || 0) / 100) * 100) / 100;

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
      <select value={inv.warehouseId} onChange={(e) => setInv({ ...inv, warehouseId: e.target.value })}
              style={{ marginTop: 8 }}>
        <option value="">{t("noWarehouse")}</option>
        {stores.map((w) => (
          <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>
        ))}
      </select>

      {/* Half the bills a factory receives are a handwritten total, so lines
          are offered rather than demanded. */}
      <span className="k" style={{ marginTop: 14, display: "block" }}>{t("purchaseLines")}</span>
      {inv.lines.map((l, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div className="between">
            <input placeholder={t("lineDescription")} value={l.description}
                   onChange={(e) => setLine(i, { description: e.target.value })} style={{ flex: 1 }} />
            {inv.lines.length > 1 && (
              <button className="chip" style={{ marginInlineStart: 7 }}
                      onClick={() => setInv({ ...inv, lines: inv.lines.filter((_, k) => k !== i) })}>
                {t("remove")}
              </button>
            )}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="mono" inputMode="decimal" placeholder={t("qty")} value={l.qty}
                   onChange={(e) => setLine(i, { qty: e.target.value })} style={{ flex: 1 }} />
            <input className="mono" inputMode="decimal" placeholder={t("unitPrice")} value={l.unitPrice}
                   onChange={(e) => setLine(i, { unitPrice: e.target.value })} style={{ flex: 1.2 }} />
            <input className="mono" inputMode="decimal" placeholder={t("discount")} value={l.discount}
                   onChange={(e) => setLine(i, { discount: e.target.value })} style={{ flex: 1 }} />
          </div>
        </div>
      ))}
      <button className="btn sec sm" style={{ marginTop: 8 }}
              onClick={() => setInv({ ...inv, lines: [...inv.lines, { ...BLANK_LINE }] })}>
        {t("addLine")}
      </button>

      {!hasLines && (
        <input className="mono" inputMode="decimal" placeholder={t("amountOnly")} value={inv.amount}
               onChange={(e) => setInv({ ...inv, amount: e.target.value })} style={{ marginTop: 8 }} />
      )}
      <input className="mono" inputMode="decimal" placeholder={t("invoiceDiscount")} value={inv.discount}
             onChange={(e) => setInv({ ...inv, discount: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("purchaseTaxRate")} value={inv.taxRate}
             onChange={(e) => setInv({ ...inv, taxRate: e.target.value })} style={{ marginTop: 8 }} />
      <input placeholder={t("note")} value={inv.note}
             onChange={(e) => setInv({ ...inv, note: e.target.value })} style={{ marginTop: 8 }} />

      {net > 0 && (
        <p className="note">
          {t("subtotal")} {net.toLocaleString()}
          {tax > 0 && ` · ${t("vat")} ${tax.toLocaleString()}`}
          {` · ${t("grandTotal")} ${(net + tax).toLocaleString()}`}
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !inv.supplierId || !inv.number.trim() || net <= 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addPurchase({
                      supplierId: inv.supplierId, number: inv.number.trim(),
                      // The date input gives a day; the API wants an instant.
                      issuedOn: new Date(`${inv.issuedOn}T12:00:00`).toISOString(),
                      warehouseId: inv.warehouseId || undefined,
                      taxRate: Number(inv.taxRate) || 0,
                      discount: Number(inv.discount) || 0,
                      note: inv.note.trim() || undefined,
                      ...(hasLines
                        ? { lines: inv.lines
                              .filter((l) => l.description.trim() && Number(l.unitPrice) > 0)
                              .map((l) => ({
                                description: l.description.trim(),
                                qty: Number(l.qty) || 1,
                                unitPrice: Number(l.unitPrice),
                                discount: Number(l.discount) || 0,
                                warehouseId: inv.warehouseId || undefined,
                              })) }
                        : { amount: Number(inv.amount) }),
                    });
                    toast(t("addedInvoice"));
                    setInv(BLANK_INVOICE());
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

/**
 * Putting money into the drawer, moving it between drawers, and saying what was
 * in it to begin with.
 *
 * A cash box that can only be filled by customers paying invoices is a cash box
 * that is always wrong: the owner puts money in, the bank takes it, a supplier
 * refunds. Each of those is a real movement and the books have to hold it.
 */
function CashBoxDesk({ onDone }: { onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [open, setOpen] = useState<"" | "in" | "move" | "opening">("");
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [inn, setIn] = useState({ accountId: "", amount: "", category: "CAPITAL", method: "CASH", note: "" });
  const [mv, setMv] = useState({ fromAccountId: "", toAccountId: "", amount: "", note: "" });
  const [op, setOp] = useState({ accountId: "", openingBalance: "" });
  const [busy, setBusy] = useState(false);

  const refresh = () => api.cashAccounts().then(setAccounts).catch(() => setAccounts([]));
  useEffect(() => { refresh(); }, []);
  const after = () => { setOpen(""); setBusy(false); refresh(); onDone(); };
  const fail = (e: any) => { toast(e?.code ? t(e.code) : t("signInFailed")); setBusy(false); };
  const opts = accounts.map((a) => (
    <option key={a.id} value={a.id}>{ar ? a.nameAr : a.nameEn}</option>
  ));

  if (!open) {
    return (
      <div className="tabs" style={{ marginBottom: 11 }}>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }} onClick={() => setOpen("in")}>
          {t("cashIn")}
        </button>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }} onClick={() => setOpen("move")}>
          {t("transfer")}
        </button>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }} onClick={() => setOpen("opening")}>
          {t("openingBalance")}
        </button>
      </div>
    );
  }

  if (open === "in") {
    return (
      <div className="card" style={{ marginBottom: 11 }}>
        <span className="k">{t("cashIn")}</span>
        <select value={inn.accountId} onChange={(e) => setIn({ ...inn, accountId: e.target.value })}
                style={{ marginTop: 8 }}>
          <option value="">{t("pickAccount")}</option>{opts}
        </select>
        <input className="mono" inputMode="decimal" placeholder={t("amount")} value={inn.amount}
               onChange={(e) => setIn({ ...inn, amount: e.target.value })} style={{ marginTop: 8 }} />
        <select value={inn.category} onChange={(e) => setIn({ ...inn, category: e.target.value })}
                style={{ marginTop: 8 }}>
          {["CAPITAL", "REFUND", "OTHER_INCOME"].map((c) => (
            <option key={c} value={c}>{t(`cat_${c}` as any)}</option>
          ))}
        </select>
        <MethodPicker value={inn.method} onChange={(v) => setIn({ ...inn, method: v })} />
        <input placeholder={t("note")} value={inn.note}
               onChange={(e) => setIn({ ...inn, note: e.target.value })} style={{ marginTop: 8 }} />
        <p className="note">{t("cashInHint")}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
          <button className="btn pri sm" disabled={busy || !inn.accountId || !(Number(inn.amount) > 0)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.receive({ accountId: inn.accountId, amount: Number(inn.amount),
                                          category: inn.category, method: inn.method,
                                          note: inn.note.trim() || undefined });
                      toast(t("saved"));
                      setIn({ accountId: "", amount: "", category: "CAPITAL", method: "CASH", note: "" });
                      after();
                    } catch (e) { fail(e); }
                  }}>{t("save")}</button>
        </div>
      </div>
    );
  }

  if (open === "move") {
    return (
      <div className="card" style={{ marginBottom: 11 }}>
        <span className="k">{t("transfer")}</span>
        <select value={mv.fromAccountId} onChange={(e) => setMv({ ...mv, fromAccountId: e.target.value })}
                style={{ marginTop: 8 }}>
          <option value="">{t("transferFrom")}</option>{opts}
        </select>
        <select value={mv.toAccountId} onChange={(e) => setMv({ ...mv, toAccountId: e.target.value })}
                style={{ marginTop: 8 }}>
          <option value="">{t("transferTo")}</option>{opts}
        </select>
        <input className="mono" inputMode="decimal" placeholder={t("amount")} value={mv.amount}
               onChange={(e) => setMv({ ...mv, amount: e.target.value })} style={{ marginTop: 8 }} />
        <input placeholder={t("note")} value={mv.note}
               onChange={(e) => setMv({ ...mv, note: e.target.value })} style={{ marginTop: 8 }} />
        <p className="note">{t("transferHint")}</p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
          <button className="btn pri sm"
                  disabled={busy || !mv.fromAccountId || !mv.toAccountId
                            || mv.fromAccountId === mv.toAccountId || !(Number(mv.amount) > 0)}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api.transfer({ fromAccountId: mv.fromAccountId, toAccountId: mv.toAccountId,
                                           amount: Number(mv.amount), note: mv.note.trim() || undefined });
                      toast(t("saved"));
                      setMv({ fromAccountId: "", toAccountId: "", amount: "", note: "" });
                      after();
                    } catch (e) { fail(e); }
                  }}>{t("save")}</button>
        </div>
      </div>
    );
  }

  const picked = accounts.find((a) => a.id === op.accountId);
  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("openingBalance")}</span>
      <select value={op.accountId}
              onChange={(e) => {
                const a = accounts.find((x) => x.id === e.target.value);
                setOp({ accountId: e.target.value, openingBalance: a ? String(a.openingBalance) : "" });
              }}
              style={{ marginTop: 8 }}>
        <option value="">{t("pickAccount")}</option>{opts}
      </select>
      <input className="mono" inputMode="decimal" placeholder={t("openingBalance")}
             value={op.openingBalance}
             onChange={(e) => setOp({ ...op, openingBalance: e.target.value })}
             style={{ marginTop: 8 }} />
      <p className="note">{t("openingHint")}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !picked || !Number.isFinite(Number(op.openingBalance))
                          || op.openingBalance === ""}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.patchCashAccount(op.accountId,
                      { openingBalance: Number(op.openingBalance) });
                    toast(t("saved"));
                    setOp({ accountId: "", openingBalance: "" });
                    after();
                  } catch (e) { fail(e); }
                }}>{t("save")}</button>
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
