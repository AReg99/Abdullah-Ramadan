import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type CashAccount, type OrderDetail as OD } from "../api";

export default function OrderDetail() {
  const { id = "" } = useParams();
  const { t, lang, me, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [d, setD] = useState<OD | null>(null);
  useEffect(() => { api.order(id).then(setD).catch(() => {}); }, [id]);
  if (!d) return <div className="empty">{t("loading")}</div>;
  const when = (s: string) => new Date(s).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB",
    { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <>
      <div className="card">
        <div className="between">
          <b className="mono" style={{ fontSize: "1.1rem" }}>{d.code}</b>
          <span className="pill pri">{d.status}</span>
        </div>
        <dl className="spec" style={{ marginTop: 11 }}>
          <dt>{t("customer")}</dt><dd>{d.customer.name}</dd>
          {d.total !== undefined && (
            <><dt>{t("total")}</dt><dd className="mono">{d.total.toLocaleString()} EGP</dd></>
          )}
          {d.promisedDate && <><dt>{t("due")}</dt><dd>{when(d.promisedDate)}</dd></>}
        </dl>
        <Link to={`/track/${d.id}`} className="btn sec sm"
              style={{ marginTop: 12, textDecoration: "none" }}>
          {t("track")}
        </Link>
        {/* Only the owner, and never on an order that is already closed. */}
        {me?.role === "OWNER" && d.status !== "CANCELLED" && d.status !== "DELIVERED" && (
          <button className="btn dang sm" style={{ marginTop: 8 }} disabled={busy}
            onClick={async () => {
              const reason = prompt(`${t("cancelOrder")}\n\n${t("cancelWhy")}`);
              if (!reason || reason.trim().length < 3) return;
              if (!confirm(`${t("confirmCancel")}\n\n${d.code} · ${d.customer.name}\n\n${t("cancelHint")}`)) return;
              setBusy(true);
              try {
                const r = await api.cancelOrder(d.id, reason.trim());
                toast(`${t("orderCancelled")} · ${r.cancelled}`);
                setD(await api.order(d.id));
              } catch (e: any) {
                toast(e?.code ? t(e.code) : t("signInFailed"));
              } finally { setBusy(false); }
            }}>
            {t("cancelOrder")}
          </button>
        )}
      </div>

      {d.total !== undefined && d.status !== "CANCELLED" && (
        <Collect order={d} onDone={async () => setD(await api.order(d.id))} />
      )}

      {d.lines.map((l) => (
        <div className="card" key={l.id}>
          <div className="between">
            <b>{lang === "ar" ? l.productAr : l.productEn}</b>
            <span className="pill">{l.status}</span>
          </div>
          {l.workOrders.map((w) => (
            <div key={w.code} style={{ marginTop: 10 }}>
              <span className="k mono">{w.code}</span>
              <div style={{ marginTop: 6 }}>
                {w.stages.map((st) => (
                  <div key={st.seq} className="stage-row">
                    <span className={`dot${st.status === "DONE" ? " done" : st.status === "IN_PROGRESS" ? " now" : st.status === "PAUSED" ? " blocked" : ""}`} />
                    <span style={{ flex: 1 }}>{lang === "ar" ? st.nameAr : st.nameEn}</span>
                    {st.status === "DONE" && (
                      <span className="mono muted">{st.actualMinutes}/{st.stdMinutes} {t("min")}</span>
                    )}
                    {st.photos.length > 0 && (
                      <span style={{ display: "flex", gap: 4 }}>
                        {st.photos.map((p, i) => (
                          <img key={i} src={`/uploads/${p.path}`} alt=""
                            style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 5, border: "1px solid var(--g3)" }} />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {d.attachments?.length > 0 && (
        <div className="card">
          <span className="k">{t("attachments")}</span>
          <div className="crew" style={{ marginTop: 9, gap: 9 }}>
            {d.attachments.map((a) => (
              // Opened in a new tab rather than downloaded: on a phone that is
              // what actually shows a drawing or a PDF to the person holding it.
              <a key={a.id} href={`/uploads/${a.path}`} target="_blank" rel="noreferrer"
                 style={{ textDecoration: "none", color: "inherit" }}>
                {a.kind === "IMAGE" ? (
                  <img src={`/uploads/${a.path}`} alt={a.filename}
                       style={{ width: 92, height: 92, objectFit: "cover",
                                borderRadius: "var(--rs)", border: "1px solid var(--g3)" }} />
                ) : (
                  <span className="crewchip on" style={{ height: 92, width: 92, display: "flex",
                        alignItems: "center", justifyContent: "center", textAlign: "center",
                        padding: 6, fontSize: ".72rem" }}>
                    PDF<br />{a.filename.slice(0, 18)}
                  </span>
                )}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <span className="k">{t("timeline")}</span>
        <div style={{ marginTop: 8 }}>
          {d.events.map((e) => (
            <div key={e.id} className="evt">
              <span className="t">{when(e.occurredAt)}</span>
              <span>
                {t(e.code as any)}
                {e.actor && <span className="muted"> · {lang === "ar" ? e.actor.nameAr : e.actor.nameEn}</span>}
                {e.payload?.reason && <span className="muted"> · {t(e.payload.reason)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Taking money at the counter. The showroom does this where the sale happens —
 * a deposit is collected by whoever is standing with the customer, not by
 * whoever keeps the books.
 */
function Collect({ order, onDone }: { order: OD; onDone: () => void }) {
  const { t, lang, me, toast } = useApp();
  const ar = lang === "ar";
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ accountId: "", amount: "", method: "CASH", reference: "" });
  const [busy, setBusy] = useState(false);

  const mayCollect = ["OWNER", "ACCOUNTANT", "SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "");
  useEffect(() => {
    if (mayCollect) api.cashAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, [mayCollect]);
  if (!mayCollect) return null;

  const total = order.total ?? 0;
  const paid = order.paidTotal ?? 0;
  const outstanding = Math.max(0, total - paid);
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });

  return (
    <div className="card">
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="k">{t("paidSoFar")}</span>
          <div><b className="mono">{num(paid)}</b> <span className="muted mono">/ {num(total)}</span></div>
        </span>
        <span style={{ textAlign: "end" }}>
          <span className="k">{t("outstanding")}</span>
          <div><b className="mono" style={{ color: outstanding > 0 ? "var(--warn)" : "var(--ok)" }}>
            {num(outstanding)}
          </b></div>
        </span>
      </div>

      {outstanding > 0 && !open && (
        <button className="btn pri sm" style={{ marginTop: 11 }} onClick={() => setOpen(true)}>
          {t("collect")}
        </button>
      )}

      {open && (
        <>
          <select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}
                  style={{ marginTop: 10 }}>
            <option value="">{t("pickAccount")}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{ar ? a.nameAr : a.nameEn}</option>)}
          </select>
          <input className="mono" inputMode="decimal" placeholder={num(outstanding)} value={f.amount}
                 onChange={(e) => setF({ ...f, amount: e.target.value })} style={{ marginTop: 8 }} />
          <select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}
                  style={{ marginTop: 8 }}>
            {["CASH","BANK_TRANSFER","INSTAPAY","CHEQUE","CARD"]
              .map((m) => <option key={m} value={m}>{t(m as any)}</option>)}
          </select>
          <input placeholder={t("reference")} value={f.reference}
                 onChange={(e) => setF({ ...f, reference: e.target.value })} style={{ marginTop: 8 }} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
            <button className="btn pri sm"
                    disabled={busy || !f.accountId || !(Number(f.amount) > 0)}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const r = await api.collect({
                          orderId: order.id, accountId: f.accountId,
                          amount: Number(f.amount), method: f.method,
                          reference: f.reference.trim() || undefined });
                        toast(`${t("collected")} · ${t("outstanding")} ${num(r.outstanding)}`);
                        setF({ accountId: "", amount: "", method: "CASH", reference: "" });
                        setOpen(false);
                        onDone();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                      finally { setBusy(false); }
                    }}>
              {t("save")}
            </button>
          </div>
          <p className="note">{t("collectHint")}</p>
        </>
      )}
    </div>
  );
}
