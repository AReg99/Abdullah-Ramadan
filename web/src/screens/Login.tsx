import { useState } from "react";
import { useApp } from "../app-context";
import { api, token } from "../api";
import { Wordmark } from "../logo";

/**
 * One way in for everybody: the number you already know, and a password.
 *
 * The old screen offered the floor a code by SMS, which was never built — in
 * production the code is deliberately never returned to the browser, so a group
 * leader picking that tab waited for a message that could not arrive. A password
 * the owner sets in Setup is the honest version of the same thing.
 *
 * The two sections do not change what the server checks; they change what the
 * person in front of the phone is asked for. The owner signs in with the email
 * their account was created with, the floor with a phone number.
 */
export default function Login() {
  const { t, lang, setLang, setMe } = useApp();
  const [who, setWho] = useState<"owner" | "staff">("staff");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwner = who === "owner";

  const signIn = async () => {
    setBusy(true); setErr(null);
    try {
      const value = id.trim();
      // Anything with an @ is an email; everything else is a number, in
      // whatever shape the person happens to write it.
      const r = value.includes("@") ? await api.login(value, pw) : await api.loginByPhone(value, pw);
      token.set(r.token);
      setMe(r.user);
    } catch (e: any) {
      setErr(e?.code === "bad_credentials" ? t("badCredentials") : t("signInFailed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="shell">
      <div className="body" style={{ paddingTop: 40 }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}><Wordmark size={40} /></div>

        <div className="row" style={{ marginBottom: 16 }}>
          <button className={`btn sm ${isOwner ? "pri" : "sec"}`}
                  onClick={() => { setWho("owner"); setErr(null); }}>{t("ownerTab")}</button>
          <button className={`btn sm ${!isOwner ? "pri" : "sec"}`}
                  onClick={() => { setWho("staff"); setErr(null); }}>{t("employeesTab")}</button>
        </div>

        <p className="note" style={{ marginBottom: 14 }}>
          {isOwner ? t("ownerSignInHint") : t("staffSignInHint")}
        </p>

        <span className="k">{isOwner ? t("emailOrPhone") : t("phone")}</span>
        <input
          className="mono"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={isOwner ? "you@aura.com" : "01xxxxxxxxx"}
          autoComplete="username"
          inputMode={isOwner ? "text" : "tel"}
          style={{ marginTop: 7 }}
        />

        <div style={{ height: 11 }} />
        <span className="k">{t("password")}</span>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          onKeyDown={(e) => { if (e.key === "Enter" && id && pw) void signIn(); }}
          style={{ marginTop: 7 }}
        />

        <div style={{ height: 15 }} />
        <button className="btn pri" disabled={busy || !id.trim() || !pw} onClick={() => void signIn()}>
          {busy ? t("loading") : t("enter")}
        </button>

        {err && <p className="note" style={{ color: "var(--bad)", marginTop: 10 }}>{err}</p>}

        <p className="note" style={{ marginTop: 18 }}>{t("forgotHint")}</p>

        <div style={{ height: 16 }} />
        <button className="chip" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {lang === "ar" ? "English" : "عربي"}
        </button>
      </div>
    </div>
  );
}
