/**
 * Who may do what, in one place.
 *
 * These used to be role arrays written inline at each route, and they drifted:
 * the factory manager was grouped with the owner for everything, so he could
 * read the whole staff list, the price list and every customer — and create an
 * OWNER account, which is a way to hand himself the rest. Meanwhile the
 * showroom's own "New order" button called an endpoint that refused it.
 *
 * The rule this file encodes: a person sees the work they do, and money is not
 * part of production's work.
 */

/** Configuration of the business itself: catalogue, branches, stations. */
export const SETUP = ["OWNER"];

/** May read the staff list, add people, and run the crews. */
export const STAFF_ADMIN = ["OWNER", "FACTORY_MANAGER"];

/**
 * Which roles each of those may hand out.
 *
 * Creating an account is the one permission that can manufacture every other
 * one: whoever can mint an OWNER can help themselves to the rest, so no
 * restriction elsewhere survives an unbounded staff form. The factory manager
 * staffs the factory — his crews, his inspectors, his store — and nothing that
 * would let him step outside it or above it.
 */
const GRANTS: Record<string, string[]> = {
  OWNER: ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "GROUP_LEADER", "QC",
          "STOREKEEPER", "SHOWROOM_MANAGER", "SALES_REP", "DRIVER", "ACCOUNTANT"],
  FACTORY_MANAGER: ["SUPERVISOR", "GROUP_LEADER", "QC", "STOREKEEPER", "DRIVER"],
};

/** Roles this person may create, and equally: whose accounts they may edit. */
export const grantableBy = (actorRole: string) => GRANTS[actorRole] ?? [];
export const canGrant = (actorRole: string, target: string) =>
  grantableBy(actorRole).includes(target);

/** Taking an order from a customer. The showroom sells; the factory does not. */
export const SELL = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"];

/**
 * The catalogue: what exists and what it costs.
 *
 * Maintained by the people who sell — they are the ones who know a new model
 * arrived and what it goes for. Destroying a product stays with the owner
 * (SETUP), because that is not a correction, it is a decision.
 */
export const CATALOGUE = [...new Set([...SETUP, ...SELL])];

/** Running the factory: the floor, the queue, the handover. */
export const PRODUCTION = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR"];

/**
 * The whole-factory activity feed: every action by every person, in one list.
 * That is oversight rather than operation — a manager needs the floor and the
 * queue to do the job, not a running record of who did what all day.
 */
export const OVERSIGHT = ["OWNER"];

/**
 * The books: the cash box, supplier invoices, expenses and every report over
 * them. The accountant keeps them and the owner reads them; nobody else has
 * business in the drawer.
 */
export const BOOKS = ["OWNER", "ACCOUNTANT"];

/**
 * Taking money from a customer. The showroom does this at the counter — a
 * deposit is collected where the sale happens, not by whoever keeps the books.
 */
export const COLLECT = ["OWNER", "ACCOUNTANT", "SHOWROOM_MANAGER", "SALES_REP"];

/** May see prices, order values and takings. */
export const MONEY = ["OWNER", "ACCOUNTANT", "SHOWROOM_MANAGER", "SALES_REP"];

/** Anyone who looks at orders at all, whether or not they see the money on them. */
export const READ_ORDERS = [...new Set([...PRODUCTION, ...MONEY])];

/**
 * The store. Whoever moves goods needs to record the movement: the storekeeper
 * and the driver put things on and off shelves all day, and stock that only the
 * office may touch is stock nobody records.
 */
export const STOCK = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "STOREKEEPER",
                      "SHOWROOM_MANAGER", "SALES_REP", "ACCOUNTANT"];

/**
 * Setting up what is tracked, and what it is worth. Costs are on a stock item,
 * so this is narrower than moving goods around.
 */
export const STOCK_ADMIN = ["OWNER", "FACTORY_MANAGER", "ACCOUNTANT"];

/**
 * Taking the register. Whoever is on the floor at seven in the morning has to
 * be able to mark who turned up — the supervisor and the factory manager are
 * there, the accountant is not. They see the day rates, though, which is why
 * this is not wider still.
 */
export const ATTENDANCE = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR", "ACCOUNTANT"];

export const seesMoney = (roleKey: string) => MONEY.includes(roleKey);
