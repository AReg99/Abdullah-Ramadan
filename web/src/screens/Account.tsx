import { useState } from "react";
import { useApp } from "../app-context";
import { api } from "../api";

/**
 * Your own account, reachable by every role from the top bar.
 *
 * Changing a password used to live inside Setup, which most of the factory
 * cannot open — so a leader given a password by the owner was stuck with it.
 * This is the one screen everybody has.
 */
export default function Account() {
  const { t, lang, me, toast } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const mismatch = again.length > 0 && next !== again;
  const ready = current.length > 0 && next.length >= 6 && next === again && !busy;

  const submit = async () => {
    setBusy(true);
    try {
      await api.changeMyPassword(current, next);
      setCurrent(""); setNext(""); setAgain("");
      toast(t("passwordChanged"));
    } catch (e: any) {
      toast(e?.code === "current_password_wrong" ? t("current_password_wrong")
          : e?.code === "password_unchanged" ? t("password_unchanged")
          : t("signInFailed"));
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="card">
        <span className="k">{t("myAccount")}</span>
        <div style={{ marginTop: 8, fontWeight: 600, fontSize: "1.1rem" }}>
          {lang === "ar" ? me?.nameAr : me?.nameEn}
        </div>
        <div className="sub">
          {t(me?.role as any)}
          {me?.phone && <> · <span className="mono">{me.phone}</span></>}
        </div>
      </div>

      <div className="card">
        <span className="k">{t("changePassword")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("changePasswordHint")}</p>

        <span className="k" style={{ display: "block", marginTop: 10 }}>{t("currentPassword")}</span>
        <input type="password" autoComplete="current-password" value={current}
               onChange={(e) => setCurrent(e.target.value)} style={{ marginTop: 7 }} />

        <span className="k" style={{ display: "block", marginTop: 10 }}>{t("newPassword")}</span>
        <input type="password" autoComplete="new-password" value={next}
               onChange={(e) => setNext(e.target.value)} style={{ marginTop: 7 }} />

        <span className="k" style={{ display: "block", marginTop: 10 }}>{t("repeatPassword")}</span>
        <input type="password" autoComplete="new-password" value={again}
               onChange={(e) => setAgain(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && ready) void submit(); }}
               style={{ marginTop: 7 }} />

        {mismatch && <p className="note" style={{ color: "var(--bad)" }}>{t("passwordsDiffer")}</p>}
        {next.length > 0 && next.length < 6 && <p className="note">{t("passwordTooShort")}</p>}

        <button className="btn pri sm" style={{ marginTop: 12 }} disabled={!ready}
                onClick={() => void submit()}>
          {busy ? t("loading") : t("saveAccount")}
        </button>
      </div>
    </>
  );
}
