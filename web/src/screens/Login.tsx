import { useState } from "react";
import { useApp } from "../app-context";
import { api, token } from "../api";
import { Wordmark } from "../logo";

export default function Login() {
  const { t, lang, setLang, setMe } = useApp();
  const [mode, setMode] = useState<"worker" | "office">("worker");
  const [phone, setPhone] = useState("+201000000010");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("owner@aura.test");
  const [pw, setPw] = useState("aura1234");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<any>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.code ?? "error"); } finally { setBusy(false); }
  };

  return (
    <div className="shell">
      <div className="body" style={{ paddingTop: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 30 }}><Wordmark size={40} /></div>

        <div className="row" style={{ marginBottom: 18 }}>
          <button className={`btn sm ${mode === "worker" ? "pri" : "sec"}`} onClick={() => setMode("worker")}>{t("worker")}</button>
          <button className={`btn sm ${mode === "office" ? "pri" : "sec"}`} onClick={() => setMode("office")}>{t("office")}</button>
        </div>

        {mode === "worker" ? (
          <>
            <span className="k">{t("phone")}</span>
            <input className="mono" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ marginTop: 7 }} />
            {sent && (
              <>
                <div style={{ height: 11 }} />
                <span className="k">{t("code")}</span>
                <input className="mono" value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="1234" style={{ marginTop: 7 }} />
                <p className="note">{t("devHint")}</p>
              </>
            )}
            <div style={{ height: 15 }} />
            {!sent ? (
              <button className="btn pri" disabled={busy}
                onClick={() => run(async () => { await api.requestOtp(phone); setSent(true); })}>
                {t("sendCode")}
              </button>
            ) : (
              <button className="btn pri" disabled={busy}
                onClick={() => run(async () => {
                  const r = await api.verifyOtp(phone, code || "1234");
                  token.set(r.token); setMe(r.user);
                })}>
                {t("enter")}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="k">{t("email")}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ marginTop: 7 }} />
            <div style={{ height: 11 }} />
            <span className="k">{t("password")}</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 7 }} />
            <div style={{ height: 15 }} />
            <button className="btn pri" disabled={busy}
              onClick={() => run(async () => {
                const r = await api.login(email, pw);
                token.set(r.token); setMe(r.user);
              })}>
              {t("enter")}
            </button>
          </>
        )}

        {err && <p className="note" style={{ color: "var(--bad)" }}>{err}</p>}
        <div style={{ height: 20 }} />
        <button className="chip" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {lang === "ar" ? "English" : "عربي"}
        </button>
      </div>
    </div>
  );
}
