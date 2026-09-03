import { useEffect, useState } from "react";
import { Navigate, Route, Routes, NavLink, useLocation } from "react-router-dom";
import { useApp } from "./app-context";
import { api, type MenuEntry } from "./api";
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
import { Desk } from "./shell/Desk";
import { CrumbProvider } from "./shell/crumb";
import { onSyncChange, queued } from "./outbox";
import { startSyncLoop } from "./sync";

type Tab = [string, string, string];

/**
 * Five tabs, and everything else behind one more.
 *
 * The owner's nav had grown to twenty-two. A phone shows about five, so the
 * rest lived in a horizontal scroll nobody knew to drag — screens that exist,
 * that the person is entitled to, and that they will never find.
 *
 * The first four of a person's screens are their day; the fifth button opens
 * the whole index. The order comes from the modules themselves.
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
/**
 * The order the index groups appear in. Which group a screen belongs to is
 * declared by the module that owns the screen, not listed here — that list was
 * a second copy of the nav and drifted from it like the first one did.
 */
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
  /**
   * The screens this person may open, as the server declares them.
   *
   * This used to be a hand-kept array per role in this file, and it drifted
   * from what the API would actually serve six separate times — a tab offered
   * to somebody the server then refused. Now each app declares its own menu
   * beside its own routes, filtered by the same scope that guards them, so the
   * two cannot disagree.
   */
  const [menu, setMenu] = useState<MenuEntry[] | null>(null);
  /**
   * Wide enough for a desk.
   *
   * The office shell is a rail and a breadcrumb; below this it is worse than
   * the phone shell in every way, so the same account signing in on a phone
   * still gets the phone.
   */
  const [wide, setWide] = useState(() => window.innerWidth >= 1000);

  useEffect(() => { setMore(false); }, [loc.pathname]);

  useEffect(() => {
    if (!me) { setMenu(null); return; }
    api.menu().then(setMenu).catch(() => setMenu([]));
  }, [me?.id]);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1000);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  if (!menu) return <div className="empty">{t("loading")}</div>;

  const tabs: Tab[] = menu.map((e) => [e.path, e.icon, e.labelKey]);
  const areaOf = (path: string) =>
    menu.find((e) => e.path === path)?.area ?? "area_admin";
  // The floor's three screens fit a phone; an office nav needs the wide shell.
  const office = tabs.length > 3 || tabs.some(([p]) => p === "/setup");
  const home = tabs.length ? tabs[0][0] : "/account";

  const badgeOf = (to: string) =>
    to === "/approvals" ? waiting
    : to === "/costing" ? priceNews
    : to === "/spec" ? specNews : 0;
  // Four of their own, then everything else behind the fifth.
  const shown = tabs.length <= 5 ? tabs : tabs.slice(0, DAILY);
  const rest = tabs.length <= 5 ? [] : tabs.slice(DAILY);
  const restBadges = rest.reduce((n, [to]) => n + badgeOf(to), 0);

  /**
   * The floor keeps its phone. A leader, an inspector and a driver work in a
   * workshop on a handset, and the shell their job needs is the one they have —
   * five big targets and a scanner. The desk is for people at a desk.
   */
  const desk = wide && office && !tabs.some(([p]) => p === "/scan");

  const routes = <CrumbProvider><Screens home={home} /></CrumbProvider>;

  if (desk) {
    return (
      <CrumbProvider>
      <Desk menu={menu} badgeOf={badgeOf} onSignOut={signOut}>
        {!online && <div className="syncbar off">{t("offline")}{pending > 0 && ` · ${pending}`}</div>}
        {online && pending > 0 && <div className="syncbar pend">{pending} {t("pending")}</div>}
        <Screens home={home} />
      </Desk>
      </CrumbProvider>
    );
  }

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

      <div className="body">{routes}</div>

      {more && (
        <MoreSheet tabs={tabs} areaOf={areaOf} badgeOf={badgeOf}
                   onClose={() => setMore(false)} />
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
function MoreSheet({ tabs, areaOf, badgeOf, onClose }: {
  tabs: Tab[]; areaOf: (to: string) => string;
  badgeOf: (to: string) => number; onClose: () => void;
}) {
  const { t } = useApp();
  const groups = AREAS
    .map((area) => [area, tabs.filter(([to]) => areaOf(to) === area)] as const)
    .filter(([, list]) => list.length > 0);
  // A screen whose module named a group this shell does not know about still
  // has to appear somewhere.
  const loose = tabs.filter(([to]) => !AREAS.includes(areaOf(to)));

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

/**
 * Every screen, once. Both shells render this — the chrome differs, the app
 * does not, and a route that existed in one and not the other would be a screen
 * somebody can reach from a laptop and not from a phone.
 */
function Screens({ home }: { home: string }) {
  return (
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
  );
}
