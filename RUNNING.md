# Running Aura

Phase 1 — the tracking spine. Node 22, PostgreSQL 16.

## Setup

```bash
# 1. Database
createdb aura                       # or: sudo -u postgres createdb -O aura aura
cd api && cp .env.example .env      # edit DATABASE_URL if your credentials differ

# 2. API
npm install
npx prisma db push                  # creates the tables
npx tsx prisma/seed.ts              # roles, stations, routing, 3 orders
npm run dev                         # http://localhost:4000

# 3. Web (second terminal)
cd ../web && npm install && npm run dev   # http://localhost:5173
```

## Sign in

| Who | Credentials | Lands on |
| --- | --- | --- |
| Owner | `owner@aura.test` / `aura1234` | Today, Floor, Orders |
| Factory manager | `factory@aura.test` / `aura1234` | Today, Floor, Orders |
| Worker — assembly | `+201000000010`, OTP `1234` | My work today |
| Worker — finishing | `+201000000011`, OTP `1234` | My work today |
| Worker — upholstery | `+201000000012`, OTP `1234` | My work today |

The OTP is fixed to `1234` in development and returned in the API response so
the flow is testable without an SMS gateway. `DEV_OTP` must be removed before
any real deployment.

## The loop worth seeing

1. Sign in as the **assembly worker**. One job is waiting — the wardrobe,
   because cutting is already done and assembly is the next ready stage.
2. Press **ابدأ**. The camera opens: assembly is `photoBefore: REQUIRED`, and
   the server returns `428` if you try to start without it. The gate is enforced
   in the API, not just hidden in the UI.
3. Photograph, **استخدم**, and the timer runs.
4. **إيقاف مؤقت** → pick a reason. Paused minutes accrue against that reason.
5. **إنهاء** → the after photo gate, then the stage closes and sanding becomes
   `READY` for the next station automatically.
6. Sign out, sign in as the **owner**. Every action you just took is on **اليوم**
   with your name and station, and the order's timeline has the full chain.

Toggle `ع / EN` anywhere — the whole interface flips, including direction.

## What is here

```
api/            Fastify + Prisma + PostgreSQL
  prisma/       schema (docs/04-data-model.md made real) + seed
  src/auth/     JWT, phone OTP for workers, password for office, RBAC guard
  src/modules/  work · photos · dashboard · orders
  src/lib/      the event recorder — the only writer to the stream
web/            React + Vite, Arabic/English with full RTL
```

## What is not here yet

Phases 2–5: materials, BOM and inventory · purchasing · costing and margin ·
QC checklists and rework · the showroom configurator and quotations · delivery,
the driver app and proof of delivery · the customer tracking page · the report
pack · capacity planning · after-sales. The roadmap in `docs/08-roadmap.md` has
the sequence.

Also not here, and needed before this runs anywhere real:

- **Offline sync.** The client posts directly; the outbox and `client_event_id`
  replay described in `docs/07-tech-architecture.md` are not built. The server
  side is ready for it — `/photos` is already idempotent on `clientEventId`.
- **QR scanning.** `GET /work/label/:serial` resolves a label to its open stage,
  but the camera scanner is not wired to it. Labels are seeded, not printed.
- **Photo retention**, thumbnailing, and object storage. Photos are written to
  local disk.
- **Tests.** The flow has been driven end to end in a browser and via the API,
  but there is no test suite.
