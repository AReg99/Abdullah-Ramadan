import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type Approval, type PurchaseRequest } from "../api";

/**
 * الموافقات — what is waiting on somebody.
 *
 * The showroom already rings the owner when a customer pushes for more off the
 * price, and the accountant already asks before committing to a big order.
 * Nothing here replaces those calls. It records their answers, so a concession
 * has a name against it, cannot be spent twice, and the person who asked can
 * see the reply without ringing again.
 *
 * The owner reads everybody's; everybody else reads their own.
 */
export default function Approvals() {
  const { t, lang, me } = useApp();
  const ar = lang === "ar";
  const owner = me?.role === "OWNER";
  const [rows, setRows] = useState<Approval[]>([]);
  const [reqs, setReqs] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api.approvals());
      // From the owner's side a purchase request is the same question — somebody
      // is standing still until an answer comes back — so it belongs in the
      // same inbox rather than on a screen they have to remember to open.
      if (owner) setReqs((await api.purchaseRequests("SUBMITTED")).slice(0, 20));
    } catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const waiting = rows.filter((r) => r.status === "PENDING");
  const settled = rows.filter((r) => r.status !== "PENDING");

  const when = (d: string) =>
    new Date(d).toLocaleString(ar ? "ar-EG" : "en-GB",
      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  if (loading) return <div className="empty">{t("loading")}</div>;

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="k">{t("waitingOnYou")}</span>
          <div className="big mono" style={{ color: waiting.length + reqs.length ? "var(--warn)" : "var(--ok)" }}>
            {(waiting.length + reqs.length).toLocaleString(ar ? "ar-EG" : "en-GB")}
          </div>
        </div>
        <div className="tile">
          <span className="k">{t("answered")}</span>
          <div className="big mono">{settled.length.toLocaleString(ar ? "ar-EG" : "en-GB")}</div>
        </div>
      </div>

      {waiting.length === 0 && reqs.length === 0 && (
        <p className="note">{owner ? t("nothingWaiting") : t("noRequestsOfYours")}</p>
      )}

      {waiting.map((a) => (
        <Card key={a.id} a={a} owner={owner} when={when} ar={ar} onDone={load} />
      ))}

      {/* Purchase requests keep their own screen for the detail; here they are
          just the other thing waiting on the same person. */}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm mono">{r.number}</span>
              <span className="sub">{r.requestedBy ?? "—"} · {when(r.createdAt)}</span>
            </span>
            <span className="pill warn">{t("buy_requests")}</span>
          </div>
          <p className="note">
            {r.lines.map((l) => `${l.item} ${l.qty} ${l.unit}`).join(" · ")}
          </p>
          <a className="btn sec sm" href="#/purchasing" style={{ textDecoration: "none" }}
             onClick={(e) => { e.preventDefault(); location.hash = ""; location.pathname = "/purchasing"; }}>
            {t("openInPurchasing")}
          </a>
        </div>
      ))}

      {settled.length > 0 && (
        <>
          <button className="btn sec sm" style={{ margin: "14px 0" }}
                  onClick={() => setDone(!done)}>
            {done ? t("hideAnswered") : `${t("answered")} · ${settled.length}`}
          </button>
          {done && settled.map((a) => (
            <Card key={a.id} a={a} owner={owner} when={when} ar={ar} onDone={load} />
          ))}
        </>
      )}
    </>
  );
}

function Card({ a, owner, when, ar, onDone }: {
  a: Approval; owner: boolean; when: (d: string) => string; ar: boolean; onDone: () => void;
}) {
  const { t, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(String(a.amount));
  const [busy, setBusy] = useState(false);
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });

  const pill = a.status === "APPROVED" || a.status === "USED" ? "ok"
             : a.status === "REJECTED" || a.status === "EXPIRED" ? "bad" : "warn";

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      await api.decideApproval(a.id, {
        approve,
        // Haggling is the normal outcome — the owner grants less than was
        // asked far more often than they grant all of it.
        ...(approve && Number(amount) > 0 && Number(amount) < a.amount
            ? { amount: Number(amount) } : {}),
        note: note.trim() || undefined,
      });
      toast(approve ? t("approved") : t("rejected"));
      setOpen(false); onDone();
    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm mono">{a.number}</span>
          <span className="sub">{a.subject}</span>
          <span className="sub">{a.requestedBy ?? "—"} · {when(a.createdAt)}</span>
        </span>
        <span className={`pill ${pill}`}>{t(`ap_${a.status}` as any)}</span>
      </div>

      <div className="between" style={{ marginTop: 8 }}>
        <span className="k">
          {t(a.kind === "ORDER_DISCOUNT" ? "askedDiscount" : "askedOrderValue")}
        </span>
        <b className="mono" style={{ color: "var(--p)" }}>{num(a.amount)}</b>
      </div>
      <p className="note">{t("theirCeiling")} {num(a.ceiling)}</p>
      {a.reason && <p className="note">{a.reason}</p>}

      {a.decidedBy && (
        <p className="note">
          {a.status === "REJECTED" ? t("rejectedBy") : t("approvedBy")} {a.decidedBy}
          {a.decisionNote && ` — ${a.decisionNote}`}
        </p>
      )}
      {a.spentOn && <p className="note">{t("spentOn")} <span className="mono">{a.spentOn}</span></p>}
      {a.status === "APPROVED" && (
        <p className="note" style={{ color: "var(--warn)" }}>
          {t("validUntil")} {when(a.expiresAt)}
        </p>
      )}

      {owner && a.status === "PENDING" && !open && (
        <button className="btn sec sm" style={{ marginTop: 9 }}
                onClick={() => setOpen(true)}>{t("decideIt")}</button>
      )}
      {!owner && a.status === "PENDING" && (
        <button className="btn sec sm" style={{ marginTop: 9 }} disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try { await api.cancelApproval(a.id); toast(t("withdrawn")); onDone(); }
                  catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("withdraw")}</button>
      )}

      {open && (
        <>
          <span className="k" style={{ marginTop: 10, display: "block" }}>{t("grantHowMuch")}</span>
          <input className="mono" inputMode="decimal" value={amount}
                 onChange={(e) => setAmount(e.target.value)} style={{ marginTop: 6 }} />
          <p className="note">{t("grantLessHint")}</p>
          <input placeholder={t("decisionNote")} value={note}
                 onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
          <p className="note">{t("rejectNeedsReason")}</p>
          <div className="row wrap" style={{ marginTop: 9 }}>
            <button className="btn sec sm toggle" onClick={() => setOpen(false)}>{t("cancel")}</button>
            <button className="btn dang sm toggle" disabled={busy || !note.trim()}
                    onClick={() => decide(false)}>{t("reject")}</button>
            <button className="btn pri sm toggle"
                    disabled={busy || !(Number(amount) > 0) || Number(amount) > a.amount}
                    onClick={() => decide(true)}>{t("approve")}</button>
          </div>
        </>
      )}
    </div>
  );
}
