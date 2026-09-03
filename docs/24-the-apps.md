# 24 — The apps: a kernel and the things built on it

## What changed, and why

The system was a Fastify server with twenty route files and a React app with a
hand-kept list of which screens each of twelve roles could see. It worked, but
two things about that shape kept costing money.

**The nav and the API were two separate sources of truth about the same thing.**
`NAVS` in `App.tsx` said the accountant gets a leads tab; `guard(LEADS)` on
`GET /leads` said the accountant may not read the leads board. Both were
deliberate, neither knew about the other, and the result was a tab that opened
an empty screen. That exact shape of bug — *a nav offering a screen the server
refuses* — has been found and fixed **seven times** in this codebase, most
recently by the audit that produced this change.

**Everything was installed for everybody.** A workshop that buys its timber for
cash still had a purchasing tab. A business that keeps its books in a ledger
still had accounting in every menu it owned. There was no way to say "we do not
do that here" other than telling people not to tap it.

So the system is now **a kernel and a set of apps**. Fifteen of them.

## The shape

```
                         core   (required)
                           │
              ┌────────────┼──────────────┐
           catalog      settings        hr
              │
            sales   (required)
              │
    ┌─────────┼──────────┬─────────┬──────────┬───────────┐
manufacturing  accounting  crm   delivery  maintenance  approvals
    │   │
 quality spec           inventory (required) ── purchase
                             │
                          costing
```

Each app is a folder under `api/src/modules/` and a manifest in
`api/src/kernel/modules.ts` declaring:

| | |
| --- | --- |
| `key` | stable identifier, stored in the database, never renamed in place |
| `nameAr` / `nameEn` / `summary…` | what the owner reads on the Apps screen |
| `depends` | what must be installed underneath it |
| `required` | the system does not exist without it |
| `routes` | the Fastify plugins it contributes |
| `menu` | **the screens it puts in people's menus, and who may open them** |

## The menu is declared beside the routes

This is the point of the whole exercise. A menu entry names its audience with a
**named scope from `scopes.ts`** — the same constant the module's own routes are
guarded with — and the registry **refuses to boot** if it is given anything else:

```
the app registry does not hold together:
  - crm menu /leads uses a role list that is not a named scope in scopes.ts —
    write one there rather than a list here
```

Nine scopes were added by this change, and only because the old nav had listed
its roles by hand, twelve times over, and nobody had ever had to name what those
lists had in common: `BENCH`, `CONFIGURE`, `READ_COSTING`, `READ_STOCK`,
`DELIVERY_RUN`, `READ_SERVICE`, `SPEC_DESK`, `SEES_APPROVALS`.

The web app now asks `GET /modules/menu` and draws whatever comes back. It has
no list of its own to drift.

**It found a real bug the day it was written.** The leads tab was offered to
`LEAD_REPORT` (the showroom *and the accountant*, because the conversion report
is a money question) while the board behind it is guarded by `LEADS` (the
showroom alone). The accountant had a tab that opened an empty screen. The tab
is now scoped to `LEADS`; if the accountant should have the conversion report,
that is a screen decision, not a widening of the board.

## What the boot check enforces

| Fault | Why it must stop the server |
| --- | --- |
| A dependency naming a module that does not exist | It breaks only the screen that needed it, months later |
| A circular dependency | The load order would never settle |
| Two modules claiming the same menu path | One silently shadows the other |
| A menu whose roles are not a named scope | This is the drift, and it is why the file exists |

## Switching an app off

**Setup → الأبليكيشنات.** An app that is switched off **registers no routes at
all** — so it is absent rather than hidden: there is no screen to find and no
endpoint to reach. That is the difference between this and a feature flag.

Two refusals, both deliberate:

- **A required app cannot be switched off.** A business with no catalogue and no
  way to take an order is not using this software.
- **Nor can one another installed app is built on.** Switching the catalogue off
  under sales would leave an order screen that cannot name a product — worse
  than either state alone. The refusal names which apps are in the way.

Apps are loaded when the server starts, so the change takes effect on the next
restart, and the screen says so rather than looking like it worked.

**An app with no row has never been seen by this deployment, and counts as
installed.** An upgrade that adds an app must not leave an existing business
without something it has been using — and must not switch on something nobody
asked for, which is why the row is written the first time the app is seen rather
than assumed either way afterwards.

## What this is not

It is not Odoo. There is no ORM with model inheritance, no XML view
definitions, no `ir.model.access.csv`, and no third-party addon store. What it
takes from Odoo is the part that earns its keep at this size: **an app declares
its own routes, its own menu and its own access in one place, states what it is
built on, and can be switched off by a business that does not do that thing.**

## The file moves that came with it

Two files spanned three apps each and had to be cut for the boundaries to be
real. Route paths are unchanged, which is what let the existing suites verify
the split:

| Was | Became |
| --- | --- |
| `modules/admin/routes.ts` (766 lines) | `core` · `catalog` · `sales` |
| `modules/money/routes.ts` (1327 lines) | `accounting` · `hr` |

The four helpers both halves of the books needed — `money`, `day`, `n`,
`period` — moved to `lib/books.ts` rather than being copied, for the reason this
codebase keeps relearning: a rule written twice is a rule that will differ.
