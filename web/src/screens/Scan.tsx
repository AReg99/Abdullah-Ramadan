import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api } from "../api";

/**
 * Scanning the unit label is how a worker reaches a job. Uses the native
 * BarcodeDetector where the browser has it; everywhere else the serial can be
 * typed, because a scanner that fails with no fallback stops the line.
 */
export default function Scan() {
  const { t, toast } = useApp();
  const nav = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [manual, setManual] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const resolve = async (serial: string) => {
    try {
      const { stageId } = await api.byLabel(serial.trim());
      nav(`/work/${stageId}`);
    } catch (e: any) {
      setErr(e?.code === "unknown_label" ? t("unknownLabel") : t("noOpenStage"));
    }
  };

  useEffect(() => {
    const AnyWin = window as any;
    if (!("BarcodeDetector" in AnyWin) || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setSupported(true);
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    (async () => {
      try {
        const detector = new AnyWin.BarcodeDetector({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]?.rawValue) { stopped = true; await resolve(found[0].rawValue); return; }
          } catch { /* a dropped frame is not an error worth showing */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setSupported(false);
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, []);

  return (
    <>
      {supported !== false && (
        <div className="view">
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div className="ghost"><span>{t("aimLabel")}</span></div>
        </div>
      )}
      {supported === false && (
        <div className="card"><p className="note" style={{ margin: 0 }}>{t("scanUnsupported")}</p></div>
      )}

      <div style={{ height: 14 }} />
      <span className="k">{t("typeSerial")}</span>
      <input className="mono" value={manual} onChange={(e) => setManual(e.target.value)}
        placeholder="AURA-WO-1000-1" style={{ marginTop: 7 }} />
      <div style={{ height: 10 }} />
      <button className="btn pri" onClick={() => resolve(manual)} disabled={!manual.trim()}>{t("open")}</button>
      {err && <p className="note" style={{ color: "var(--bad)" }}>{err}</p>}
    </>
  );
}
