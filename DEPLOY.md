# Getting Aura onto phones for real

Three questions get conflated here, so this separates them.

| Question | Answer |
| --- | --- |
| Can it be on my phone like an app? | **Yes, today** — install the PWA. Icon on the home screen, fullscreen, no browser. |
| Can it work when my Mac is off? | **Only once the server is hosted.** This is the real blocker. |
| Can it be on the App Store? | **Decided against** — this is an internal tool for Aura staff, so store distribution adds cost and review delays for no reach you need. |

The ordering matters: an App Store app that talks to a server on your Mac is a
dead icon the moment you close the laptop. **Host first.**

---

## 1. Host it — the step that actually matters

Once the API is on a server with a domain, the phone works anywhere: at the
factory, at home, on mobile data. The PWA becomes a genuine app, and the camera
and Add to Home Screen work without certificate warnings, because the domain has
a real certificate.

### What you need

- A domain, or a subdomain of one you own — **~$10–13 a year**. See below.
- A server that meets the five requirements below.
- Point the domain's A record at the server's IP.

### Where to buy the domain

Any registrar works. Three sensible choices:

| Registrar | .com / year | Why |
| --- | --- | --- |
| **Cloudflare** | ~$10.44 | Sold at cost with no markup, and **the same price at renewal**. Free WHOIS privacy. Its DNS panel is the clearest place to set the record you need. |
| **Porkbun** | ~$9.73 | Flat — registers and renews at the same price. Cheapest of the three today. |
| **Hetzner** | €12.99 | Slightly dearer, but it is the same account and the same invoice as the server. Fewer logins to keep track of. |

Watch for registrars advertising a cheap first year and a much higher renewal —
a domain you keep for five years costs whatever it renews at, not what it
registers at.

**One setting that matters.** After you add the A record pointing at the server,
make sure the record is **DNS only**, not proxied. On Cloudflare that is the
grey cloud, not the orange one. With the proxy on, Caddy cannot complete the
Let's Encrypt challenge and no certificate is ever issued — the site simply
never comes up, with nothing obviously wrong in the logs. You can turn the proxy
on later once the certificate exists, if you want it.

### What the server has to be

Provider does not matter. These five things do:

| Requirement | Why |
| --- | --- |
| **A VPS or cloud server, not shared hosting** | Shared and cPanel hosting cannot run Docker. This is the one that catches people out — the cheapest plan on most hosts is shared, and it will not work. If the plan does not give you root over SSH, it is the wrong plan. |
| **2 GB RAM or more** | Postgres, the API and the web server together. 1 GB will run but will not survive a photo-heavy day. |
| **20 GB+ disk** | The database is small; the photos grow. Roughly 2.5 MB per unit produced. |
| **Ports 80 and 443 reachable** | Caddy needs both to obtain and renew the certificate. |
| **Ubuntu or Debian** | What the setup assumes. Anything else works but you are on your own. |

Providers that meet all five, at roughly the same price:

### If everything shows as unavailable

Two possibilities, and they need different fixes:

- **Stock.** Hetzner genuinely runs out. Try each German and Finnish location
  individually before concluding anything — availability differs per data
  centre, and the plan numbering changes (the entry plan is **CX23** now, not
  CX22).
- **Your account.** A brand new account can be limited to zero resources until
  Hetzner verifies it, which looks exactly like everything being sold out. Check
  your inbox for a verification request, or ask their support. If this is the
  cause, changing provider will not help but will be quicker.

### You may not need 2 GB

The 2 GB minimum exists because PostgreSQL wants its own memory. Run
**`docker-compose.lite.yml`** instead and there is no database server at all —
the database is a single SQLite file.

For one factory that is not a compromise. The load is a few thousand events a
day from a handful of phones, well inside what SQLite handles without noticing,
and the backup becomes one file instead of a dump. **A 1 GB server is enough**,
which puts nearly every provider's cheapest plan back on the table.

```bash
docker compose -f docker-compose.lite.yml --env-file .env.prod up -d --build
```

Move to `docker-compose.prod.yml` when you outgrow it — several factories, or
many people writing at once. The schema and the code are identical; only the
database changes.

**Which Hetzner plan.** CX is Intel-only and regularly sells out; if it is not
offered, that is normal and not a problem. Any of these works:

| Plan | | ~€/month | Notes |
| --- | --- | --- | --- |
| **CAX11** | 2 Arm vCPU · **4 GB** · 40 GB | ~4.99 inc. IPv4 | Best value — twice the RAM for the same money. Arm, which this is built for. Germany and Finland only |
| **CPX11** | 2 AMD vCPU · 2 GB · 40 GB | ~4.99 | x86, available in every location. Meets the minimum with nothing spare |
| **CX22** | 2 Intel vCPU · 4 GB · 40 GB | ~4 | The original suggestion, when it is in stock |

