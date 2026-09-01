import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type PlanBoard, type PlanRow, type PromiseWatch,
         type StationLoad } from "../api";

type Tab = "queue" | "load" | "promises";
const TABS: Tab[] = ["queue", "load", "promises"];
const LEVELS = ["NORMAL", "URGENT", "CRITICAL"] as const;

/**
 * التخطيط — the production manager's screen.
 *
 * Two questions, which is the whole job: what should the floor do next, and
 * which station is everything waiting behind. The data for both has been in the
 * schema since the first release — a priority on every work order, a daily
 * capacity on every station, a standard time on every stage — and nothing
 * read or wrote any of it, so the floor's work list sorted by a priority that
 * was always zero.
 */
export default function Planning() {
  const { t } = useApp();
  const [tab, setTab] = useState<Tab>("queue");

  return (
    <>
      <div className="tabs">
        {TABS.map((x) => (
          <button key={x} className={`btn sm ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`plan_${x}` as any)}
          </button>
        ))}
      </div>
      {tab === "queue" ? <Queue /> : tab === "load" ? <Load /> : <Promises />}
    </>
  );
}

/* ───────────────────────────────────────── طابور الشغل */

function Queue() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [b, setB] = useState<PlanBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [only, setOnly] = useState<"" | "late" | "blocked" | "urgent">("");

  const load = async () => {
    setLoading(true);
    try { setB(await api.planningBoard()); }
    catch { setB(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!b) return <p className="empty">{t("noRows")}</p>;

  const rows = b.rows.filter((r) =>
    only === "late" ? r.late
    : only === "blocked" ? Boolean(r.blocked)
    : only === "urgent" ? r.priority > 0
    : true);

  return (
    <>
      {/* One grid, not two of three: on a phone a three-column grid falls back
          to two, so two rows of three land as a 2-1-2-1 staircase. */}
      <div className="tiles g3">
        <Tile k={t("openPieces")} v={num(b.totals.open)}
              on={() => setOnly("")} lit={only === ""} />
        <Tile k={t("late")} v={num(b.totals.late)} tone={b.totals.late ? "bad" : "ok"}
              on={() => setOnly(only === "late" ? "" : "late")} lit={only === "late"} />
        <Tile k={t("blockedNow")} v={num(b.totals.blocked)}
              tone={b.totals.blocked ? "warn" : "ok"}
              on={() => setOnly(only === "blocked" ? "" : "blocked")} lit={only === "blocked"} />
        <Tile k={t("atRisk")} v={num(b.totals.atRisk)} tone={b.totals.atRisk ? "warn" : undefined} />
        <Tile k={t("bumped")} v={num(b.totals.urgent)}
              on={() => setOnly(only === "urgent" ? "" : "urgent")} lit={only === "urgent"} />
        <Tile k={t("workLeft")} v={`${num(b.totals.remainingHours)} ${t("hoursShort")}`} />
      </div>

      <p className="note" style={{ marginTop: 12 }}>{t("queueHint")}</p>
      {rows.length === 0 && <p className="note">{t("nothingHere")}</p>}
      {rows.map((r) => <Piece key={r.id} r={r} ar={ar} onDone={load} />)}
    </>
  );
}

function Tile({ k, v, tone, on, lit }: {
  k: string; v: string; tone?: "ok" | "warn" | "bad"; on?: () => void; lit?: boolean;
}) {
  const colour = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)"
               : tone === "ok" ? "var(--ok)" : undefined;
  return (
    <div className="tile" onClick={on}
         style={{ cursor: on ? "pointer" : undefined,
                  borderColor: lit ? "var(--p)" : undefined }}>
      <span className="k">{k}</span>
      <div className="big mono" style={{ color: colour }}>{v}</div>
    </div>
  );
}

/** One piece: where it is, when it was promised, and how to move it. */
function Piece({ r, ar, onDone }: { r: PlanRow; ar: boolean; onDone: () => void }) {
  const { t, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");

  const set = async (level: (typeof LEVELS)[number]) => {
    setBusy(true);
    try {
      await api.setPriority(r.id, { level, note: note.trim() || undefined });
      toast(t("saved")); setOpen(false); setNote(""); onDone();
    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="card" style={{
      // The one thing a production manager scans for down a long list.
      borderInlineStartWidth: r.late || r.priority > 0 ? 3 : undefined,
      borderInlineStartColor: r.late ? "var(--bad)"
                            : r.priority > 0 ? "var(--p)" : undefined,
    }}>
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm">{ar ? r.product.nameAr : r.product.nameEn}</span>
          <span className="sub">{r.customer} · {r.qty} {t("qty")}</span>
          <span className="sub mono">{r.order.code} · {r.code}</span>
        </span>
        {r.priority > 0 && (
          <span className={`pill ${r.level === "CRITICAL" ? "bad" : "warn"}`}>
            {t(`lvl_${r.level}` as any)}
          </span>
        )}
      </div>

      {/* How far along, as a bar — a fraction alone does not read at a glance. */}
      <div style={{ height: 4, background: "var(--g2)", borderRadius: 100, marginTop: 9 }}>
        <div style={{
          height: "100%", borderRadius: 100, background: "var(--p)",
          width: `${r.of > 0 ? Math.round((r.done / r.of) * 100) : 0}%`,
        }} />
      </div>
      <p className="note">
        {num(r.done)}/{num(r.of)} · {r.at
          // A station usually carries the name of the work done at it, and
          // "Cutting — Cutting" reads as a stutter rather than as detail.
          ? (r.at.station === r.at.stage
              ? r.at.station : `${r.at.station} — ${r.at.stage}`)
          : r.started ? t("betweenStations") : t("notStartedYet")}
        {" · "}{num(Math.round(r.remainingMinutes / 60))} {t("hoursShort")} {t("stillToDo")}
      </p>

      {r.promisedDate && (
        <p className="note" style={{
          color: r.late ? "var(--bad)" : r.atRisk ? "var(--warn)" : undefined,
        }}>
          {t("due")} {when(r.promisedDate)}
          {r.daysLeft != null && (r.late
            ? ` — ${t("lateBy")} ${num(-r.daysLeft)} ${t("daysShort")}`
            : ` — ${num(r.daysLeft)} ${t("daysShort")} ${t("leftShort")}`)}
        </p>
      )}

      {r.blocked && (
        <p className="note" style={{ color: "var(--warn)" }}>
          {t("blockedNow")}: {r.blocked.reason ? t(r.blocked.reason as any) : "—"}
          {" · "}{num(Math.round(r.blocked.sinceMinutes / 60))} {t("hoursShort")}
          {r.blocked.note && ` — ${r.blocked.note}`}
        </p>
      )}

      {!open ? (
        <button className="btn sec sm" style={{ marginTop: 9 }}
                onClick={() => setOpen(true)}>{t("changeOrder")}</button>
      ) : (
        <>
          {/* Raising one piece lowers every other one, so the reason is asked
              for here rather than reconstructed from the feed later. */}
          <input placeholder={t("whyBump")} value={note}
                 onChange={(e) => setNote(e.target.value)} style={{ marginTop: 9 }} />
          <div className="row wrap" style={{ marginTop: 9 }}>
            <button className="btn sec sm toggle" onClick={() => setOpen(false)}>{t("cancel")}</button>
            {LEVELS.map((l) => (
              <button key={l} disabled={busy || r.level === l}
                      className={`btn sm toggle ${l === "CRITICAL" ? "dang"
                                                : l === "URGENT" ? "pri" : "sec"}`}
                      onClick={() => set(l)}>{t(`lvl_${l}` as any)}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ───────────────────────────────────────── تحميل المحطات */

/**
 * Where the factory is waiting.
 *
 * The number that matters is days of queue, not hours of work: "cutting has
 * eleven days in front of it and finishing has one" is a decision about where
 * to move people, and nothing in the app could say it.
 */
function Load() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [l, setL] = useState<StationLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string>("");
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setL(await api.stationLoad()); }
    catch { setL(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB",
                                              { maximumFractionDigits: 1 });
  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!l) return <p className="empty">{t("noRows")}</p>;

  const worst = Math.max(...l.rows.map((r) => r.daysOfQueue ?? 0), 0);

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <span className="k">{t("workLeft")}</span>
          <div className="big mono">{num(l.totals.queuedHours)} {t("hoursShort")}</div>
        </div>
        <div className="tile">
          <span className="k">{t("capacityPerDay")}</span>
          <div className="big mono">{num(l.totals.capacityHoursPerDay)} {t("hoursShort")}</div>
        </div>
      </div>
      <p className="note" style={{ marginTop: 12 }}>{t("loadHint")}</p>

      {l.rows.map((r) => {
        const deep = l.bottleneck === r.id;
        const days = r.daysOfQueue ?? 0;
        return (
          <div className="card" key={r.id}
               style={{ borderColor: deep ? "var(--warn)" : undefined }}>
            <div className="between">
              <span style={{ flex: 1 }}>
                <span className="nm">{ar ? r.nameAr : r.nameEn}</span>
                <span className="sub mono">{r.code}</span>
              </span>
              {deep && <span className="pill warn">{t("bottleneck")}</span>}
            </div>

            <div className="between" style={{ marginTop: 8 }}>
              <span className="k">{t("daysOfQueue")}</span>
              <b className="mono" style={{
                color: days >= 5 ? "var(--bad)" : days >= 2 ? "var(--warn)" : "var(--ok)",
              }}>{num(days)}</b>
            </div>
            <div style={{ height: 4, background: "var(--g2)", borderRadius: 100, marginTop: 6 }}>
              <div style={{
                height: "100%", borderRadius: 100,
                background: days >= 5 ? "var(--bad)" : days >= 2 ? "var(--warn)" : "var(--ok)",
                width: `${worst > 0 ? Math.round((days / worst) * 100) : 0}%`,
              }} />
            </div>

            <p className="note">
              {num(r.queuedHours)} {t("hoursShort")} · {num(r.pieces)} {t("piecesShort")}
              {r.inProgress > 0 && ` · ${num(r.inProgress)} ${t("onTheBench")}`}
              {r.blocked > 0 && ` · ${num(r.blocked)} ${t("blockedNow")}`}
              {" · "}{num(r.people)} {t("peopleShort")}
            </p>

            {editing === r.id ? (
              <>
                <span className="k" style={{ marginTop: 9, display: "block" }}>
                  {t("capacityPerDay")}
                </span>
                <input className="mono" inputMode="decimal" value={hours}
                       onChange={(e) => setHours(e.target.value)} style={{ marginTop: 6 }} />
                <p className="note">{t("capacityHint")}</p>
                <div className="row wrap" style={{ marginTop: 9 }}>
                  <button className="btn sec sm toggle" onClick={() => setEditing("")}>
                    {t("cancel")}
                  </button>
                  <button className="btn pri sm toggle"
                          disabled={busy || !(Number(hours) > 0)}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await api.setCapacity(r.id, Math.round(Number(hours) * 60));
                              toast(t("saved")); setEditing(""); await load();
                            } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                            finally { setBusy(false); }
                          }}>{t("save")}</button>
                </div>
              </>
            ) : (
              <button className="btn sec sm" style={{ marginTop: 9 }}
                      onClick={() => {
                        setEditing(r.id);
                        setHours(String(Math.round((r.dailyCapacityMinutes / 60) * 10) / 10));
                      }}>
                {t("capacityPerDay")} · {num(r.dailyCapacityMinutes / 60)} {t("hoursShort")}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

/**
 * الوعود المهددة — dates already given that the factory can no longer meet.
 *
 * The early warning the business never had. "Late" used to arrive as a fact on
 * the day it happened; this says it a fortnight earlier, while there is still a
 * phone call that helps — which is why the customer's number is on every row.
 */
function Promises() {
  const { t, lang } = useApp();
  const ar = lang === "ar";
  const [w, setW] = useState<PromiseWatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [only, setOnly] = useState<"" | "risk" | "none">("risk");

  useEffect(() => {
    api.promiseWatch().then(setW).catch(() => setW(null)).finally(() => setLoading(false));
  }, []);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB");
  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  if (loading) return <div className="empty">{t("loading")}</div>;
  if (!w) return <p className="empty">{t("noRows")}</p>;

  const rows = w.rows.filter((r) =>
    only === "risk" ? r.atRisk : only === "none" ? r.noPromise : true);

  return (
    <>
      <div className="tiles g3">
        <Tile k={t("promiseAtRisk")} v={num(w.totals.atRisk)}
              tone={w.totals.atRisk ? "bad" : "ok"}
              on={() => setOnly(only === "risk" ? "" : "risk")} lit={only === "risk"} />
        <Tile k={t("noPromiseYet")} v={num(w.totals.noPromise)}
              tone={w.totals.noPromise ? "warn" : undefined}
              on={() => setOnly(only === "none" ? "" : "none")} lit={only === "none"} />
        <Tile k={t("worstSlip")}
              v={`${num(w.totals.worstSlipDays)} ${t("daysShort")}`}
              tone={w.totals.worstSlipDays > 0 ? "bad" : "ok"} />
        <Tile k={t("late")} v={num(w.totals.alreadyLate)}
              tone={w.totals.alreadyLate ? "bad" : "ok"} />
        <Tile k={t("openPieces")} v={num(w.totals.open)}
              on={() => setOnly("")} lit={only === ""} />
      </div>

      <p className="note" style={{ marginTop: 12 }}>{t("promiseWatchHint")}</p>
      {rows.length === 0 && <p className="note">{t("nothingHere")}</p>}

      {rows.map((r) => (
        <div className="card" key={r.id} style={{
          borderInlineStartWidth: r.atRisk ? 3 : undefined,
          borderInlineStartColor: r.atRisk ? "var(--bad)" : undefined,
        }}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <span className="nm">{ar ? r.product.nameAr : r.product.nameEn}</span>
              <span className="sub">{r.customer} · {num(r.qty)} {t("qty")}</span>
              <span className="sub mono">{r.orderCode}</span>
            </span>
            {r.atRisk && r.slipDays != null && (
              <span className="pill bad">+{num(r.slipDays)} {t("daysShort")}</span>
            )}
            {r.noPromise && <span className="pill warn">{t("noPromiseYet")}</span>}
          </div>

          <p className="note">
            {r.promisedDate
              ? <>{t("promisedFor")} <b>{when(r.promisedDate)}</b></>
              : t("nobodySaidADate")}
            {r.canDoBy && (
              <> · {t("canDoBy")}{" "}
                <b style={{ color: r.atRisk ? "var(--bad)" : "var(--ok)" }}>
                  {when(r.canDoBy)}
                </b>
              </>
            )}
            {r.workingDaysLeft != null && <> · {num(r.workingDaysLeft)} {t("workingDaysShort")}</>}
          </p>

          {/* The whole point of knowing early is that there is still a call
              worth making. */}
          <a className="btn sec sm toggle" href={`tel:${r.customerPhone}`}
             style={{ textDecoration: "none", marginTop: 8 }}>{t("callCustomer")}</a>
        </div>
      ))}
    </>
  );
}
