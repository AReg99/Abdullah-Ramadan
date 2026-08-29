import { useEffect, useRef, useState } from "react";
import { useApp } from "../app-context";
import { api, compress, type DeliveryRun, type DeliveryStop } from "../api";

const REASONS = ["CUSTOMER_ABSENT", "REFUSED", "DAMAGED", "WRONG_ADDRESS",
                 "NO_ACCESS", "RESCHEDULED", "OTHER"] as const;

/**
 * تسليمات النهارده — the driver's day.
 *
 * The driver used to read the same board as the showroom manager: a list of
 * order lines with no customer, no phone number and no address, and a Deliver
 * button that recorded nothing but the time. This is the job as it is actually
 * done — who, where, the number to ring, and what proves it was handed over.
 */
export default function Run() {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [run, setRun] = useState<DeliveryRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<{ stop: DeliveryStop; mode: "done" | "failed" } | null>(null);

  const load = async () => {
    setLoading(true);
    try { setRun(await api.deliveryRun()); }
    catch { setRun(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  if (open) {
    return <Handover stop={open.stop} mode={open.mode}
                     onClose={() => setOpen(null)}
                     onDone={async () => { setOpen(null); await load(); }} />;
  }

  return (
    <>
      {loading && <div className="empty">{t("loading")}</div>}

      {run && !loading && (
        <>
          <div className="tiles g3">
            <div className="tile">
              <span className="k">{t("onVan")}</span>
              <div className="big mono">{run.totals.onVan}</div>
            </div>
            <div className="tile">
              <span className="k">{t("toDeliver")}</span>
              <div className="big mono">{run.totals.toDeliver}</div>
            </div>
            <div className="tile">
              <span className="k">{t("deliveredToday")}</span>
              <div className="big mono" style={{ color: "var(--ok)" }}>{run.totals.done}</div>
            </div>
          </div>

          {run.onVan.length > 0 && (
            <>
              <p className="note" style={{ marginTop: 16 }}>{t("onVanHint")}</p>
              {run.onVan.map((x) => (
                <Stop key={x.id} stop={x} ar={ar} t={t}
                      action={
                        <button className="btn pri sm" onClick={async () => {
                          try {
                            await api.receiveLine(x.id);
                            toast(t("RECEIVED_AT_SHOWROOM")); await load();
                          } catch { toast(t("signInFailed")); }
                        }}>{t("signItIn")}</button>
                      } />
              ))}
            </>
          )}

          <p className="note" style={{ marginTop: 16 }}>{t("toDeliverHint")}</p>
          {run.toDeliver.length === 0 && <p className="note">{t("nothingToDeliver")}</p>}
          {run.toDeliver.map((x) => (
            <Stop key={x.id} stop={x} ar={ar} t={t}
                  action={
                    <div className="row">
                      <button className="btn pri sm" onClick={() => setOpen({ stop: x, mode: "done" })}>
                        {t("handedOver")}
                      </button>
                      <button className="btn dang sm" onClick={() => setOpen({ stop: x, mode: "failed" })}>
                        {t("notDelivered")}
                      </button>
                    </div>
                  } />
          ))}

          {run.done.length > 0 && (
            <>
              <p className="note" style={{ marginTop: 16 }}>{t("deliveredToday")}</p>
              {run.done.map((x) => <Stop key={x.id} stop={x} ar={ar} t={t} muted />)}
            </>
          )}
        </>
      )}
    </>
  );
}

/** One stop: who, where, what, and the number to ring. */
function Stop({ stop, ar, t, action, muted }: {
  stop: DeliveryStop; ar: boolean; t: (k: any) => string;
  action?: React.ReactNode; muted?: boolean;
}) {
  const missed = stop.attempts.filter((a) => !a.delivered);
  return (
    <div className="card" style={{ opacity: muted ? 0.6 : 1 }}>
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm">{stop.customer.name}</span>
          <span className="sub">
            {ar ? stop.product.nameAr : stop.product.nameEn} · {stop.qty} {t("qty")}
          </span>
          <span className="sub mono">{stop.order.code}</span>
        </span>
        {stop.retry && <span className="pill warn">{t("secondVisit")}</span>}
      </div>

      {stop.customer.address && <p className="note">{stop.customer.address}</p>}
      {stop.specNotes && <p className="note">{stop.specNotes}</p>}

      {/* The two taps a driver makes on every stop. Nothing else on the screen
          matters if these are not the first thing under their thumb. */}
      {!muted && (
        <div className="row" style={{ marginTop: 10 }}>
          <a className="btn sec sm" href={`tel:${stop.customer.phone}`}
             style={{ textDecoration: "none" }}>{t("callCustomer")}</a>
          {stop.customer.address && (
            <a className="btn sec sm" target="_blank" rel="noreferrer"
               href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.customer.address)}`}
               style={{ textDecoration: "none" }}>{t("openMap")}</a>
          )}
        </div>
      )}

      {missed.length > 0 && (
        <p className="note" style={{ color: "var(--warn)" }}>
          {missed.length} {t("missedVisits")} · {t(`fail_${missed[0].failReason}` as any)}
        </p>
      )}

      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

/**
 * The handover.
 *
 * A photograph of the piece where it was left, or the customer's signature.
 * Either is enough — demanding both would leave a driver stuck in a stairwell
 * because a camera failed.
 */
function Handover({ stop, mode, onClose, onDone }: {
  stop: DeliveryStop; mode: "done" | "failed"; onClose: () => void; onDone: () => void;
}) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [recipient, setRecipient] = useState(stop.customer.name);
  const [reason, setReason] = useState<string>("CUSTOMER_ABSENT");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ path: string; url: string } | null>(null);
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const pad = useRef<HTMLCanvasElement | null>(null);

  const failing = mode === "failed";
  const ready = failing
    ? true
    : recipient.trim().length > 0 && (Boolean(photo) || signed);

  /**
   * Where the phone is, if it will say within a couple of seconds.
   *
   * Raced against our own timer rather than trusting the browser's: a device
   * that never answers the permission prompt calls back neither way, and the
   * driver is left holding a sofa in a stairwell staring at a dead button.
   * The location is nice to have. The handover is the job.
   */
  const where = () => new Promise<{ lat?: number; lng?: number }>((resolve) => {
    let settled = false;
    const done = (v: { lat?: number; lng?: number }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    setTimeout(() => done({}), 2500);
    if (!navigator.geolocation) return done({});
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => done({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => done({}), { timeout: 2500, maximumAge: 60_000 });
    } catch { done({}); }
  });

  return (
    <>
      <div className="card">
        <div className="between">
          <span style={{ flex: 1 }}>
            <span className="nm">{stop.customer.name}</span>
            <span className="sub">{ar ? stop.product.nameAr : stop.product.nameEn}</span>
            <span className="sub mono">{stop.order.code}</span>
          </span>
          <button className="chip" onClick={onClose}>{t("back")}</button>
        </div>
      </div>

      {failing ? (
        <div className="card">
          <span className="k">{t("whyNot")}</span>
          {REASONS.map((r) => (
            <button key={r} className={`btn sm ${reason === r ? "dang" : "sec"}`}
                    style={{ marginTop: 8 }} onClick={() => setReason(r)}>
              {t(`fail_${r}` as any)}
            </button>
          ))}
          <p className="note">{t("failHint")}</p>
        </div>
      ) : (
        <>
          <div className="card">
            <span className="k">{t("whoTookIt")}</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)}
                   style={{ marginTop: 8 }} />
            <p className="note">{t("recipientHint")}</p>
          </div>

          <div className="card">
            <span className="k">{t("proofPhoto")}</span>
            {photo && (
              <img src={photo.url} alt="" style={{
                width: "100%", maxHeight: 200, objectFit: "cover",
                borderRadius: "var(--rs)", marginTop: 9, border: "1px solid var(--g3)" }} />
            )}
            <input type="file" accept="image/*" capture="environment" style={{ marginTop: 9 }}
                   onChange={async (e) => {
                     const f = e.target.files?.[0];
                     if (!f) return;
                     try {
                       const { blob, url } = await compress(f);
                       const up = await api.uploadProof(blob, "PHOTO");
                       setPhoto({ path: up.path, url });
                     } catch { toast(t("fileTooBig")); }
                   }} />
          </div>

          <SignaturePad padRef={pad} onDrawn={() => setSigned(true)}
                        onClear={() => setSigned(false)} />
        </>
      )}

      <div className="card">
        <span className="k">{t("note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }} />
      </div>

      {!failing && !photo && !signed && <p className="note">{t("proofRequired")}</p>}

      <button className={`btn ${failing ? "dang" : "pri"}`} style={{ marginTop: 12 }}
              disabled={busy || !ready}
              onClick={async () => {
                setBusy(true);
                try {
                  const at = await where();
                  if (failing) {
                    await api.markFailed(stop.id, { reason, note: note.trim() || undefined, ...at });
                    toast(t("recordedNotDelivered"));
                  } else {
                    let signaturePath: string | undefined;
                    if (signed && pad.current) {
                      const blob: Blob = await new Promise((res) =>
                        pad.current!.toBlob((b) => res(b!), "image/png"));
                      signaturePath = (await api.uploadProof(blob, "SIGNATURE")).path;
                    }
                    await api.markDelivered(stop.id, {
                      recipientName: recipient.trim(),
                      note: note.trim() || undefined,
                      photoPath: photo?.path, signaturePath, ...at,
                    });
                    toast(t("DELIVERED_TO_CUSTOMER"));
                  }
                  onDone();
                } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                finally { setBusy(false); }
              }}>
        {failing ? t("recordNotDelivered") : t("confirmHandover")}
      </button>
    </>
  );
}

/** Somewhere for the customer to sign with a finger. */
function SignaturePad({ padRef, onDrawn, onClear }: {
  padRef: React.MutableRefObject<HTMLCanvasElement | null>;
  onDrawn: () => void; onClear: () => void;
}) {
  const { t } = useApp();
  const drawing = useRef(false);

  useEffect(() => {
    const c = padRef.current;
    if (!c) return;
    // Match the backing store to the element, or the line lands away from the
    // finger on any screen that is not exactly 1×.
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#2A211A";
  }, []);

  const at = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="card">
      <div className="between">
        <span className="k">{t("signature")}</span>
        <button className="chip" onClick={() => {
          const c = padRef.current;
          if (!c) return;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          onClear();
        }}>{t("clear")}</button>
      </div>
      <canvas ref={padRef}
              style={{
                width: "100%", height: 160, marginTop: 9, touchAction: "none",
                background: "var(--g1)", border: "1px dashed var(--g3)",
                borderRadius: "var(--rs)",
              }}
              onPointerDown={(e) => {
                drawing.current = true;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                const ctx = padRef.current!.getContext("2d")!;
                const p = at(e);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const ctx = padRef.current!.getContext("2d")!;
                const p = at(e);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
              }}
              onPointerUp={() => { if (drawing.current) { drawing.current = false; onDrawn(); } }}
              onPointerLeave={() => { if (drawing.current) { drawing.current = false; onDrawn(); } }} />
      <p className="note">{t("signatureHint")}</p>
    </div>
  );
}
