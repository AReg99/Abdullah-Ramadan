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

/**
 * Every job in the business, in one list.
 *
 * The staff form validated a role against its own hand-typed copy of this,
 * which meant adding a role to the schema left the form rejecting it — the job
 * existed everywhere except the one place somebody could be hired into it.
 * Anything that needs the set of roles reads it from here.
 */
export const ROLE_KEYS = [
  "OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER", "COST_ACCOUNTANT", "SUPERVISOR",
  "GROUP_LEADER", "QC", "STOREKEEPER", "SHOWROOM_MANAGER", "SALES_REP", "DRIVER",
  "ACCOUNTANT",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

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
  // Everything, including their own job — the only account that can.
  OWNER: [...ROLE_KEYS],
  FACTORY_MANAGER: ["PRODUCTION_MANAGER", "SUPERVISOR", "GROUP_LEADER", "QC",
                    "STOREKEEPER", "DRIVER"],
  // Costing is a money job, so staffing it stops with the owner.
};

/** Roles this person may create, and equally: whose accounts they may edit. */
export const grantableBy = (actorRole: string) => GRANTS[actorRole] ?? [];
export const canGrant = (actorRole: string, target: string) =>
  grantableBy(actorRole).includes(target);

/** Taking an order from a customer. The showroom sells; the factory does not. */
export const SELL = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"];

/**
 * Somebody who came in and has not bought yet, and the price we put in front
 * of them. The showroom's own work — the factory has no view of it, and the
 * accountant's ledger starts at the order.
 */
export const LEADS = [...SELL];

/**
 * How many walk-ins became sales, by source and by rep. Wider than working the
 * leads: the owner reads it and never touches one.
 */
export const LEAD_REPORT = [...new Set([...SELL, "ACCOUNTANT"])];

/**
 * The catalogue: what exists and what it costs.
 *
 * Maintained by the people who sell — they are the ones who know a new model
 * arrived and what it goes for. Destroying a product stays with the owner
 * (SETUP), because that is not a correction, it is a decision.
 */
export const CATALOGUE = [...new Set([...SETUP, ...SELL, "COST_ACCOUNTANT"])];

/**
 * Costing: what a piece takes to make, what it therefore has to sell for, and
 * what the margin on it actually is.
 *
 * Deliberately not BOOKS. The accountant keeps the drawer — did we get paid —
 * and the cost accountant answers a different question: was it worth making.
 * Handing either of them the other's screens is how a small business ends up
 * with one person doing both badly.
 */
export const COSTING = ["OWNER", "COST_ACCOUNTANT"];

/**
 * Reading what the costing found, without being able to move a price. The
 * factory manager wants to know which models are losing money on his floor.
 */
export const COSTING_READ = [...new Set([...COSTING, "FACTORY_MANAGER",
                                         "PRODUCTION_MANAGER", "ACCOUNTANT"])];

/**
 * Being told a price moved. The counter is where a price that changed without
 * anybody saying so turns into an argument with a customer.
 */
export const PRICE_NOTICES = [...new Set([...COSTING, ...SELL])];

/** Running the factory: the floor, the queue, the handover. */
export const PRODUCTION = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER", "SUPERVISOR"];

/**
 * Deciding what gets made in what order, and reading where the queue is piling
 * up. Narrower than PRODUCTION on purpose: a supervisor runs the station in
 * front of them, and letting each of them reorder the whole factory is how two
 * stations end up each convinced they are next.
 */
export const PLANNING = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER"];

/**
 * Sending a finished piece out of the factory, and reading the queue waiting to
 * go. The storekeeper loads the van; the production manager decides what is
 * ready to leave.
 */
export const FACTORY_SIDE = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                             "SUPERVISOR", "STOREKEEPER"];

/** Receiving it at the other end, and handing it to the customer. */
export const SHOWROOM_SIDE = ["OWNER", "FACTORY_MANAGER", "SHOWROOM_MANAGER",
                              "SALES_REP", "DRIVER"];

/**
 * Managers legitimately look across every station. Nobody else does: without
 * this, a station-less account — a driver, an unassigned QC inspector — asked
 * for "my station's work" and was handed the entire factory's open job list,
 * because an empty station filter matches everything.
 */
export const CROSS_STATION = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                              "SUPERVISOR"];

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
export const STOCK = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER", "SUPERVISOR",
                      "STOREKEEPER", "SHOWROOM_MANAGER", "SALES_REP", "ACCOUNTANT",
                      "COST_ACCOUNTANT"];

/**
 * Setting up what is tracked, and what it is worth. Costs are on a stock item,
 * so this is narrower than moving goods around.
 */
export const STOCK_ADMIN = ["OWNER", "FACTORY_MANAGER", "ACCOUNTANT", "COST_ACCOUNTANT"];

/**
 * Taking the register. Whoever is on the floor at seven in the morning has to
 * be able to mark who turned up — the supervisor and the factory manager are
 * there, the accountant is not. They see the day rates, though, which is why
 * this is not wider still.
 */
export const ATTENDANCE = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                           "SUPERVISOR", "ACCOUNTANT"];

/**
 * Passing or failing a piece. The inspector's own job, plus the people who
 * answer for the floor — a supervisor has to be able to release a piece when
 * the inspector is off.
 */
export const QUALITY = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER", "SUPERVISOR", "QC"];

/**
 * After-sales: taking the complaint, chasing the repair, closing it.
 *
 * The showroom answers the phone, so they raise it. The factory fixes it, so
 * they schedule it. The accountant reads what it cost, because a model that
 * keeps coming back is a costing question before it is a quality one.
 */
export const SERVICE = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                        "SHOWROOM_MANAGER", "SALES_REP", "ACCOUNTANT"];

/**
 * Recording what happened on a visit. Wider, because the person who actually
 * goes to the house is a carpenter or the driver, and a visit only the office
 * may write down is a visit that gets written down from memory that evening.
 */
export const SERVICE_VISIT = [...new Set([...SERVICE, "SUPERVISOR", "QC",
                                          "GROUP_LEADER", "DRIVER"])];

/**
 * The road. The driver's own job, plus the showroom that answers the phone
 * when a customer asks where their bedroom is.
 */
export const DELIVERY = ["OWNER", "DRIVER", "SHOWROOM_MANAGER", "SALES_REP"];

/**
 * Asking for materials, and seeing what is on order. Deliberately wide: the
 * storekeeper and the floor are the people who know what is running out, and a
 * request only they may raise is a request that gets shouted across a yard
 * instead.
 */
export const PURCHASING = ["OWNER", "FACTORY_MANAGER", "PRODUCTION_MANAGER",
                           "SUPERVISOR", "STOREKEEPER", "ACCOUNTANT"];

/** Approving one. Money, so it stops with the owner. */
export const PURCHASE_APPROVE = ["OWNER"];

/**
 * Answering a request for permission — a discount above somebody's ceiling, a
 * purchase order above what they may commit. The same place the purchase
 * request stops, and for the same reason: whoever can lift a limit on
 * themselves does not have one.
 */
export const APPROVE = ["OWNER"];

/**
 * Setting the ceilings in the first place. Narrower than reading them: every
 * signed-in person may ask what their own limit is, because being told where
 * the line is beats discovering it when a sale is refused at the counter.
 */
export const LIMITS = ["OWNER"];

export const seesMoney = (roleKey: string) => MONEY.includes(roleKey);
