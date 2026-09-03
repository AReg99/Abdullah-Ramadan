import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useApp } from "../app-context";
import { Wordmark } from "../logo";
import type { MenuEntry } from "../api";
import { useCrumbValue } from "./crumb";

/**
 * The office shell: an app rail, a breadcrumb, and the record underneath.
 *
 * The phone shell — five tabs and an index behind the fifth — is right for the
 * floor and wrong for a desk. Somebody doing the books for two hours on a
 * 24-inch screen does not want four tabs and a sheet; they want every app one
 * click away and to know where they are.
 *
 * **The floor never sees this.** A group leader, an inspector and a driver work
 * on a phone in a workshop, and the shell they have is the one their job needs.
 * This is chosen by role and by screen width, so the same account signing in on
 * a phone still gets the phone.
 */
export function Desk({ menu, badgeOf, children, onSignOut }: {
  menu: MenuEntry[];
  badgeOf: (path: string) => number;
  children: ReactNode;
  onSignOut: () => void;
}) {
  const { t, lang, setLang, me } = useApp();
  const loc = useLocation();
  const named = useCrumbValue();
  const [apps, setApps] = useState(false);
  const [rail, setRail] = useState(true);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setApps(false); }, [loc.pathname]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setApps(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  // Which app the current screen belongs to — the first crumb.
  const here = menu.find((m) => loc.pathname.startsWith(m.path));

  /**
   * The trail. Two crumbs is the honest depth of this system: the app, and the
   * record inside it. Inventing a deeper hierarchy would be decoration.
   */
  const crumbs: { label: string; to?: string }[] = [];
  if (here) crumbs.push({ label: t(here.labelKey as any), to: here.path });
  // The record's own name where the screen published one; nothing at all
  // otherwise. A database key in a breadcrumb is worse than no breadcrumb.
  if (named) crumbs.push({ label: named });

  const groups = [...new Map(menu.map((m) => [m.module, [] as MenuEntry[]])).keys()]
    .map((mod) => [mod, menu.filter((m) => m.module === mod)] as const);

  return (
    <div className={`desk${rail ? "" : " narrow"}`}>
      <aside className="rail">
        <div className="rail-top">
          <button className="railbtn" onClick={() => setRail(!rail)}
                  title={t("collapse")} aria-label={t("collapse")}>☰</button>
          {rail && <Wordmark size={17} />}
        </div>
        <nav className="rail-nav">
          {menu.map((m) => (
            <NavLink key={m.path} to={m.path}
                     className={({ isActive }) => `railitem${isActive ? " on" : ""}`}
                     title={t(m.labelKey as any)}>
              <span className="ic">
                {m.icon}
                {badgeOf(m.path) > 0 && <span className="badge">{badgeOf(m.path)}</span>}
              </span>
              {rail && <span className="lbl">{t(m.labelKey as any)}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="deskmain">
        <header className="deskbar">
          <button className="railbtn" onClick={() => setApps(true)}
                  title={t("allApps")} aria-label={t("allApps")}>⊞</button>
          <nav className="crumbs" aria-label={t("whereAmI")}>
            {crumbs.length === 0 && <span className="crumb now">{t("home")}</span>}
            {crumbs.map((c, i) => (
              <span key={i} className="crumbwrap">
                {i > 0 && <span className="sep" aria-hidden="true">/</span>}
                {c.to && i < crumbs.length - 1
                  ? <NavLink to={c.to} className="crumb">{c.label}</NavLink>
                  : <span className="crumb now">{c.label}</span>}
              </span>
            ))}
          </nav>
          <span className="sp" />
          <button className="chip" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
            {lang === "ar" ? "EN" : "ع"}
          </button>
          <NavLink to="/account" className="chip" style={{ textDecoration: "none" }}>
            {me ? (lang === "ar" ? me.nameAr : me.nameEn) : t("myAccount")}
          </NavLink>
          <button className="chip" onClick={onSignOut}>{t("signout")}</button>
        </header>

        <main className="deskbody">{children}</main>
      </div>

      {apps && (
        <div className="appsheet" onClick={() => setApps(false)}>
          <div className="appsheet-in" ref={sheetRef} onClick={(e) => e.stopPropagation()}>
            <span className="k">{t("allApps")}</span>
            <div className="appgrid">
              {groups.map(([mod, list]) =>
                list.map((m) => (
                  <NavLink key={m.path} to={m.path} className="appit"
                           onClick={() => setApps(false)}>
                    <span className="ic">
                      {m.icon}
                      {badgeOf(m.path) > 0 && <span className="badge">{badgeOf(m.path)}</span>}
                    </span>
                    <span>{t(m.labelKey as any)}</span>
                    <span className="modname">{mod}</span>
                  </NavLink>
                )))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
