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
import { onSyncChange, queued } from "./outbox";
import { startSyncLoop } from "./sync";

const OFFICE = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "ACCOUNTANT", "SALES_REP"];

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

  const office = OFFICE.includes(me.role);
  const nav = office
    ? [["/today", "◧", t("today")], ["/floor", "▦", t("floor")], ["/orders", "▤", t("orders")], ["/labels", "⌗", t("labels")]]
    : [["/work", "▤", t("work")], ["/scan", "⌗", t("scan")], ["/myday", "◔", t("myday")]];

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
          <Route path="/today" element={<Today />} />
          <Route path="/floor" element={<Floor />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderDetail />} />
          <Route path="*" element={<Navigate to={office ? "/today" : "/work"} replace />} />
        </Routes>
      </div>

      <div className="nav">
        {nav.map(([to, ic, label]) => (
          <NavLink key={to} to={to} className={loc.pathname.startsWith(to) ? "on" : ""}>
            <span className="ic">{ic}</span>{label}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
