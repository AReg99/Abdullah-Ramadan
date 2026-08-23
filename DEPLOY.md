# Getting Aura onto phones for real

Three questions get conflated here, so this separates them.

| Question | Answer |
| --- | --- |
| Can it be on my phone like an app? | **Yes, today** — install the PWA. Icon on the home screen, fullscreen, no browser. |
| Can it work when my Mac is off? | **Only once the server is hosted.** This is the real blocker. |
| Can it be on the App Store? | **Yes, but only you can publish it**, and only after hosting. See below. |

The ordering matters: an App Store app that talks to a server on your Mac is a
dead icon the moment you close the laptop. **Host first.**

---

## 1. Host it — the step that actually matters

Once the API is on a server with a domain, the phone works anywhere: at the
factory, at home, on mobile data. The PWA becomes a genuine app, and the camera
and Add to Home Screen work without certificate warnings, because the domain has
a real certificate.

### What you need

- A small server — 2 GB RAM is plenty. Hetzner, DigitalOcean, Linode: **$5–12
  a month**. Any of them is fine.
- A domain, or a subdomain of one you own — **~$12 a year**.
- Point the domain's A record at the server's IP.

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

## 2. The App Store — what is actually involved

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

**My recommendation: host it first, run the pilot on the PWA, and only wrap it
natively if the PWA turns out to be genuinely insufficient.** Most factory tools
never need to.

---

## 3. Before any of this is a real deployment

Honest list of what is still missing:

- **No test suite.** Everything has been verified by hand.
- **SMS delivery** for worker sign-in codes.
- **Photo storage** is a local disk volume, with no retention policy applied and
  no offsite backup.
- **Database backups.** Nothing is scheduled. Add `pg_dump` on a cron before
  anyone relies on this.
- **No monitoring or error reporting.** Sentry or similar.
- **Phases 2–5** — materials, costing, the showroom configurator, delivery, the
  customer tracking page, the report pack.