Take **CAX11** if Falkenstein, Nuremberg or Helsinki is offered. The images all
build for Arm, and the Prisma client declares Arm and x86 targets explicitly, so
the same deployment works either way.

If a plan shows as unavailable, try a different German location before changing
plan — stock varies by data centre.

| Provider | ~Cost for 2 GB | Region nearest Egypt | Notes |
| --- | --- | --- | --- |
| Hetzner | €4–5 | Germany / Finland | Best value when in stock |
| **Netcup** | **~€3.50–5** | Germany | German, long-established, usually has stock. Strong alternative |
| Vultr | ~$10 | Frankfurt / Amsterdam / Paris | Nine EU cities, availability rarely a problem |
| Contabo | €5–6 | Germany | Cheapest per GB — see the note below |
| Linode / Akamai | ~$12 | Frankfurt | Dependable, dearer |
| DigitalOcean | ~$18 | Frankfurt / Amsterdam | Easiest console, most expensive here |
| InterServer | $6 | United States only | Price locked for life; ~150 ms from Egypt |

On the lite deployment above, the 1 GB tier at any of these works, which is
roughly half these prices.

**On Contabo specifically:** it is a real German provider and this would run on
it. Its selling point is far more RAM and disk per euro than anyone else — which
is exactly what this workload does not need. What it trades away is consistency:
CPU is more heavily shared than at Hetzner, disk throughput is more variable, and
support is slower to answer. For a database-backed app that a factory depends on
during a shift, steady beats generous. Choose Contabo if you later want a lot of
RAM cheaply; for this, the smaller Hetzner box is the better machine.

**On InterServer specifically:** the VPS is a fine fit — $6/month gets 1 core,
2 GB RAM, 30 GB SSD and 2 TB of transfer, and they lock the signup price for
good, which is unusual and genuinely worth something. Two cautions:

1. **Buy the VPS, not the shared hosting.** Their headline cheap plan is shared
   hosting and cannot run this at all.
2. **All their data centers are in the United States.** From Egypt that is
   roughly 130–160 ms of latency, against 60–80 ms to Germany. For this app it
   is a mild annoyance rather than a problem — the floor app queues everything
   locally and never waits on the network, and photo uploads are already in the
   background — but page loads will feel a step slower than they need to.

If the price lock and familiarity matter more to you than 80 ms, InterServer is
a perfectly reasonable choice. If you have no attachment to either, a German
provider is physically closer to your factory.

### On Netcup specifically

Netcup delivers a VPS differently from most providers, so the first ten minutes
are unfamiliar:

1. **Check the contract length at checkout.** Netcup's headline monthly price
   usually assumes a 12-month term, and some plans carry a one-time setup fee.
   Neither is a problem — just know what you are agreeing to before you click.
2. **The server arrives empty.** Log into the **SCP** (Server Control Panel,
   separate from the shop account — the credentials come in their own email),
   find your VPS, and install **Ubuntu 24.04** from the image list. Nothing
   works until you do this.
3. **Get the root password** from SCP or the welcome email, then connect:
   `ssh root@YOUR-SERVER-IP`
4. **Add your SSH key and turn off password login.** A server with a password on
   port 22 is found by scanners within hours:
   ```bash
   ssh-copy-id root@YOUR-SERVER-IP          # from your Mac
   # then on the server:
   sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
   systemctl restart ssh
   ```
5. **Install Docker:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```

Netcup has no cloud firewall in front of the machine, so what is exposed is
whatever the server exposes: SSH, and the 80 and 443 that Caddy needs. The
database and the API are not published to the host — only Caddy is — so there
is nothing else to close. Note that `ufw` does **not** filter Docker-published
ports, so do not rely on it for that.

**VPS 500 G12 is comfortably enough** — 2 vCores and 4 GB means you can run the
full PostgreSQL deployment rather than the lite one, and 128 GB of disk is years
of photos.

### Then

```bash
git clone https://github.com/AReg99/Abdullah-Ramadan.git
cd Abdullah-Ramadan
git checkout claude/furniture-factory-tracking-k4psgd

cp .env.prod.example .env.prod
# Fill in DOMAIN, and generate the two secrets:
#   openssl rand -hex 32   → JWT_SECRET
#   openssl rand -hex 24   → POSTGRES_PASSWORD

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

### Start empty, not with demo data

A real factory should not begin holding three invented orders for three
invented customers. Seed for production instead:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api \
  env SEED_DEMO=0 OWNER_EMAIL=you@yourdomain OWNER_PASSWORD='a-long-password' \
  npx tsx prisma/seed.ts
