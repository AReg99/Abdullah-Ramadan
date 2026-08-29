# Aura — Factory & Showroom Management System

**نظام أورا لإدارة المصنع والمعرض**

Built for **Aura Furniture**. Fully bilingual: Arabic and English, with true
right-to-left layout — Arabic is the default on the factory floor, in the
showroom, and for the customer.

A single system that tracks a piece of furniture from the moment a customer walks
into the showroom until it is installed in their home — and gives the owner one
live view over the whole thing.

It is built around one idea: **every physical event in the factory produces a
digital event**, and everything else (the owner's dashboard, the showroom's
promise date, the customer's tracking link, the monthly report) is a projection
of that one event stream.

## The problem it solves

| Today (without a system) | With Aura |
| --- | --- |
| Showroom promises "20 days", factory never agreed to it | Promise date is computed from real factory capacity before the customer signs |
| Owner calls the factory manager to ask "where is order 412?" | Owner opens the order and sees the exact stage, who is working on it, and photos |
| Custom orders live in WhatsApp screenshots and paper sketches | Custom spec, drawings, revisions and the customer's approval are attached to the order line |
| Nobody knows why an order was late | Every stage has a start/finish timestamp and a blocked-reason |
| Material runs out mid-production | BOM reserves material at order confirmation; shortage alert fires before the job starts |
| Customer calls the showroom 5 times to ask "is it ready?" | Customer gets a tracking link and automatic WhatsApp updates |

## Who uses it

Eleven roles across three places — factory, showroom, and the road. See
[Roles & permissions](docs/02-roles-and-permissions.md).

The owner is a first-class user, not an admin afterthought: there is a dedicated
owner app with a live floor view, an approvals inbox, and scheduled reports.

## Standard vs. customized purchases

Both are supported as first-class flows, not one bolted onto the other:

- **Standard** — a catalogue product, possibly with a few pre-priced options
  (fabric, finish). Can be sold from showroom stock, factory stock, or
  made-to-stock. Short path, no design approval.
- **Custom** — customer-specific dimensions, materials, or a piece designed from
  scratch. Adds a design brief, technical drawing, revision history, a priced
  quotation, an explicit customer approval with signature, and a deposit gate
  before any material is cut.

An order can contain both kinds of lines at once. Each line runs its own
lifecycle and carries its own promise date; the order is delivered when its lines
are ready, or in split shipments if the customer prefers.

## Running the code

Phase 1 — the tracking spine — is built and runs: Fastify + Prisma + PostgreSQL
behind a React client, in Arabic and English.

- **[MAC.md](MAC.md)** — running it on a Mac and installing it on a phone, one
  command, with the offline test worth trying
- **[DEPLOY.md](DEPLOY.md)** — hosting it so phones work anywhere, and the honest
  answer on the App Store
- **[RUNNING.md](RUNNING.md)** — general setup, the loop worth seeing, and what
  is deliberately not built yet

```
api/   Fastify + Prisma + PostgreSQL — auth, work flow, photos, dashboard, orders
web/   React + Vite — worker app and owner console, RTL-first
```

## Documentation

| Doc | What is in it |
| --- | --- |
| [01 — System overview](docs/01-overview.md) | Modules, how factory and showroom connect, the event model |
| [02 — Roles & permissions](docs/02-roles-and-permissions.md) | Eleven roles, what each can see and do |
| [03 — Order lifecycle](docs/03-order-lifecycle.md) | State machines for standard and custom orders, production routing, QC and rework |
| [04 — Data model](docs/04-data-model.md) | Tables, key fields, relationships, event codes |
| [05 — Screens](docs/05-screens.md) | Screen-by-screen breakdown per app |
| [06 — Notifications & reports](docs/06-notifications-and-reports.md) | The rule engine, the full notification matrix, the owner's report pack |
| [07 — Technical architecture](docs/07-tech-architecture.md) | Stack, offline sync, hardware, security, integrations |
| [08 — Roadmap](docs/08-roadmap.md) | Five phases, what ships when, rollout and adoption plan |
| [09 — Arabic & English](docs/09-localization.md) | The bilingual specification: RTL rules, fonts, formats, and the full EN↔AR terminology glossary |
| [10 — Design system & brand](docs/10-design-system.md) | Token architecture, the one-file brand swap, components, density modes, the logo system |
| [11 — Money & the books](docs/11-money-and-books.md) | Sales and purchase invoices, the cash box, collections, the accountant's reports |
| [**User guide**](docs/guide/README.md) | How to actually use the app, one short guide per role, in Arabic and English |

## Design principles

1. **The scan is the system.** If a worker has to type, the data will be wrong.
   Every stage transition is a QR scan and one button press.
2. **Arabic first, RTL first.** The factory floor and the showroom work in
   Arabic. English is the secondary locale, not the other way round.
3. **Offline is normal, not an edge case.** Factory Wi-Fi drops. The worker app
   queues events locally and syncs idempotently.
4. **Nothing is deleted.** Corrections are new events. The audit trail is what
   makes the owner's reports trustworthy.
5. **A promise date is a commitment, not a guess.** It comes from station
   capacity, and when it changes, everyone downstream is told automatically.
