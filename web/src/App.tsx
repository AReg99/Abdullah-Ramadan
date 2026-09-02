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
import Service from "./screens/Service";
import Leads from "./screens/Leads";
import Costing from "./screens/Costing";
import Spec from "./screens/Spec";
import QuoteDoc from "./screens/QuoteDoc";
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
    ["/leads", "☏", "leadsTab"], ["/service", "⚒", "service"],
    ["/costing", "%", "costing"], ["/spec", "◫", "specTab"], ["/setup", "⚙", "setup"],
  ],
  // Runs the factory. Not the business: setup and order entry are the owner's,
  // and the showroom's, and money never appears on these screens.
  FACTORY_MANAGER: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/planning", "≡", "planning"],
    ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/labels", "⌗", "labels"], ["/stock", "▥", "stock"],
    ["/attendance", "✓", "attendance"], ["/quality", "◎", "quality"],
    ["/purchasing", "⇩", "purchasing"], ["/service", "⚒", "service"],
    ["/costing", "%", "costing"], ["/spec", "◫", "specTab"], ["/setup", "⚙", "setup"],
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
    ["/service", "⚒", "service"], ["/spec", "◫", "specTab"],
  ],
  // Works out what a piece takes to make and what it therefore has to sell
  // for. The catalogue and the store's costs are theirs; the cash box is the
  // accountant's, and hiring is nobody's but the owner's.
  COST_ACCOUNTANT: [
    ["/costing", "%", "costing"], ["/stock", "▥", "stock"],
    ["/setup", "⚙", "setup"],
  ],
  SUPERVISOR: [
    ["/today", "◧", "today"], ["/floor", "▦", "floor"], ["/dispatch", "⇥", "dispatch"],
    ["/orders", "▤", "orders"], ["/labels", "⌗", "labels"],
    ["/attendance", "✓", "attendance"], ["/quality", "◎", "quality"],
    ["/purchasing", "⇩", "purchasing"], ["/spec", "◫", "specTab"],
  ],
  // The dispatch board is their queue, and a scanned label names the piece in
  // their hand. The whole order book is not part of the job.
  STOREKEEPER: [["/dispatch", "⇥", "dispatch"], ["/stock", "▥", "stock"],
                ["/purchasing", "⇩", "purchasing"], ["/labels", "⌗", "labels"]],
  SHOWROOM_MANAGER: [["/showroom", "⌂", "showroom"], ["/run", "⇢", "run"],
                     ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"],
                     ["/leads", "☏", "leadsTab"], ["/stock", "▥", "stock"],
                     ["/service", "⚒", "service"], ["/costing", "%", "cost_changes"],
                     ["/spec", "◫", "specTab"],
                     ["/approvals", "✓", "approvals"], ["/setup", "⚙", "setup"]],
  SALES_REP: [["/leads", "☏", "leadsTab"], ["/showroom", "⌂", "showroom"],
              ["/orders", "▤", "orders"], ["/new-order", "✎", "newOrder"],
              ["/spec", "◫", "specTab"],
              ["/costing", "%", "cost_changes"], ["/service", "⚒", "service"],
              ["/approvals", "✓", "approvals"], ["/setup", "⚙", "setup"]],
  // On the road between the factory and the showroom: what is on the van, and
  // signing it in when it lands.
  DRIVER: [["/run", "⇢", "run"], ["/service", "⚒", "service"],
           ["/showroom", "⌂", "showroom"]],
  // Not the ops dashboard — that is guarded to production roles, and pointing
  // the accountant at it landed them on a 403 the moment they signed in.
  // The books are the whole job: the cash box, the invoices, what is owed.
  ACCOUNTANT: [["/summary", "◈", "summary"], ["/money", "₤", "money"],
               ["/costing", "%", "costing"], ["/leads", "☏", "leadsTab"],
               ["/payroll", "☰", "payroll"], ["/attendance", "✓", "attendance"],
               ["/stock", "▥", "stock"], ["/purchasing", "⇩", "purchasing"],
               ["/approvals", "✓", "approvals"], ["/orders", "▤", "orders"]],
  // QC stands at a station like a leader does, so they get the floor tabs.
  QC: [["/work", "▤", "work"], ["/scan", "⌗", "scan"],
       ["/quality", "◎", "quality"], ["/myday", "◔", "myday"]],
};

const FLOOR: Tab[] = [["/work", "▤", "work"], ["/scan", "⌗", "scan"], ["/myday", "◔", "myday"]];

/**
 * Five tabs, and everything else behind one more.
 *
 * The owner's nav had grown to twenty-one. A phone shows about five, so the
 * other sixteen lived in a horizontal scroll nobody knew to drag — screens that
 * exist, that the person is entitled to, and that they will never find.
 *
 * The first four of a role's list are their day; the fifth button opens the
 * whole index. The order inside NAVS is already deliberate, so nothing else has
 * to be decided here.
 */
const DAILY = 4;

/**
 * Which part of the business a screen belongs to, for the index.
 *
 * A grid of twenty icons is as unfindable as a scroll of twenty tabs. Grouped,
 * somebody looking for the cash box knows which third of the screen to look at.
 */
const AREA: Record<string, string> = {
  "/today": "area_floor", "/floor": "area_floor", "/planning": "area_floor",
  "/work": "area_floor", "/scan": "area_floor", "/myday": "area_floor",
  "/labels": "area_floor", "/quality": "area_floor", "/attendance": "area_floor",
  "/showroom": "area_sell", "/orders": "area_sell", "/new-order": "area_sell",
  "/leads": "area_sell", "/dispatch": "area_sell", "/run": "area_sell",
  "/service": "area_sell", "/spec": "area_sell",
  "/summary": "area_money", "/money": "area_money", "/payroll": "area_money",
  "/costing": "area_money", "/approvals": "area_money",
  "/stock": "area_store", "/purchasing": "area_store",
  "/setup": "area_admin",
};
const AREAS = ["area_floor", "area_sell", "area_store", "area_money", "area_admin"];

