import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, compress, ApiError, type Stage } from "../api";
import { REASONS } from "../i18n";

type Mode = "card" | "capture" | "pause";

export default function Job() {
  const { id = "" } = useParams();
  const { t, lang, toast } = useApp();
  const nav = useNavigate();
  const [s, setS] = useState<(Stage & { previousAfterPhoto: string | null }) | null>(null);
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
              try {
                await api.uploadPhoto(s.id, kind, shot.blob, shot.w, shot.h);
                if (kind === "BEFORE") await api.start(s.id); else await api.finish(s.id);
                setShot(null); setMode("card");
                if (kind === "AFTER") { toast(t("STAGE_FINISHED")); nav("/work"); } else { await load(); }
              } catch (e: any) {
                toast(e instanceof ApiError ? e.code : "error");
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
            await api.pause(s.id, r);
            setMode("card"); await load(); toast(t("STAGE_BLOCKED"));
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
        <div style={{ fontWeight: 600, fontSize: "1.15rem", marginBottom: 12 }}>
          {name(s.workOrder.product.nameAr, s.workOrder.product.nameEn)}
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
          try { await api.start(s.id); await load(); }
          catch (e: any) {
            if (e instanceof ApiError && e.code === "photo_before_required") { setKind("BEFORE"); setMode("capture"); }
            else toast(t("errStart"));
          }
        }}>{t("start")}</button>
      )}
      {s.status === "IN_PROGRESS" && (
        <>
          <button className="btn pri" onClick={async () => {
            if (s.stage.photoAfter === "REQUIRED" && !has("AFTER")) { setKind("AFTER"); setShot(null); setMode("capture"); return; }
            await api.finish(s.id); toast(t("STAGE_FINISHED")); nav("/work");
          }}>{t("finish")}</button>
          <div style={{ height: 9 }} />
          <button className="btn sec" onClick={() => setMode("pause")}>{t("pause")}</button>
        </>
      )}
      {s.status === "PAUSED" && (
        <button className="btn pri" onClick={async () => { await api.resume(s.id); await load(); }}>{t("resume")}</button>
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
