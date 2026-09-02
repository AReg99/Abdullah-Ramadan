import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type LineSpecView, type SpecChangeRow, type SpecQuestionRow } from "../api";

type Tab = "questions" | "changes";

/**
 * المواصفات — the counter's side of the contract with the bench.
 *
 * Two queues, and they are the two ways an order used to go wrong quietly:
 * a question from the factory that nobody at the showroom ever heard, and a
 * change the customer rang in that never reached the floor.
 */
export default function Spec() {
  const { t, lang, me } = useApp();
  const answers = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "");
  const [tab, setTab] = useState<Tab>(answers ? "questions" : "changes");
  const [qs, setQs] = useState<SpecQuestionRow[] | null>(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [changes, setChanges] = useState<SpecChangeRow[] | null>(null);

  const load = () => {
    api.specQuestions(openOnly).then(setQs).catch(() => setQs([]));
    api.unseenSpecChanges().then(setChanges).catch(() => setChanges([]));
  };
  useEffect(() => { load(); }, [openOnly]);

  const nm = (a?: string, e?: string) => (lang === "ar" ? a : e) ?? "";

  return (
    <>
      <div className="tabs">
        <button className={`btn sm ${tab === "questions" ? "pri" : "sec"}`}
                onClick={() => setTab("questions")}>
          {t("specQuestionsTab")}
          {qs && qs.filter((q) => !q.answeredAt).length > 0
            && ` · ${qs.filter((q) => !q.answeredAt).length}`}
        </button>
        <button className={`btn sm ${tab === "changes" ? "pri" : "sec"}`}
                onClick={() => setTab("changes")}>
          {t("specChangesTab")}{changes?.length ? ` · ${changes.length}` : ""}
        </button>
      </div>

      {tab === "questions" && (
        <>
          <div className="tabs">
            <button className={`btn sm ${openOnly ? "pri" : "sec"}`} onClick={() => setOpenOnly(true)}>
              {t("specWaiting")}
            </button>
            <button className={`btn sm ${!openOnly ? "pri" : "sec"}`} onClick={() => setOpenOnly(false)}>
              {t("labelStateAll")}
            </button>
          </div>
          {!qs ? <div className="empty">{t("loading")}</div>
            : qs.length === 0 ? <p className="empty">{t("specNoQuestions")}</p>
            : qs.map((q) => (
                <Question key={q.id} q={q} canAnswer={answers} onDone={load} />
              ))}
        </>
      )}

      {tab === "changes" && (
        !changes ? <div className="empty">{t("loading")}</div>
        : changes.length === 0 ? <p className="empty">{t("specNoQuestions")}</p>
        : changes.map((c) => (
            <div className="card" key={c.id} style={{ marginBottom: 10 }}>
              <div className="between">
                <span className="nm mono">{c.orderCode}</span>
                <span className="pill warn">{t("specInProduction")}</span>
              </div>
              <span className="sub">{c.customer} · {nm(c.product?.nameAr, c.product?.nameEn)}</span>
              <div style={{ marginTop: 8 }}>
                <span className="nm">{nm(c.nameAr, c.nameEn)}</span>{" "}
                <s className="muted">{c.from ?? "—"}</s> → <b>{c.to}</b>
              </div>
              {c.reason && <p className="note">{t("specChangeWhy")}: {c.reason}</p>}
              <span className="sub muted">{nm(c.by, c.byEn)}</span>
            </div>
          ))
      )}
    </>
  );
}