export default function App() {
  const { me, ready, lang, setLang, t, signOut } = useApp();
  const loc = useLocation();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [waiting, setWaiting] = useState(0);
  const [priceNews, setPriceNews] = useState(0);
  const [specNews, setSpecNews] = useState(0);
  const [more, setMore] = useState(false);

  useEffect(() => { setMore(false); }, [loc.pathname]);

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

  /**
   * Prices that moved and the counter has not read.
   *
   * Same reason as the approvals count: a notice nobody is nudged towards is a
   * notice read after the customer has already argued about the price.
   */
  useEffect(() => {
    if (!["SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "")) return;
    api.unseenPrices().then((r) => setPriceNews(r.count)).catch(() => setPriceNews(0));
  }, [me?.role, loc.pathname]);

  /**
   * What the other side of the handover is waiting on.
   *
   * For the counter that is an unanswered question — a bench standing still.
   * For the factory it is a spec change nobody on the floor has taken in yet,
   * which is a piece being made to a spec that is no longer true. Both are
   * counted here because both are somebody else's work stopped.
   */
  useEffect(() => {
    const counter = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "");
    const floor = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER", "SUPERVISOR"]
      .includes(me?.role ?? "");
    if (!counter && !floor) return;
    Promise.all([
      counter ? api.specQuestions(true).then((q) => q.filter((x) => !x.answeredAt).length)
              : Promise.resolve(0),
      floor ? api.unseenSpecChanges().then((c) => c.length) : Promise.resolve(0),
    ]).then(([a, b]) => setSpecNews(a + b)).catch(() => setSpecNews(0));
  }, [me?.role, loc.pathname]);

  if (!ready) return <div className="empty">{t("loading")}</div>;
  if (!me) return <Login />;

  const tabs = NAVS[me.role] ?? FLOOR;
  const office = tabs !== FLOOR;
  const home = tabs[0][0];

  const badgeOf = (to: string) =>
    to === "/approvals" ? waiting
    : to === "/costing" ? priceNews
    : to === "/spec" ? specNews : 0;
  // Four of their own, then everything else behind the fifth.
  const shown = tabs.length <= 5 ? tabs : tabs.slice(0, DAILY);
  const rest = tabs.length <= 5 ? [] : tabs.slice(DAILY);
  const restBadges = rest.reduce((n, [to]) => n + badgeOf(to), 0);

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
          <Route path="/service" element={<Service />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/costing" element={<Costing />} />
          <Route path="/spec" element={<Spec />} />
          <Route path="/quote/:id" element={<QuoteDoc />} />
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

      {more && (
        <MoreSheet tabs={tabs} badgeOf={badgeOf} onClose={() => setMore(false)} />
      )}

      <div className="nav">
        {shown.map(([to, ic, key]) => (
          <NavLink key={to} to={to} className={loc.pathname.startsWith(to) ? "on" : ""}
                   onClick={() => setMore(false)}>
            <span className="ic">
              {ic}
              {badgeOf(to) > 0 && <span className="badge">{badgeOf(to)}</span>}
            </span><span className="lbl">{t(key as any)}</span>
          </NavLink>
        ))}
        {rest.length > 0 && (
          <button className={`navmore${more ? " on" : ""}`} onClick={() => setMore(!more)}>
            <span className="ic">
              {/* The index is a grid of tiles, and this glyph sits at cap height
                  with the rest of the bar — a midline ellipsis dropped to the
                  baseline and read as three small dots beside the badge. */}
              {more ? "✕" : "⊞"}
              {/* Anything waiting behind the button has to be visible on it,
                  or the button is where notices go to be missed. */}
              {restBadges > 0 && !more && <span className="badge">{restBadges}</span>}
            </span><span className="lbl">{more ? t("close") : t("moreTab")}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * كل الشاشات — the whole index, grouped.
 *
 * Everything the person may open, in one place, at a size a thumb can hit.
 * Including the four already on the bar: this is a map, and a map with holes in
 * it sends people back to hunting.
 */
function MoreSheet({ tabs, badgeOf, onClose }: {
  tabs: Tab[]; badgeOf: (to: string) => number; onClose: () => void;
}) {
  const { t } = useApp();
  const groups = AREAS
    .map((area) => [area, tabs.filter(([to]) => (AREA[to] ?? "area_admin") === area)] as const)
    .filter(([, list]) => list.length > 0);
  const loose = tabs.filter(([to]) => !AREA[to]);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-in" onClick={(e) => e.stopPropagation()}>
        {groups.map(([area, list]) => (
          <div key={area} className="sheet-grp">
            <span className="k">{t(area as any)}</span>
            <div className="grid">
              {list.map(([to, ic, key]) => (
                <NavLink key={to} to={to} className="gridit" onClick={onClose}>
                  <span className="ic">
                    {ic}
                    {badgeOf(to) > 0 && <span className="badge">{badgeOf(to)}</span>}
                  </span>
                  <span>{t(key as any)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        {loose.length > 0 && (
          <div className="sheet-grp">
            <div className="grid">
              {loose.map(([to, ic, key]) => (
                <NavLink key={to} to={to} className="gridit" onClick={onClose}>
                  <span className="ic">{ic}</span><span>{t(key as any)}</span>
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
