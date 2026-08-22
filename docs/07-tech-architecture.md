# 07 — Technical architecture

## Shape: a modular monolith

One factory, a handful of showrooms, maybe 100–300 concurrent users. Microservices
would add deployment cost and distributed-transaction pain for no benefit. Build a
**modular monolith** — the eleven modules of doc 01 as separate modules with
explicit boundaries and no cross-module table access, only service calls. If a
module ever needs to be extracted, the seam is already there.

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  Owner app   │ Factory web  │ Worker app   │ Showroom app │  Driver app  │
│ (RN + web)   │   (React)    │ (RN, offline)│ (React, tab) │ (RN, offline)│
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘
       └──────────────┴──── REST + WebSocket ───────┴──────────────┘
                              │
                    ┌─────────▼──────────┐        ┌────────────────────┐
                    │   API (NestJS)     │        │  Public tracking   │
                    │  auth · RBAC · i18n│        │  page (Next.js)    │
                    └─────────┬──────────┘        └────────────────────┘
                              │
   ┌──────────┬───────────────┼───────────────┬───────────────┐
   │          │               │               │               │
┌──▼───┐ ┌────▼────┐ ┌────────▼────────┐ ┌────▼─────┐ ┌───────▼────────┐
│Postgres│ │  Redis  │ │ BullMQ workers  │ │ S3/MinIO │ │ WhatsApp/SMS/  │
│        │ │ cache + │ │ notifications,  │ │  photos, │ │ push providers │
│        │ │ pub/sub │ │ reports, sched. │ │  PDFs    │ │                │
└────────┘ └─────────┘ └─────────────────┘ └──────────┘ └────────────────┘
```

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| API | **NestJS (TypeScript)** | Module system matches the design; one language across API, web and mobile; large hiring pool in Egypt |
| DB | **PostgreSQL 16** | jsonb for specs/answers, strong constraints, window functions for the reports |
| ORM | **Prisma** or TypeORM | Migrations in version control |
| Cache / queue | **Redis + BullMQ** | Scheduled reports, notification dispatch with retries, at-risk sweep |
| Realtime | **WebSocket (Socket.IO)** | Live floor view, planning board, worker task list |
| Files | **S3-compatible (MinIO on-prem or AWS S3)** | Photos are the bulk of storage; client-side compression before upload |
| Mobile | **React Native (Expo)** | One codebase for owner/worker/driver apps; camera, QR, push, offline SQLite |
| Web | **React + Vite**, Next.js for the public tracking page | SSR only where SEO/first-paint matters |
| Charts | Recharts / ECharts | |
| Auth | JWT access + refresh, RBAC from `roles.permissions`, optional OTP login by phone for workers | Workers remember phone numbers, not passwords |
| Search | Postgres full-text | No Elasticsearch until it is genuinely needed |
| Observability | Sentry + structured logs + a `/health` endpoint | |
| PDF | Puppeteer templates | Quotations, invoices, reports, delivery notes |
| Labels | ZPL for Zebra, ESC/POS for thermal | Direct printing from the web console |

## Offline-first sync (worker & driver apps)

The factory floor and the customer's flat both lose signal. The rule: **the app
never blocks on the network.**

1. Every action writes to a local SQLite outbox with a `client_event_id` (UUID),
   a device `occurred_at`, and the payload.
2. A background sync loop POSTs batches to `/events/sync`.
3. The server is idempotent on `client_event_id` — a retry is a no-op, and a
   double-tap cannot double-count.
4. Reference data (today's work orders, product specs, drawings, the manifest)
   is pre-cached on login and refreshed opportunistically.
5. Conflicts are resolved by ordering on `occurred_at`; a stage finish arriving
   before its start is repaired server-side and flagged for the supervisor rather
   than rejected.
6. Device clock skew is measured at each sync and corrected, so a phone with the
   wrong date does not poison the productivity reports.

## Hardware you need in the factory

| Item | Qty | Note |
| --- | --- | --- |
| Label printer (Zebra-class, thermal transfer) | 1–2 | Unit labels must survive sanding dust and finish fumes — use synthetic labels, not paper |
| Android tablets or rugged phones at stations | 1 per station | Or use workers' own phones with a shared station account |
| Wi-Fi access points covering the floor | as needed | Offline sync covers the gaps, but coverage reduces lag |
| Tablet per sales rep | 1 each | Configurator + signature capture |
| Thermal receipt printer per showroom | 1 each | Deposits |
| Phone per driver | 1 each | Camera + GPS required |

## Security

- HTTPS only, HSTS. Passwords via Argon2id.
- RBAC enforced server-side on every endpoint — never trust the client's role.
- Row-level scoping: a sales rep's queries are filtered to their own customers, a
  showroom's to its own location.
- The customer tracking token is a signed, expiring, revocable random token
  scoped to one order. Guessing it is infeasible; it exposes only
  customer-visible events.
- Cost and margin fields are stripped server-side for roles without the
  permission, not hidden in the UI.
- Full audit log on every write, immutable, retained.
- Daily encrypted database backups with a tested restore, plus point-in-time
  recovery. Photos replicated separately.
- Personal data (customer phone, address) is exportable and deletable on request.

## Localisation

Arabic and English, with full RTL layout (not just translated strings — mirrored
navigation, icons, and charts). Arabic is the default for worker, showroom and
customer surfaces. Dates in the Gregorian calendar with Arabic numerals as a user
preference. Currency EGP, formatted per locale.

## Integrations

| System | Direction | Purpose |
| --- | --- | --- |
| WhatsApp Business API | out | Customer notifications, quotation and invoice delivery |
| SMS gateway | out | Fallback when WhatsApp fails |
| Firebase Cloud Messaging | out | Staff push notifications |
| Payment gateway (Paymob / Fawry) | both | Deposit and balance links on the tracking page |
| Accounting (Odoo / QuickBooks / local ERP) | out | Nightly export of invoices, payments, stock valuation |
| Google Maps | out | Route optimisation and navigation |
| Instagram / website catalogue | out | Publish products and lead capture into `INQUIRY` |

Keep the accounting integration a one-way nightly export at first. Two-way
financial sync is a project of its own and is not on the critical path.

## Scale and performance targets

- 300 concurrent users, 5,000 tracking events/day, 3-year retention.
- API p95 < 300 ms; dashboards read from materialised views refreshed on a
  schedule rather than aggregating the event table live.
- Photos compressed to ~200 KB on-device before upload; thumbnails generated
  server-side.
- A single 8 GB / 4 vCPU application server plus a managed Postgres covers this
  comfortably. Deploy on a local cloud provider or a VPS in-region for latency;
  keep MinIO on-prem if photo volume makes cloud storage expensive.
