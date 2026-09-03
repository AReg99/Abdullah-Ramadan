import type { ModuleManifest } from "./manifest.js";
import * as S from "../auth/scopes.js";

import authRoutes from "../auth/routes.js";
import coreRoutes from "../modules/core/routes.js";
import settingsRoutes from "../modules/settings/routes.js";
import photoRoutes from "../modules/photos/routes.js";
import dashboardRoutes from "../modules/dashboard/routes.js";
import catalogRoutes from "../modules/catalog/routes.js";
import salesRoutes from "../modules/sales/routes.js";
import orderRoutes from "../modules/orders/routes.js";
import flowRoutes from "../modules/flow/routes.js";
import workRoutes from "../modules/work/routes.js";
import planningRoutes from "../modules/planning/routes.js";
import labelRoutes from "../modules/labels/routes.js";
import qualityRoutes from "../modules/quality/routes.js";
import stockRoutes from "../modules/stock/routes.js";
import purchasingRoutes from "../modules/purchasing/routes.js";
import accountingRoutes from "../modules/accounting/routes.js";
import hrRoutes from "../modules/hr/routes.js";
import costingRoutes from "../modules/costing/routes.js";
import leadRoutes from "../modules/leads/routes.js";
import serviceRoutes from "../modules/service/routes.js";
import deliveryRoutes from "../modules/delivery/routes.js";
import approvalRoutes from "../modules/approvals/routes.js";
import specRoutes from "../modules/spec/routes.js";

/**
 * The apps this system is made of.
 *
 * Read top to bottom this is the dependency order: nothing here depends on
 * anything below it. `required` means the system does not exist without it — a
 * business with no catalogue and no way to take an order is not using this
 * software — and everything else can be switched off by a business that does
 * not do that thing.
 *
 * Each app declares its own menu next to its own routes, guarded by the same
 * named scope. That is the whole reason for the structure: the nav used to be a
 * separate hand-kept list, and it drifted from what the server would serve six
 * times over.
 */
