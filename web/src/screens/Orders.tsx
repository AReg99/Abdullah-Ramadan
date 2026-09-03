import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../app-context";
import { api, type OrderRow } from "../api";
import { KanbanView, ListView, SearchPanel, ViewSwitch, useSearch,
         type Column, type KanbanCol, type ViewKind } from "../views";

/**
 * The order book, as a collection rather than a screen.
 *
 * The same orders, seen the way the person looking at them needs: a dense table
 * for anybody sorting by value or chasing a date, a board for anybody who wants
 * to know what is sitting where. One search over both, so switching view keeps
 * what you were looking at.
 *
 * On a phone the list falls back to one card per row, because a seven-column
 * table on a handset is a table nobody reads.
 */

/** The board's columns are OrderStatus, in the order an order moves through. */
const STAGES: KanbanCol[] = [
  { key: "DRAFT", label: "st_DRAFT" },
  { key: "QUOTED", label: "st_QUOTED" },
  { key: "CONFIRMED", label: "st_CONFIRMED" },
  { key: "IN_PRODUCTION", label: "st_IN_PRODUCTION" },
  { key: "READY", label: "st_READY", tone: "warn" },
  { key: "DELIVERED", label: "st_DELIVERED", tone: "ok" },
  { key: "CLOSED", label: "st_CLOSED", tone: "ok" },
  { key: "CANCELLED", label: "st_CANCELLED", tone: "bad" },
];

export default function Orders() {
  const { t, lang, me } = useApp();
  const nav = useNavigate();
  // The showroom opens an order to tell a customer where it is, so send them to
  // the tracking view; the factory wants its own record.
  const home = ["SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "") ? "track" : "orders";
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [view, setView] = useState<ViewKind>(() => {
    try { return (localStorage.getItem("aura.orders.view") as ViewKind) || "list"; }
    catch { return "list"; }
  });

  useEffect(() => { api.orders().then(setRows).catch(() => setRows([])); }, []);
  const pick = (v: ViewKind) => {
    setView(v);
    try { localStorage.setItem("aura.orders.view", v); } catch { /* private mode */ }
  };

  const nm = (o: OrderRow) => o.lines.map((l) => (lang === "ar" ? l.productAr : l.productEn));
  const isLate = (o: OrderRow) =>
    Boolean(o.promisedDate) && new Date(o.promisedDate!) < new Date()
    && !["DELIVERED", "CANCELLED"].includes(o.status);
  const money = (v?: number) =>
    v === undefined ? "" : v.toLocaleString(lang === "ar" ? "ar-EG" : "en-GB");
  const date = (s: string | null) =>
    s ? new Date(s).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB",
                                       { day: "2-digit", month: "short" }) : "—";
  const monthOf = (s: string) =>
    new Date(s).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB",
                                   { month: "long", year: "numeric" });

  const s = useSearch(rows ?? [], {
    text: (o) => [o.code, o.customer, o.invoiceNo ?? "", ...nm(o)].join(" "),
    facets: [
      { key: "late", label: t("ordFilterLate"), test: isLate },
      { key: "open", label: t("ordFilterOpen"),
        test: (o) => !["DELIVERED", "CANCELLED"].includes(o.status) },
      { key: "unpaid", label: t("ordFilterUnpaid"),
        test: (o) => o.total !== undefined && (o.total - (o.paidTotal ?? 0)) > 0.5 },
      { key: "month", label: t("ordFilterMonth"),
        test: (o) => new Date(o.createdAt).getMonth() === new Date().getMonth()
                     && new Date(o.createdAt).getFullYear() === new Date().getFullYear() },
    ],
    groupings: [
      { key: "status", label: t("ordGroupStatus"), of: (o) => t(`st_${o.status}` as any) },
      { key: "customer", label: t("ordGroupCustomer"), of: (o) => o.customer },
      { key: "month", label: t("ordGroupMonth"), of: (o) => monthOf(o.createdAt) },
      { key: "showroom", label: t("ordGroupShowroom"),
        of: (o) => (o.showroom ? (lang === "ar" ? o.showroom.nameAr : o.showroom.nameEn) : "—") },
    ],
  });

  if (!rows) return <div className="empty">{t("loading")}</div>;

  const seesMoney = rows.some((o) => o.total !== undefined);
  const open = (o: OrderRow) => nav(`/${home}/${o.id}`);

  const cols: Column<OrderRow>[] = [
    { key: "code", label: t("colCode"), tight: true,
      cell: (o) => <span className="mono nowrap">{o.code}</span>, sort: (o) => o.code },
    { key: "customer", label: t("colCustomer"),
      cell: (o) => <b>{o.customer}</b>, sort: (o) => o.customer },
    { key: "items", label: t("colItems"),
      cell: (o) => <span className="muted">{nm(o).join(" · ")}</span> },
    { key: "promised", label: t("colPromised"), tight: true,
      cell: (o) => (
        <span className={isLate(o) ? "bad-txt nowrap" : "nowrap"}>{date(o.promisedDate)}</span>
      ),
      sort: (o) => o.promisedDate ?? "9999" },
    { key: "status", label: t("colStatus"), tight: true,
      cell: (o) => (isLate(o)
        ? <span className="pill bad">{t("late")}</span>
        : <span className="pill pri">{t(`st_${o.status}` as any)}</span>),
      sort: (o) => o.status },
    ...(seesMoney ? [
      { key: "total", label: t("colTotal"), num: true, tight: true,
        cell: (o: OrderRow) => <span className="mono">{money(o.total)}</span>,
        sort: (o: OrderRow) => o.total ?? 0 },
      { key: "due", label: t("colDue"), num: true, tight: true,
        cell: (o: OrderRow) => {
          const due = (o.total ?? 0) - (o.paidTotal ?? 0);
          return <span className={`mono${due > 0.5 ? " bad-txt" : ""}`}>{money(Math.round(due))}</span>;
        },
        sort: (o: OrderRow) => (o.total ?? 0) - (o.paidTotal ?? 0) },
    ] : []),
  ];

  return (
    <>
      <div className="viewbar">
        <SearchPanel s={s} placeholder={t("labelSearch")} />
        <ViewSwitch view={view} setView={pick} />
      </div>

      {view === "list" ? (
        <ListView rows={s.found} groups={s.groups} cols={cols}
                  onOpen={open} empty={t("noOrders")} />
      ) : (
        <KanbanView
          rows={s.found}
          cols={STAGES.map((c) => ({ ...c, label: t(c.label as any) }))}
          colOf={(o) => o.status}
          onOpen={open}
          empty={t("noOrders")}
          card={(o) => (
            <>
              <div className="between">
                <span className="mono">{o.code}</span>
                {isLate(o) && <span className="pill bad">{t("late")}</span>}
              </div>
              <span className="nm">{o.customer}</span>
              <span className="sub">{nm(o).join(" · ")}</span>
              <div className="between" style={{ marginTop: 6 }}>
                <span className="sub muted">{date(o.promisedDate)}</span>
                {o.total !== undefined && <span className="mono">{money(o.total)}</span>}
              </div>
            </>
          )}
        />
      )}
    </>
  );
}
