import { useEffect, useState } from "react";
import { Navigate, Route, Routes, NavLink, useLocation } from "react-router-dom";
import { useApp } from "./app-context";
import { Wordmark } from "./logo";
import Login from "./screens/Login";
import Work from "./screens/Work";
import Job from "./screens/Job";
import MyDay from "./screens/MyDay";
import Today from "./screens/Today";
import Floor from "./screens/Floor";
import Orders from "./screens/Orders";
import OrderDetail from "./screens/OrderDetail";
import Scan from "./screens/Scan";
import Labels from "./screens/Labels";
import Setup from "./screens/Setup";
import NewOrder from "./screens/NewOrder";
import Dispatch from "./screens/Dispatch";
import Showroom from "./screens/Showroom";
import { onSyncChange, queued } from "./outbox";
import { startSyncLoop } from "./sync";

type Tab = [string, string, string];

/**
 * What each role gets, rather than one "office" bucket for everyone. The bucket
 * was wrong in both directions: a showroom manager fell through it into the
 * group leader's shop-floor nav and could not do their job at all, and an
 * accountant was handed the setup screens.
 *
 * Roles not listed here work on the floor and get the leader's three tabs.
 */
const NAVS: Record<string, Tab[]> = {
  OWNER: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/dispatch", "⇥", "dispatch"],
    ["/showroom", "⌂", "showroom"], ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"],
    ["/labels", "⌗", "labels"], ["/setup", "⚙", "setup"],
  ],
  FACTORY_MANAGER: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"], ["/labels", "⌗", "labels"],
    ["/setup", "⚙", "setup"],
  ],
  SUPERVISOR: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/labels", "⌗", "labels"],
  ],
  STOREKEEPER: [["/dispatch", "⇥", "dispatch"], ["/labels", "⌗", "labels"], ["/orders", "▤", "orders"]],
  SHOWROOM_MANAGER: [["/showroom", "⌂", "showroom"], ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"]],
  SALES_REP: [["/showroom", "⌂", "showroom"], ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"]],
  ACCOUNTANT: [["/today", "◧", "today"], ["/orders", "▤", "orders"]],
};

const FLOOR: Tab[] = [["/work", "▤", "work"], ["/scan", "⌗", "scan"], ["/myday", "◔", "myday"]];

export default function App() {
  const { me, ready, lang, setLang, t, signOut } = useApp();
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const off = onSyncChange((n, on) => { setPending(n); setOnline(on); });
    startSyncLoop();
    void queued();
    return off;
  }, []);

  if (!ready) return <div className="empty">{t("loading")}</div>;
  if (!me) return <Login />;

  const tabs = NAVS[me.role] ?? FLOOR;
  const office = tabs !== FLOOR;
  const home = tabs[0][0];

  return (
    <div className={`shell${office ? " wide" : ""}`}>
      <div className="top">
        <Wordmark size={19} />
        <span className="sp" />
        <button className="chip" onClick={() => setLang(lang === "ar" ? "en" : "ar")}>
          {lang === "ar" ? "EN" : "ع"}
        </button>
        <button className="chip" onClick={signOut}>{t("signout")}</button>
      </div>

      {!online && <div className="syncbar off">{t("offline")}{pending > 0 && ` · ${pending}`}</div>}
      {online && pending > 0 && <div className="syncbar pend">{pending} {t("pending")}</div>}

      <div className="body">
        <Routes>
          <Route path="/work" element={<Work />} />
          <Route path="/work/:id" element={<Job />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/myday" element={<MyDay />} />
          <Route path="/labels" element={<Labels />} />
          <Route path="/new-order" element={<NewOrder />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/today" element={<Today />} />
          <Route path="/floor" element={<Floor />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/showroom" element={<Showroom />} />
          {/* Landing on the first tab of your own nav, so nobody opens the app
              on a screen their role cannot load. */}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </div>

      <div className="nav">
        {tabs.map(([to, ic, key]) => (
          <NavLink key={to} to={to} className={loc.pathname.startsWith(to) ? "on" : ""}>
            <span className="ic">{ic}</span>{t(key as any)}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
