import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type AttendanceDay, type AttendanceWeek } from "../api";

const STATUSES = ["PRESENT", "HALF", "LEAVE", "ABSENT"] as const;
const today = () => new Date().toISOString().slice(0, 10);

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

/**
 * الحضور — who was in.
 *
 * The wage is computed from this, not reported from it, which is why the whole
 * register is one tap per absence: everybody starts present, because that is
 * what happens most mornings, and the person holding the phone at seven should
 * only have to touch the exceptions.
 */
export default function Attendance() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [view, setView] = useState<"day" | "week">("day");
  const [day, setDay] = useState(today());
  const [sheet, setSheet] = useState<AttendanceDay | null>(null);
  const [week, setWeek] = useState<AttendanceWeek | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      if (view === "day") {
        const s = await api.attendanceDay(day);
        setSheet(s);
        setEdits(Object.fromEntries(s.lines.map((l) => [l.userId, l.status])));
      } else {
        setWeek(await api.attendanceWeek(weekKeyOf(new Date(`${day}T12:00:00Z`))));
      }
    } catch { setSheet(null); setWeek(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [day, view]);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 2 });
  const dayName = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(ar ? "ar-EG" : "en-GB", { weekday: "short" });

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className={`btn sm ${view === "day" ? "pri" : "sec"}`}
                onClick={() => setView("day")}>{t("theDay")}</button>
        <button className={`btn sm ${view === "week" ? "pri" : "sec"}`}
                onClick={() => setView("week")}>{t("theWeek")}</button>
      </div>

      <div className="card">
        <span className="k">{view === "day" ? t("theDay") : t("theWeek")}</span>
        <input type="date" value={day} max={today()}
               onChange={(e) => setDay(e.target.value)} style={{ marginTop: 6 }} />
        {view === "day" && sheet && (
          <p className="note"><span className="mono">{sheet.weekKey}</span></p>
        )}
      </div>

      {loading && <div className="empty">{t("loading")}</div>}

      {view === "day" && sheet && !loading && (
        <>
          {sheet.lines.length === 0 && <p className="note">{t("nobodyOnDayRate")}</p>}
          {sheet.lines.map((l) => (
            <div className="card" key={l.userId}>
              <div className="between">
                <span style={{ flex: 1 }}>
                  <span className="nm">{ar ? l.nameAr : l.nameEn}</span>
                  <span className="sub mono">{t(l.role as any)} · {num(l.dayRate)}</span>
                </span>
              </div>
              <div className="tabs" style={{ marginTop: 9, marginBottom: 0 }}>
                {STATUSES.map((st) => (
                  <button key={st} style={{ whiteSpace: "nowrap" }}
                          className={`btn sm ${edits[l.userId] === st
                            ? (st === "ABSENT" ? "dang" : "pri") : "sec"}`}
                          onClick={() => setEdits({ ...edits, [l.userId]: st })}>
                    {t(`att_${st}` as any)}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {sheet.lines.length > 0 && (
            <button className="btn pri" style={{ marginTop: 11 }} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.saveAttendance(day, sheet.lines.map((l) => ({
                          userId: l.userId, status: edits[l.userId] ?? "PRESENT",
                        })));
                        toast(t("saved")); await load();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                      finally { setBusy(false); }
                    }}>
              {t("saveRegister")}
            </button>
          )}
        </>
      )}

      {view === "week" && week && !loading && (
        <>
          <p className="note">
            <span className="mono">{week.period}</span> ·{" "}
            {new Date(week.start).toLocaleDateString(ar ? "ar-EG" : "en-GB")} —{" "}
            {new Date(week.end).toLocaleDateString(ar ? "ar-EG" : "en-GB")}
          </p>
          {week.lines.map((l) => (
            <div className="card" key={l.userId}>
              <div className="between">
                <span style={{ flex: 1 }}>
                  <span className="nm">{ar ? l.nameAr : l.nameEn}</span>
                  <span className="sub mono">{num(l.days)} {t("daysWorked")} × {num(l.dayRate)}</span>
                </span>
                <b className="mono">{num(l.earned)}</b>
              </div>
              <div className="row scroll-x" style={{ marginTop: 9, gap: 5 }}>
                {l.cells.map((c) => (
                  <span key={c.day} className="pill"
                        style={{
                          whiteSpace: "nowrap",
                          background: c.status === "ABSENT" ? "var(--badS)" : undefined,
                          color: c.status === "ABSENT" ? "var(--bad)" : undefined,
                          opacity: c.status === "HALF" ? 0.7 : 1,
                        }}>
                    {dayName(c.day)} {c.status === "PRESENT" ? "✓"
                      : c.status === "HALF" ? "½" : c.status === "LEAVE" ? "○" : "✕"}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {week.lines.length === 0 && <p className="note">{t("nobodyOnDayRate")}</p>}
        </>
      )}
    </>
  );
}