export const MODULES: ModuleManifest[] = [
  {
    key: "core",
    nameAr: "الأساسي", nameEn: "Core",
    summaryAr: "الدخول، الموظفين، المجموعات، الفروع والمحطات، وإعدادات الشركة.",
    summaryEn: "Sign-in, staff, crews, branches and stations, company settings.",
    depends: [], required: true,
    routes: [authRoutes, coreRoutes, settingsRoutes, photoRoutes, dashboardRoutes],
    menu: [
      { path: "/today", icon: "◧", labelKey: "today", area: "area_floor",
        scope: S.PRODUCTION, order: 20 },
      { path: "/floor", icon: "▦", labelKey: "floor", area: "area_floor",
        scope: S.PRODUCTION, order: 30 },
      { path: "/setup", icon: "⚙", labelKey: "setup", area: "area_admin",
        scope: S.CONFIGURE, order: 900 },
    ],
  },
  {
    key: "catalog",
    nameAr: "الكتالوج", nameEn: "Catalogue",
    summaryAr: "المنتجات، الأقسام، الأسعار، والمواصفات المطلوبة لكل منتج.",
    summaryEn: "Products, categories, prices, and what must be decided about each.",
    depends: ["core"], required: true,
    routes: [catalogRoutes],
  },
  {
    key: "sales",
    nameAr: "المبيعات", nameEn: "Sales",
    summaryAr: "كتابة الأوردر، متابعته، الفاتورة، وتسليمه للمعرض.",
    summaryEn: "Taking an order, following it, invoicing it, handing it over.",
    depends: ["core", "catalog"], required: true,
    routes: [salesRoutes, orderRoutes, flowRoutes],
    menu: [
      { path: "/orders", icon: "▤", labelKey: "orders", area: "area_sell",
        scope: S.READ_ORDERS, order: 100 },
      { path: "/new-order", icon: "✎", labelKey: "newOrder", area: "area_sell",
        scope: S.SELL, order: 110 },
      { path: "/showroom", icon: "⌂", labelKey: "showroom", area: "area_sell",
        scope: S.DELIVERY, order: 90 },
      { path: "/dispatch", icon: "⇥", labelKey: "dispatch", area: "area_sell",
        scope: S.FACTORY_SIDE, order: 80 },
      { path: "/summary", icon: "◈", labelKey: "summary", area: "area_money",
        scope: S.BOOKS, order: 10 },
    ],
  },
  {
    key: "manufacturing",
    nameAr: "التصنيع", nameEn: "Manufacturing",
    summaryAr: "أوامر الشغل، المراحل، شغل البنك، التخطيط والمواعيد، والملصقات.",
    summaryEn: "Work orders, stages, the bench, planning and promise dates, labels.",
    depends: ["sales"], required: true,
    routes: [workRoutes, planningRoutes, labelRoutes],
    menu: [
      { path: "/work", icon: "▤", labelKey: "work", area: "area_floor",
        scope: S.BENCH, order: 10 },
      { path: "/scan", icon: "⌗", labelKey: "scan", area: "area_floor",
        scope: S.BENCH, order: 15 },
      { path: "/myday", icon: "◔", labelKey: "myday", area: "area_floor",
        scope: S.BENCH, order: 40 },
      { path: "/planning", icon: "≡", labelKey: "planning", area: "area_floor",
        scope: S.PLANNING, order: 25 },
      { path: "/labels", icon: "⌗", labelKey: "labels", area: "area_floor",
        scope: S.FACTORY_SIDE, order: 60 },
    ],
  },
  {
    key: "spec",
    nameAr: "المواصفات", nameEn: "Spec",
    summaryAr: "اللي لازم يتحدد قبل ما القطعة تتعمل، وأسئلة المصنع للمعرض.",
    summaryEn: "What must be decided before a piece is made, and the bench's questions.",
    depends: ["sales", "manufacturing"],
    routes: [specRoutes],
    menu: [
      { path: "/spec", icon: "◫", labelKey: "specTab", area: "area_sell",
        scope: S.SPEC_DESK, order: 120 },
    ],
  },
  {
    key: "quality",
    nameAr: "الجودة", nameEn: "Quality",
    summaryAr: "الفحص عند البوابات، العيوب، وتقرير الجودة.",
    summaryEn: "Inspection at the gates, defects, and the quality report.",
    depends: ["manufacturing"],
    routes: [qualityRoutes],
    menu: [
      { path: "/quality", icon: "◎", labelKey: "quality", area: "area_floor",
        scope: S.QUALITY, order: 50 },
    ],
  },
  {
    key: "inventory",
    nameAr: "المخزن", nameEn: "Inventory",
    summaryAr: "الأصناف، الحركات، الجرد، وقايمة خامات كل منتج.",
    summaryEn: "Items, movements, stocktakes, and each product's bill of materials.",
    depends: ["catalog"], required: true,
    routes: [stockRoutes],
    menu: [
      { path: "/stock", icon: "▥", labelKey: "stock", area: "area_store",
        scope: S.READ_STOCK, order: 200 },
    ],
  },
  {
    key: "purchase",
    nameAr: "المشتريات", nameEn: "Purchasing",
    summaryAr: "النواقص، طلب الشراء، أمر الشراء، الاستلام، والمطابقة الثلاثية.",
    summaryEn: "Shortages, requests, purchase orders, receipts, three-way match.",
    depends: ["inventory"],
    routes: [purchasingRoutes],
    menu: [
      { path: "/purchasing", icon: "⇩", labelKey: "purchasing", area: "area_store",
        scope: S.PURCHASING, order: 210 },
    ],
  },
  {
    key: "accounting",
    nameAr: "الحسابات", nameEn: "Accounting",
    summaryAr: "الخزنة، الفواتير، التحصيل، المديونيات، الأرباح، والضريبة.",
    summaryEn: "The cash box, invoices, collections, debts, profit and VAT.",
    depends: ["sales"],
    routes: [accountingRoutes],
    menu: [
      { path: "/money", icon: "₤", labelKey: "money", area: "area_money",
        scope: S.BOOKS, order: 300 },
    ],
  },
  {
    key: "hr",
    nameAr: "الحضور والمرتبات", nameEn: "Attendance & payroll",
    summaryAr: "الحضور والغياب، ومسيّر المرتبات الأسبوعي والشهري.",
    summaryEn: "Attendance, and the weekly and monthly payroll run.",
    depends: ["core"],
    routes: [hrRoutes],
    menu: [
      { path: "/attendance", icon: "✓", labelKey: "attendance", area: "area_floor",
        scope: S.ATTENDANCE, order: 55 },
      { path: "/payroll", icon: "☰", labelKey: "payroll", area: "area_money",
        scope: S.BOOKS, order: 310 },
    ],
  },
  {
    key: "costing",
    nameAr: "التكاليف", nameEn: "Costing",
    summaryAr: "تكلفة القطعة الحقيقية، الهامش، والسعر اللي لازم تتباع بيه.",
    summaryEn: "What a piece really costs, the margin, and what it must sell for.",
    depends: ["catalog", "inventory", "manufacturing"],
    routes: [costingRoutes],
    menu: [
      { path: "/costing", icon: "%", labelKey: "costing", area: "area_money",
        scope: S.READ_COSTING, order: 320,
        // The showroom uses the half of this screen that tells them a price
        // moved, so that is what the tab says to them.
        labelFor: { roles: S.SELL, labelKey: "cost_changes" } },
    ],
  },
  {
    key: "approvals",
    nameAr: "الموافقات", nameEn: "Approvals",
    summaryAr: "حدود الخصم والشراء لكل وظيفة، وطلبات تجاوزها.",
    summaryEn: "Discount and purchase ceilings per role, and requests to exceed them.",
    depends: ["sales"],
    routes: [approvalRoutes],
    menu: [
      { path: "/approvals", icon: "✓", labelKey: "approvals", area: "area_money",
        scope: S.SEES_APPROVALS, order: 330 },
    ],
  },
  {
    key: "crm",
    nameAr: "العملاء المحتملين", nameEn: "Leads & quotations",
    summaryAr: "مين دخل المعرض، السعر مكتوب، وتحويله لأوردر.",
    summaryEn: "Who walked in, the price in writing, and turning it into an order.",
    depends: ["sales"],
    routes: [leadRoutes],
    menu: [
      // LEADS, not LEAD_REPORT: the accountant belongs to the second because
      // the conversion report is a money question, but the tab opens the
      // *board*, which is guarded by the first. Offering it to them handed
      // them a screen the API refuses — which is exactly the pairing this
      // structure exists to make impossible.
      { path: "/leads", icon: "☏", labelKey: "leadsTab", area: "area_sell",
        scope: S.LEADS, order: 70 },
    ],
  },
  {
    key: "delivery",
    nameAr: "التسليم", nameEn: "Delivery",
    summaryAr: "خط سير السواق، إثبات التسليم، والمحاولات اللي ماتمتش.",
    summaryEn: "The driver's run, proof of delivery, and attempts that failed.",
    depends: ["sales"],
    routes: [deliveryRoutes],
    menu: [
      { path: "/run", icon: "⇢", labelKey: "run", area: "area_sell",
        scope: S.DELIVERY_RUN, order: 130 },
    ],
  },
  {
    key: "maintenance",
    nameAr: "ما بعد البيع", nameEn: "After-sales",
    summaryAr: "الشكاوى، الضمان، وزيارات الفنيين.",
    summaryEn: "Complaints, warranty, and technicians' visits.",
    depends: ["sales", "catalog"],
    routes: [serviceRoutes],
    menu: [
      { path: "/service", icon: "⚒", labelKey: "service", area: "area_sell",
        scope: S.READ_SERVICE, order: 140 },
    ],
  },
];

export type ManifestList = ModuleManifest[];