```

That installs only what the system cannot run without — the factory, the eight
stations and the standard routing with its photo gates — plus your owner
account. Everything else you enter yourself under **Setup**.

### Your first hour in the app

1. Sign in as the owner.
2. **Setup → Products** — add your categories, then your products with real
   prices.
3. **Setup → Crews** — create a group per station, add its leader with a phone
   number and a password, then add the workers in that crew. Workers never sign
   in; they exist so their output is still credited to them.
4. Send each leader the address and their phone number and password. They open
   it once and tap **Add to Home Screen**.
5. **New order** — enter a real order. Confirming it creates the work order,
   every stage from the routing, and a QR label per unit.
6. **Labels → Print all**, attach them to the pieces, and the floor can start
   scanning.

### Back it up from day one

```bash
./scripts/backup.sh /path/to/backups
```

Database and photos, with old copies pruned after 30 days. Put it on a cron:

```
0 2 * * *  cd /path/to/Abdullah-Ramadan && ./scripts/backup.sh
```

Then copy that folder somewhere off the machine. A backup on the same disk as
the database is not a backup.

Caddy obtains a certificate from Let's Encrypt automatically and renews it. The
app, the API and the uploaded photos are all served from one origin, so there is
no CORS to configure and the service worker's scope stays intact.

Open `https://your-domain` on any phone → **Add to Home Screen**. Done.

### What the API refuses to do in production

It exits at startup rather than run insecurely:

- `JWT_SECRET` missing, shorter than 32 characters, or still the dev default
- `DEV_OTP` set at all — in development the sign-in code is fixed at `1234` and
  returned in the response so the flow is testable. In production that would
  make a worker's phone number the only credential needed to sign in as them.

**Consequence worth planning for:** with `DEV_OTP` off and SMS not yet built
(Phase 4), worker sign-in codes go to the server log and nowhere else. For a
pilot, sign workers in yourself. Before a real rollout, wire an SMS provider —
that is a small piece of work in `api/src/auth/routes.ts`.

---

## 2. Sharing it inside the factory

Decided: **no App Store.** For a tool only Aura staff use, the store adds a
yearly fee, review delays on every update, and rejection risk under Apple's
guideline 4.2, in exchange for reach you do not want.

Distribution is instead just a link. Once hosted:

- Send the address to each group leader over WhatsApp.
- They open it once and tap **Add to Home Screen**.
- It installs with the Aura icon and opens fullscreen.
- Updates reach every phone the moment you deploy — nobody updates anything.

Only people you create accounts for can sign in, so a leaked link exposes a
login screen and nothing else. Deactivate an account and that phone stops
working immediately.

<details>
<summary>What the App Store would have involved, for the record</summary>



**I cannot publish it for you.** Not a limitation of the code: publishing is
bound to an Apple account, a legal identity, and a signing certificate that only
you can hold.

What it takes:

| Step | Who | Cost |
| --- | --- | --- |
| Apple Developer Program membership | You — your Apple ID and legal identity | **$99/year** |
| A Mac with Xcode | You | free |
| Wrap the web app as a native shell (Capacitor) | I can do this | — |
| Signing certificate and provisioning profile | You, in your account | — |
| App Store review | Apple | days to weeks |
| Google Play, if you want Android too | You | $25 once |

**Apple frequently rejects apps that are only a website in a wrapper**
(guideline 4.2, "minimum functionality"). An internal factory tool has a decent
case, but expect questions. If it is only for your own staff, the App Store may
be the wrong distribution channel anyway — see below.

### Better options for an internal tool

- **The PWA.** Already built, already works, installs to the home screen. No
  review, no fee, and an update is a deploy — no waiting for Apple.
- **Apple Business Manager / custom app distribution** — for apps only your
  company uses. Still needs the $99 membership, but avoids public review.
- **TestFlight** — up to 100 internal testers, much lighter review. Good for a
  factory pilot.

### If you still want a native build

Say so and I will add Capacitor: it wraps the existing app in a real iOS and
Android project, keeps one codebase, and gives you genuine native camera and
push notifications instead of the browser's. You would then open the generated
Xcode project on your Mac, sign it with your Apple ID, and install it on your
phone directly — no App Store needed for your own device, though a free Apple ID
certificate expires every 7 days and a paid one lasts a year.

</details>

---

## 3. Before any of this is a real deployment

Honest list of what is still missing:

- **No test suite.** Everything has been verified by hand.
- **SMS delivery** for sign-in codes. Not blocking any more: group leaders sign
  in with a phone number and a password you set in Setup. SMS would let them
  reset it themselves.
- **Photo storage** is a local disk volume, with no retention policy applied and
  no offsite backup.
- **Offsite backups.** `scripts/backup.sh` exists and is tested; putting it on a
  cron and copying the results off the machine is yours to do.
- **No monitoring or error reporting.** Sentry or similar.
- **Phases 2–5** — materials, costing, the showroom configurator, delivery, the
  customer tracking page, the report pack.
