import { useEffect, useState } from "react";
import { Navigate, Route, Routes, NavLink, useLocation } from "react-router-dom";
import { useApp } from "./app-context";
import { api } from "./api";
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
import Account from "./screens/Account";
import Track from "./screens/Track";
import Invoice from "./screens/Invoice";
import Payroll from "./screens/Payroll";
import Voucher from "./screens/Voucher";
import PurchaseDoc from "./screens/PurchaseDoc";
import Summary from "./screens/Summary";
import Stock from "./screens/Stock";
import Attendance from "./screens/Attendance";
import Inspect from "./screens/Inspect";
import Run from "./screens/Run";
import Quality from "./screens/Quality";
import Purchasing from "./screens/Purchasing";
import Approvals from "./screens/Approvals";
import Planning from "./screens/Planning";
import Money from "./screens/Money";
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
    ["/summary", "◈", "summary"],
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/planning", "≡", "planning"],
    ["/dispatch", "⇥", "dispatch"], ["/showroom", "⌂", "showroom"], ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"],
    ["/labels", "⌗", "labels"], ["/stock", "▥", "stock"], ["/money", "₤", "money"],
    ["/attendance", "✓", "attendance"], ["/payroll", "☰", "payroll"],
    ["/quality", "◎", "quality"], ["/run", "⇢", "run"],
    ["/purchasing", "⇩", "purchasing"], ["/approvals", "✓", "approvals"],
    ["/setup", "⚙", "setup"],
  ],
  // Runs the factory. Not the business: setup and order entry are the owner's,
  // and the showroom's, and money never appears on these screens.
  FACTORY_MANAGER: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/planning", "≡", "planning"],
    ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/labels", "⌗", "labels"], ["/stock", "▥", "stock"],
    ["/attendance", "✓", "attendance"], ["/quality", "◎", "quality"],
    ["/purchasing", "⇩", "purchasing"], ["/setup", "⚙", "setup"],
  ],
  // Plans the work rather than running the plant. No setup, no staff form, no
  // money: the queue, the load, and everything needed to judge them — what is
  // on the floor, who turned up, what quality is sending back, and what the
  // store is running out of.
  PRODUCTION_MANAGER: [
    ["/planning", "≡", "planning"], ["/today", "◧", "today"], ["/floor", "▦", "floor"],
    ["/orders", "▤", "orders"], ["/dispatch", "⇥", "dispatch"], ["/labels", "⌗", "labels"],
    ["/quality", "◎", "quality"], ["/attendance", "✓", "attendance"],
    ["/stock", "▥", "stock"], ["/purchasing", "⇩", "purchasing"],
  ],
  SUPERVISOR: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/labels", "⌗", "labels"],
    ["/attendance", "✓", "attendance"], ["/quality", "◎", "quality"],
    ["/purchasing", "⇩", "purchasing"],
  ],
  STOREKEEPER: [["/dispatch", "⇥", "dispatch"], ["/stock", "▥", "stock"],
                ["/purchasing", "⇩", "purchasing"],
                ["/labels", "⌗", "labels"], ["/orders", "▤", "orders"]],
  SHOWROOM_MANAGER: [["/showroom", "⌂", "showroom"], ["/run", "⇢", "run"],
                     ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"],
                     ["/stock", "▥", "stock"], ["/approvals", "✓", "approvals"],
                     ["/setup", "⚙", "setup"]],
  SALES_REP: [["/showroom", "⌂", "showroom"], ["/orders", "▤", "orders"],
              ["/new-order", "✎", "newOrder"], ["/approvals", "✓", "approvals"],
              ["/setup", "⚙", "setup"]],
  // On the road between the factory and the showroom: what is on the van, and
  // signing it in when it lands.
  DRIVER: [["/run", "⇢", "run"], ["/showroom", "⌂", "showroom"]],
  // Not the ops dashboard — that is guarded to production roles, and pointing
  // the accountant at it landed them on a 403 the moment they signed in.
  // The books are the whole job: the cash box, the invoices, what is owed.
  ACCOUNTANT: [["/summary", "◈", "summary"], ["/money", "₤", "money"],
               ["/payroll", "☰", "payroll"], ["/attendance", "✓", "attendance"],
               ["/stock", "▥", "stock"], ["/purchasing", "⇩", "purchasing"],
               ["/approvals", "✓", "approvals"], ["/orders", "▤", "orders"]],
  // QC stands at a station like a leader does, so they get the floor tabs.
  QC: [["/work", "▤", "work"], ["/scan", "⌗", "scan"],
       ["/quality", "◎", "quality"], ["/myday", "◔", "myday"]],
};

const FLOOR: Tab[] = [["/work", "▤", "work"], ["/scan", "⌗", "scan"], ["/myday", "◔", "myday"]];

export default function App() {
  const { me, ready, lang, setLang, t, signOut } = useApp();
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    const off = onSyncChange((n, on) => { setPending(n); setOnline(on); });
    startSyncLoop();
    void queued();
    return off;
  }, []);

  /**
   * How many decisions are standing still waiting for this person.
   *
   * Only the owner is asked for any, and the count is what makes the tab worth
   * looking at — an inbox you have to remember to open is one somebody is
   * waiting on all afternoon. Refreshed on every navigation rather than on a
   * timer: it is the moment they look at the screen that matters.
   */
  useEffect(() => {
    if (me?.role !== "OWNER") return;
    api.waiting().then((w) => setWaiting(w.total)).catch(() => setWaiting(0));
  }, [me?.role, loc.pathname]);

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
        <NavLink to="/account" className="chip" style={{ textDecoration: "none" }}>{t("myAccount")}</NavLink>
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
          {/* What the showroom reads to the customer, as opposed to the
              factory's own record of the same order. */}
          <Route path="/track/:id" element={<Track />} />
          <Route path="/invoice/:id" element={<Invoice />} />
          <Route path="/payroll" element={<Payroll />} />
          <Route path="/voucher/:id" element={<Voucher />} />
          <Route path="/purchase/:id" element={<PurchaseDoc />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/stock" element={<Stock />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/inspect/:id" element={<Inspect />} />
          <Route path="/quality" element={<Quality />} />
          <Route path="/purchasing" element={<Purchasing />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/planning" element={<Planning />} />
          <Route path="/run" element={<Run />} />
          <Route path="/money" element={<Money />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/showroom" element={<Showroom />} />
          {/* Every role has this one. */}
          <Route path="/account" element={<Account />} />
          {/* Landing on the first tab of your own nav, so nobody opens the app
              on a screen their role cannot load. */}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </div>

      <div className="nav">
        {tabs.map(([to, ic, key]) => (
          <NavLink key={to} to={to} className={loc.pathname.startsWith(to) ? "on" : ""}>
            <span className="ic">
              {ic}
              {to === "/approvals" && waiting > 0 && <span className="badge">{waiting}</span>}
            </span>{t(key as any)}
          </NavLink>
        ))}
      </div>
    </div>
  );
}