function Question({ q, canAnswer, onDone }: {
  q: SpecQuestionRow; canAnswer: boolean; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const [a, setA] = useState("");
  const [busy, setBusy] = useState(false);
  const nm = (ar?: string, en?: string) => (lang === "ar" ? ar : en) ?? "";

  const send = async () => {
    setBusy(true);
    try { await api.answerSpec(q.id, a.trim()); setA(""); toast(t("saved")); onDone(); }
    catch (e: any) { toast(e?.code ? t(e.code) : "error"); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="between">
        <span className="nm mono">{q.orderCode}</span>
        {q.blocking && !q.answeredAt && <span className="pill bad">{t("specBlocking")}</span>}
      </div>
      <span className="sub">{q.customer} · {nm(q.product?.nameAr, q.product?.nameEn)}</span>
      <div style={{ marginTop: 9, fontSize: "1.02rem" }}>{q.question}</div>
      <span className="sub muted">{nm(q.askedBy, q.askedByEn)} · {t("specAsked")}</span>

      {q.answer ? (
        <div className="qa-a" style={{ marginTop: 9 }}>
          <b>{q.answer}</b>
          <span className="sub muted">
            {nm(q.answeredBy ?? "", q.answeredByEn ?? "")} · {t("specAnswered")}
          </span>
        </div>
      ) : canAnswer ? (
        <div style={{ marginTop: 9 }}>
          <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2}
                    placeholder={t("specAnswer")} />
          <button className="btn pri sm" style={{ marginTop: 9 }}
                  disabled={busy || !a.trim()} onClick={send}>
            {t("specSendAnswer")}
          </button>
        </div>
      ) : <p className="note">{t("specWaiting")}…</p>}

      {q.orderLineId && <LineSpec id={q.orderLineId} />}
    </div>
  );
}

/**
 * What the piece is currently meant to be, and the ability to change it — from
 * the same screen the question was asked on, because a question about the
 * colour is very often answered by changing the colour.
 */
function LineSpec({ id }: { id: string }) {
  const { t, lang, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<LineSpecView | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.lineSpec(id).then((x) => {
    setV(x);
    setDraft(Object.fromEntries(x.specs.map((f) => [f.code, f.value])));
  }).catch(() => setV(null));
  useEffect(() => { if (open && !v) load(); }, [open]);

  if (!open) {
    return (
      <button className="chip" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
        {t("specEdit")}
      </button>
    );
  }
  if (!v) return <p className="note">{t("loading")}</p>;
  if (v.specs.length === 0) return <p className="note">{t("specNoFields")}</p>;

  const moved = v.specs.some((f) => (draft[f.code] ?? "") !== f.value);
  const needsReason = v.inProduction && moved && !reason.trim();

  return (
    <div style={{ marginTop: 11 }}>
      <div className="between">
        <span className="k">{t("specOf")}</span>
        {v.inProduction && <span className="pill warn">{t("specInProduction")}</span>}
      </div>
      {v.specs.map((f) => (
        <div key={f.code} style={{ marginTop: 8 }}>
          <span className="sub">
            {(lang === "ar" ? f.nameAr : f.nameEn)}{f.unit ? ` (${f.unit})` : ""}
          </span>
          {f.kind === "CHOICE" ? (
            <select value={draft[f.code] ?? ""} style={{ marginTop: 5 }}
                    onChange={(e) => setDraft({ ...draft, [f.code]: e.target.value })}>
              <option value="">—</option>
              {f.options.map((o) => {
                const val = lang === "ar" ? o.nameAr : o.nameEn;
                return <option key={o.nameAr} value={val}>{val}</option>;
              })}
            </select>
          ) : (
            <input value={draft[f.code] ?? ""} style={{ marginTop: 5 }}
                   inputMode={f.kind === "NUMBER" ? "numeric" : undefined}
                   onChange={(e) => setDraft({ ...draft, [f.code]: e.target.value })} />
          )}
        </div>
      ))}

      {v.inProduction && moved && (
        <>
          <input value={reason} onChange={(e) => setReason(e.target.value)}
                 placeholder={t("specChangeWhy")} style={{ marginTop: 9 }} />
          <p className="note">{t("specWhyRequired")}</p>
        </>
      )}

      <div className="row wrap" style={{ marginTop: 9 }}>
        <button className="btn pri sm toggle" disabled={busy || !moved || needsReason}
          onClick={async () => {
            setBusy(true);
            try {
              await api.setLineSpec(id, { answers: draft, reason: reason.trim() || undefined });
              toast(t("saved")); setReason(""); await load();
            } catch (e: any) { toast(e?.code ? t(e.code) : "error"); }
            finally { setBusy(false); }
          }}>
          {t("saveAccount")}
        </button>
        <button className="btn sec sm toggle" onClick={() => { setOpen(false); setV(null); }}>
          {t("cancel")}
        </button>
      </div>

      {v.changes.length > 0 && (
        <>
          <div className="divide" />
          <span className="k">{t("specChangesTab")}</span>
          {v.changes.map((c) => (
            <div key={c.id} className="evt">
              <span style={{ flex: 1 }}>
                <b>{lang === "ar" ? c.nameAr : c.nameEn}</b>{" "}
                <s className="muted">{c.from ?? "—"}</s> → {c.to}
                {c.reason && <span className="sub">{c.reason}</span>}
              </span>
              <span className="sub muted">{lang === "ar" ? c.by : c.byEn}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
