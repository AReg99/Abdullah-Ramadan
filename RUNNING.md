# Running Aura

Phase 1 — the tracking spine. Node 22, PostgreSQL 16.

## Quickest way in

```bash
git clone https://github.com/AReg99/Abdullah-Ramadan.git
cd Abdullah-Ramadan
git checkout claude/furniture-factory-tracking-k4psgd
docker compose up --build        # then open http://localhost:8080
```

Docker Compose brings up Postgres, the API and the web app, creating the schema
and seeding it on first run. **The compose path has not been executed** — there
is no Docker daemon in the environment it was written in, so it is validated
YAML and standard Dockerfiles, not a tested run. The manual path below *has*
been run end to end.

## Install it on a phone

The web app is a PWA. Open it on the phone's browser and use **Add to Home
Screen** — it installs with the Aura droplet as its icon and opens fullscreen,
with no browser chrome. That is the closest thing to "downloading the app";
there is no app-store build, and for a factory-floor tool a PWA is usually the
right answer anyway: no store review, and an update is a deploy.

The phone must reach the machine running it, so use the host's LAN address
(`http://192.168.x.x:8080`) rather than `localhost`. Note that the **camera and
service worker need HTTPS** on anything that is not `localhost` — put it behind
a TLS terminator, or use a tunnel, before testing capture on a real phone.

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

## Print labels, then scan them

Sign in as the owner → **الملصقات / Labels** → **Print all**. Each label carries a
QR of the unit serial. Print on synthetic stock, not paper — it has to survive
dust and finish overspray.

Then as a worker, **امسح / Scan** reads the QR with the camera where the browser
supports `BarcodeDetector`, and always accepts a typed serial as a fallback,
because a scanner that fails with no fallback stops the line.

## Working with no signal

Turn the phone's network off and keep working. Every action is written to an
IndexedDB outbox with its own id and the device clock, and the banner shows how
many are waiting. When the connection returns the queue drains in order.

Two properties make that safe, and both are verified:

- **Replay is a no-op.** The same action sent twice produces one event and one
  state change, because the server is idempotent on `clientEventId`.
- **The device clock wins.** An action taken at 09:12 that syncs at 11:40 is
  recorded as having occurred at 09:12, so offline work does not distort the
  productivity numbers.

Reference data — the job list and job cards — is cached on first view so a job
can be opened with no signal. Writes never come from that cache; the outbox owns
them.

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

- **Photo retention**, thumbnailing, and object storage. Photos are written to
  local disk, and nothing expires them yet.
- **Tests.** The flow has been driven end to end in a browser and via the API,
  and the QR codes were decoded to prove they scan — but there is no test suite,
  so none of that is guarded against regression.
- **HTTPS.** Required for the camera and the service worker on anything that is
  not `localhost`. Not configured.
- **The Docker path is untested** (see above).
- **Push notifications**, the notification rule engine, and scheduled reports.
