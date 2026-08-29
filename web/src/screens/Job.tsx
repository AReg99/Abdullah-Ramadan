import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, compress, patchCachedStage, ApiError, type Stage, type Person } from "../api";
import { enqueue, newId } from "../sync";
import { REASONS } from "../i18n";

type Mode = "card" | "capture" | "pause";

export default function Job() {
  const { id = "" } = useParams();
  const { t, lang, toast } = useApp();
  const nav = useNavigate();
  const [s, setS] = useState<(Stage & { previousAfterPhoto: string | null; crew: Person[] }) | null>(null);
  /** Everyone is assumed present; the leader taps whoever is not. */
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("card");
  const [kind, setKind] = useState<"BEFORE" | "AFTER">("BEFORE");
  const [shot, setShot] = useState<{ blob: Blob; url: string; w: number; h: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tickNow, setTick] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.stage(id).then(setS), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (s?.status !== "IN_PROGRESS") return;
    const h = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(h);
  }, [s?.status]);

  if (!s) return <div className="empty">{t("loading")}</div>;

  const name = (a: string, e: string) => (lang === "ar" ? a : e);
  const has = (k: string) => s.photos.some((p) => p.kind === k);
  const elapsed = s.startedAt ? Math.floor((tickNow - new Date(s.startedAt).getTime()) / 1000) : 0;
  const hhmm = (sec: number) =>
    [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60].map((n) => String(n).padStart(2, "0")).join(":");

  /* ---------------- capture ---------------- */
  if (mode === "capture") {
    return (
      <>
        <div className="between" style={{ marginBottom: 11 }}>
          <span className="k">{kind === "BEFORE" ? t("capBefore") : t("capAfter")}</span>
          <span className="pill pri">{t("required")}</span>
        </div>
        <div className="view">
          {shot ? <img src={shot.url} alt="" /> : <div className="ghost"><span>{t("aim")}</span></div>}
        </div>

        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { setShot(await compress(f)); } catch { toast("camera error"); }
            e.target.value = "";
          }} />

        {!shot ? (
          <>
            <p className="note" style={{ textAlign: "center" }}>{t("ghostHint")}</p>
            <div style={{ height: 12 }} />
            <button className="btn pri" onClick={() => fileRef.current?.click()}>{t("openCamera")}</button>
          </>
        ) : (
          <>
            <div style={{ height: 12 }} />
            <button className="btn pri" disabled={busy} onClick={async () => {
              setBusy(true);
              const at = new Date().toISOString();
              try {
                // Queue the photo, then the action it gates. Order is preserved
                // by the outbox, so the gate always sees its photo first.
                await enqueue({ kind: "photo", stageId: s.id, photoKind: kind, blob: shot.blob,
                                w: shot.w, h: shot.h, clientEventId: newId(), occurredAt: at });
                await enqueue(kind === "BEFORE"
                  ? { kind: "start", stageId: s.id, clientEventId: newId(), occurredAt: at,
                      workerIds: s.crew.filter((c) => !absent.has(c.id)).map((c) => c.id) }
                  : { kind: "finish", stageId: s.id, clientEventId: newId(), occurredAt: at });
                patchCachedStage(s.id, kind === "BEFORE"
                  ? { status: "IN_PROGRESS", startedAt: at, photos: [...s.photos, { id: "local", kind: "BEFORE", path: "" }] }
                  : { status: "DONE" });
                setShot(null); setMode("card");
                if (kind === "AFTER") { toast(t("STAGE_FINISHED")); nav("/work"); }
                else { setTimeout(load, 700); }
              } catch {
                toast("error");
              } finally { setBusy(false); }
            }}>{t("use")}</button>
            <div style={{ height: 9 }} />
            <button className="btn sec sm" onClick={() => setShot(null)}>{t("retake")}</button>
          </>
        )}

        {kind === "BEFORE" && (
          <div className="card" style={{ marginTop: 14, background: "var(--muted)", borderColor: "var(--p)" }}>
            <p style={{ margin: 0, fontSize: ".9rem" }}>{t("whyBefore")}</p>
          </div>
        )}
      </>
    );
  }

  /* ---------------- pause ---------------- */
  if (mode === "pause") {
    return (
      <>
        <span className="k">{t("pauseWhy")}</span>
        <p className="note" style={{ marginBottom: 14 }}>{t("pauseHint")}</p>
        {REASONS.map((r) => (
          <button key={r} className="reason" onClick={async () => {
            await enqueue({ kind: "pause", stageId: s.id, reason: r,
                            clientEventId: newId(), occurredAt: new Date().toISOString() });
            patchCachedStage(s.id, { status: "PAUSED", blockedReason: r, startedAt: null });
            setMode("card"); setTimeout(load, 700); toast(t("STAGE_BLOCKED"));
          }}>{t(r)}</button>
        ))}
        <div style={{ height: 8 }} />
        <button className="btn sec sm" onClick={() => setMode("card")}>←</button>
      </>
    );
  }

  /* ---------------- job card ---------------- */
  return (
    <>
      <div className="card">
        <div className="between" style={{ marginBottom: 11 }}>
          <span className="k">{t("order")} <span className="mono">{s.workOrder.order.code}</span></span>
          <span className="pill pri">{name(s.stage.nameAr, s.stage.nameEn)}</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
          {/* What it is meant to end up looking like — worth more to the bench
              than any amount of specification text. */}
          {s.workOrder.product.photo && (
            <a href={`/uploads/${s.workOrder.product.photo}`} target="_blank" rel="noreferrer">
              <img src={`/uploads/${s.workOrder.product.photo}`} alt=""
                   style={{ width: 64, height: 64, objectFit: "cover",
                            borderRadius: "var(--rs)", border: "1px solid var(--g3)" }} />
            </a>
          )}
          <div style={{ fontWeight: 600, fontSize: "1.15rem", flex: 1 }}>
            {name(s.workOrder.product.nameAr, s.workOrder.product.nameEn)}
          </div>
        </div>
        <dl className="spec">
          <dt>{t("spec")}</dt><dd>{s.workOrder.specNotes ?? "—"}</dd>
          <dt>{t("qty")}</dt><dd className="mono">{s.workOrder.qty}</dd>
          {s.workOrder.serial && <><dt>{t("serial")}</dt><dd className="mono">{s.workOrder.serial}</dd></>}
          <dt>{t("std")}</dt><dd><span className="mono">{s.stage.stdMinutes}</span> {t("min")}</dd>
        </dl>

        <div className="divide" />
        <span className="k">{t("stagePhotos")}</span>
        <div className="strip">
          <Thumb src={s.photos.find((p) => p.kind === "BEFORE")?.path} label={t("before")} />
          <Thumb src={s.photos.find((p) => p.kind === "AFTER")?.path} label={t("after")} />
          <Thumb src={s.previousAfterPhoto ?? undefined} label={t("prev")} dim />
        </div>

        {s.status === "READY" && s.crew.length > 0 && (
          <>
            <div className="divide" />
            <span className="k">{t("crew")}</span>
            <div className="crew">
              {s.crew.map((c) => {
                const out = absent.has(c.id);
                return (
                  <button key={c.id} className={`crewchip${out ? " out" : ""}`}
                    aria-pressed={!out}
                    onClick={() => setAbsent((prev) => {
                      const next = new Set(prev);
                      next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                      return next;
                    })}>
                    {lang === "ar" ? c.nameAr : c.nameEn}
                  </button>
                );
              })}
            </div>
            <p className="note">{t("crewHint")}</p>
          </>
        )}
        {s.status !== "READY" && s.workers.length > 0 && (
          <>
            <div className="divide" />
            <span className="k">{t("crewOnJob")}</span>
            <div className="crew">
              {s.workers.map((w) => (
                <span key={w.id} className="crewchip on">{lang === "ar" ? w.nameAr : w.nameEn}</span>
              ))}
            </div>
          </>
        )}

        {s.status === "IN_PROGRESS" && (
          <>
            <div className="divide" />
            <div className="between">
              <span className="k">{t("running")}</span>
              <span className="mono" style={{ fontWeight: 700, fontSize: "1.15rem", color: "var(--p)" }}>{hhmm(elapsed)}</span>
            </div>
          </>
        )}
        {s.status === "PAUSED" && (
          <>
            <div className="divide" />
            <span className="pill warn">{t(s.blockedReason as any)}</span>
          </>
        )}
      </div>

      <div style={{ height: 12 }} />
      {s.status === "READY" && (
        <button className="btn pri" onClick={async () => {
          if (s.stage.photoBefore === "REQUIRED" && !has("BEFORE")) { setKind("BEFORE"); setShot(null); setMode("capture"); return; }
          try {
            const at = new Date().toISOString();
            const present = s.crew.filter((c) => !absent.has(c.id));
            await enqueue({ kind: "start", stageId: s.id, clientEventId: newId(), occurredAt: at,
                            workerIds: present.map((c) => c.id) });
            patchCachedStage(s.id, { status: "IN_PROGRESS", startedAt: at, workers: present });
            setTimeout(load, 700);
          } catch (e: any) {
            if (e instanceof ApiError && e.code === "photo_before_required") { setKind("BEFORE"); setMode("capture"); }
            else toast(t("errStart"));
          }
        }}>{t("start")}</button>
      )}
      {s.status === "IN_PROGRESS" && (
        <>
          <button className="btn pri" onClick={async () => {
            if (s.stage.photoAfter === "REQUIRED" && !has("AFTER")) { setKind("AFTER"); setShot(null); setMode("capture"); return; }
            // An inspection is not closed by tapping finish. Queueing one here
            // would fail in the outbox with nobody the wiser.
            if (s.stage.isQcGate) { nav(`/inspect/${s.id}`); return; }
            await enqueue({ kind: "finish", stageId: s.id, clientEventId: newId(), occurredAt: new Date().toISOString() });
            patchCachedStage(s.id, { status: "DONE" });
            toast(t("STAGE_FINISHED")); nav("/work");
          }}>{s.stage.isQcGate ? t("inspect") : t("finish")}</button>
          <div style={{ height: 9 }} />
          <button className="btn sec" onClick={() => setMode("pause")}>{t("pause")}</button>
        </>
      )}
      {s.status === "PAUSED" && (
        <button className="btn pri" onClick={async () => {
          const at = new Date().toISOString();
          await enqueue({ kind: "resume", stageId: s.id, clientEventId: newId(), occurredAt: at });
          patchCachedStage(s.id, { status: "IN_PROGRESS", startedAt: at, blockedReason: null });
          setTimeout(load, 700);
        }}>{t("resume")}</button>
      )}
    </>
  );
}

function Thumb({ src, label, dim }: { src?: string; label: string; dim?: boolean }) {
  return (
    <div className={`thumb${src ? " has" : ""}`} style={dim ? { opacity: 0.6 } : undefined}>
      {src ? <><img src={`/uploads/${src}`} alt="" /><span className="cap">{label}</span></> : label}
    </div>
  );
}
