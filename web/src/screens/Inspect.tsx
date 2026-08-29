import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type DefectType, type QcStage } from "../api";

type Row = { defectTypeId: string; qty: string; stationId: string | null; groupId: string | null };

/**
 * الفحص — the verdict.
 *
 * A QC gate used to be closed by tapping Finish, which made "it passed" and
 * "somebody tapped Finish" the same event. Now it asks the one question the
 * whole quality record depends on, and refuses to be closed any other way.
 *
 * Unlike the rest of the floor this does not queue offline: a rework reopens a
 * station and changes what other people see next, so it needs an answer from
 * the server rather than a promise from the phone.
 */
export default function Inspect() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [s, setS] = useState<QcStage | null>(null);
  const [types, setTypes] = useState<DefectType[]>([]);
  const [result, setResult] = useState<"PASS" | "REWORK" | "SCRAP">("PASS");
  const [backTo, setBackTo] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.qcStage(id).then(setS).catch((e: any) => setErr(e?.code ?? "not_found"));
    api.defectTypes().then(setTypes).catch(() => setTypes([]));
  }, [id]);

  if (err) return <div className="empty">{t(err as any)}</div>;
  if (!s) return <div className="empty">{t("loading")}</div>;

  const failing = result !== "PASS";
  // A rejection has to name what was wrong and, for a rework, where it goes —
  // the server refuses either way, so the button does not pretend otherwise.
  const ready = result === "PASS"
    || (rows.some((r) => r.defectTypeId) && (result === "SCRAP" || backTo !== null));

  const addRow = () => setRows([...rows, { defectTypeId: "", qty: "1", stationId: null, groupId: null }]);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  return (
    <>
      <div className="card">
        <span className="k">{t("inspection")}</span>
        <div style={{ marginTop: 6 }}>
          <span className="nm">{s.product.nameAr}</span>
          <span className="sub mono">
            {s.workOrder.code} · {s.product.sku} · {s.workOrder.qty} {t("qty")}
          </span>
          <span className="sub">{s.order.code} · {s.order.customer}</span>
        </div>
      </div>

      {/* What happened last time, so the same fault is not passed twice. */}
      {s.history.length > 0 && (
        <div className="card">
          <span className="k">{t("previousInspections")}</span>
          {s.history.map((h) => (
            <div className="evt" key={h.id}>
              <span style={{ flex: 1 }}>
                <b style={{ color: h.result === "PASS" ? "var(--ok)" : "var(--bad)" }}>
                  {t(`qc_${h.result}` as any)}
                </b>
                <span className="sub">
                  {when(h.at)}{h.by ? ` · ${h.by}` : ""}
                  {h.defects.length > 0 && ` · ${h.defects.map((d) => d.nameAr).join("، ")}`}
                </span>
                {h.note && <span className="sub">{h.note}</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <span className="k">{t("verdict")}</span>
        <div className="row" style={{ marginTop: 9 }}>
          {(["PASS", "REWORK", "SCRAP"] as const).map((r) => (
            <button key={r} style={{ whiteSpace: "nowrap" }}
                    className={`btn sm ${result === r
                      ? (r === "PASS" ? "pri" : "dang") : "sec"}`}
                    onClick={() => {
                      setResult(r);
                      if (r !== "PASS" && rows.length === 0) addRow();
                    }}>
              {t(`qc_${r}` as any)}
            </button>
          ))}
        </div>
        <p className="note">{t(`qcHint_${result}` as any)}</p>
      </div>

      {result === "REWORK" && (
        <div className="card">
          <span className="k">{t("sendBackTo")}</span>
          {s.reworkTargets.length === 0 && <p className="note">{t("noEarlierStage")}</p>}
          {s.reworkTargets.map((r) => (
            <button key={r.seq} className={`btn sm ${backTo === r.seq ? "pri" : "sec"}`}
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setBackTo(r.seq);
                      // Whoever worked that station is the obvious answer for
                      // who is accountable; it stays editable.
                      setRows((cur) => cur.map((x) =>
                        x.stationId ? x : { ...x, stationId: r.stationId, groupId: r.groupId }));
                    }}>
              {ar ? r.nameAr : r.nameEn}
            </button>
          ))}
        </div>
      )}

      {failing && (
        <div className="card">
          <span className="k">{t("whatIsWrong")}</span>
          {rows.map((r, i) => (
            <div key={i} style={{ marginTop: 10 }}>
              <select value={r.defectTypeId}
                      onChange={(e) => setRow(i, { defectTypeId: e.target.value })}>
                <option value="">{t("pickDefect")}</option>
                {types.map((d) => (
                  <option key={d.id} value={d.id}>{ar ? d.nameAr : d.nameEn}</option>
                ))}
              </select>
              <div className="row" style={{ marginTop: 8 }}>
                <input className="mono" inputMode="numeric" placeholder={t("qty")} value={r.qty}
                       onChange={(e) => setRow(i, { qty: e.target.value })} style={{ flex: 1 }} />
                {rows.length > 1 && (
                  <button className="btn sec sm"
                          onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                    {t("remove")}
                  </button>
                )}
              </div>
            </div>
          ))}
          <button className="btn sec sm" style={{ marginTop: 10 }} onClick={addRow}>
            {t("addDefect")}
          </button>
          <p className="note">{t("defectHint")}</p>
        </div>
      )}

      <div className="card">
        <span className="k">{t("note")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} style={{ marginTop: 8 }} />
      </div>

      <button className={`btn ${result === "PASS" ? "pri" : "dang"}`}
              style={{ marginTop: 12 }} disabled={busy || !ready}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.qcVerdict(id, {
                    result,
                    ...(result === "REWORK" ? { reworkToSeq: backTo! } : {}),
                    note: note.trim() || undefined,
                    defects: failing
                      ? rows.filter((r) => r.defectTypeId).map((r) => ({
                          defectTypeId: r.defectTypeId,
                          qty: Number(r.qty) || 1,
                          stationId: r.stationId, groupId: r.groupId,
                        }))
                      : [],
                  });
                  toast(t(`qcDone_${result}` as any));
                  nav("/work");
                } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                finally { setBusy(false); }
              }}>
        {t(`qcAct_${result}` as any)}
      </button>
    </>
  );
}
