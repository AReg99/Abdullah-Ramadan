import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DICT, type Key, type Lang } from "./i18n";
import { api, token, type Me } from "./api";

type Ctx = {
  lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string;
  me: Me | null; setMe: (m: Me | null) => void;
  ready: boolean; signOut: () => void;
  toast: (msg: string) => void;
};
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem("aura.lang") as Lang) || "ar");
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    localStorage.setItem("aura.lang", lang);
  }, [lang]);

  useEffect(() => {
    if (!token.get()) { setReady(true); return; }
    api.me().then(setMe).catch(() => token.clear()).finally(() => setReady(true));
  }, []);

  const value = useMemo<Ctx>(() => ({
    lang, setLang: setLangState,
    t: (k) => DICT[lang][k] ?? k,
    me, setMe, ready,
    signOut: () => { token.clear(); setMe(null); },
    toast: (m) => { setMsg(m); setTimeout(() => setMsg(null), 2200); },
  }), [lang, me, ready]);

  return (
    <C.Provider value={value}>
      {children}
      {msg && <div className="toast"><div>{msg}</div></div>}
    </C.Provider>
  );
}
