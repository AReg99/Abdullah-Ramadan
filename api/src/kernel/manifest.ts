import type { FastifyPluginAsync } from "fastify";

/**
 * An app, in the sense a business owner means it.
 *
 * The system is a kernel plus a set of apps — catalogue, sales, manufacturing,
 * purchasing, accounting, after-sales — each owning its own tables, routes,
 * screens and access rules, and each declaring what it needs underneath it. A
 * workshop that keeps its books in a ledger does not install accounting; a shop
 * that buys everything for cash does not install purchasing.
 *
 * Two rules make this worth the structure rather than just being folders:
 *
 *   1. An uninstalled app does not register its routes. It is absent, not
 *      hidden — there is no endpoint to reach and no screen to find.
 *   2. **A module declares its own menu next to its own routes.** The nav used
 *      to be a hand-kept list in the web app, and it drifted from what the API
 *      would actually serve six separate times — a screen offered to somebody
 *      the server then refused. Declared together and filtered by the same
 *      scope constant, that whole class of bug cannot happen.
 */
export type ModuleManifest = {
  /** Stable identifier. Stored in the database; never rename one in place. */
  key: string;
  nameAr: string;
  nameEn: string;
  summaryAr: string;
  summaryEn: string;

  /**
   * Apps that must be installed for this one to work. Resolved at boot, so a
   * missing dependency is a startup failure rather than a 500 in a month.
   */
  depends: string[];

  /**
   * The system does not exist without it. Cannot be uninstalled, and the
   * uninstall route refuses rather than leaving a business unable to sign in.
   */
  required?: boolean;

  /** What this app puts on the server. */
  routes: FastifyPluginAsync[];

  /** What this app puts in people's menus. */
  menu?: MenuEntry[];
};

/**
 * One screen, and who may open it.
 *
 * `scope` is a role list — always one of the named constants from scopes.ts,
 * never a list written out here. The boot check enforces that: a menu entry
 * whose roles are not a recognised scope stops the server, because a menu
 * pointing somewhere its own guard will refuse is exactly the bug this
 * structure exists to make impossible.
 */
export type MenuEntry = {
  /** The path the web app routes on: "/planning". */
  path: string;
  /** A single glyph, matching the app's icon vocabulary. */
  icon: string;
  /** Translation key for the label. */
  labelKey: string;
  /** Which group of the index this sits in: area_floor, area_sell, … */
  area: string;
  /** Who may open it — a named scope from scopes.ts. */
  scope: readonly string[];
  /**
   * A different label for some roles. The showroom calls the costing screen
   * "price changes", because that is the half of it they use.
   */
  labelFor?: { roles: readonly string[]; labelKey: string };
  /**
   * Where this sits in a person's bar. Lower comes first; the first four of
   * whatever a role can see are their daily tabs and the rest go in the index.
   */
  order: number;
};
