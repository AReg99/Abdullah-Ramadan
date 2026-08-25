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

/** Reference data you need in order to sell: what exists and what it costs. */
export const CATALOGUE = [...new Set([...SETUP, ...SELL])];

/** Running the factory: the floor, the queue, the handover. */
export const PRODUCTION = ["OWNER", "FACTORY_MANAGER", "SUPERVISOR"];

/**
 * The whole-factory activity feed: every action by every person, in one list.
 * That is oversight rather than operation — a manager needs the floor and the
 * queue to do the job, not a running record of who did what all day.
 */
export const OVERSIGHT = ["OWNER"];

/** May see prices, order values and takings. */
export const MONEY = ["OWNER", "ACCOUNTANT", "SHOWROOM_MANAGER", "SALES_REP"];

/** Anyone who looks at orders at all, whether or not they see the money on them. */
export const READ_ORDERS = [...new Set([...PRODUCTION, ...MONEY])];

export const seesMoney = (roleKey: string) => MONEY.includes(roleKey);
