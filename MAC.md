# Running Aura on your Mac and your phone

## 1. Get the code

```bash
git clone https://github.com/AReg99/Abdullah-Ramadan.git
cd Abdullah-Ramadan
git checkout claude/furniture-factory-tracking-k4psgd
```

## 2. Set it up — one command

```bash
./scripts/mac-setup.sh
```

It checks Node and PostgreSQL, installs Postgres 16 through Homebrew if it is
missing, creates the `aura` database, writes `api/.env` with a random JWT secret,
installs both packages, applies the schema, seeds it, and prints the addresses
for your Mac and your phone.

If anything is missing it says exactly what and stops — it will not half-install.

## 3. Start it — two terminals

```bash
# Terminal 1
cd api && npm run dev

# Terminal 2
cd web && npm run dev:https
```

Use `dev:https`, not `dev`. **The phone camera and Add to Home Screen only work
on a secure origin**, and a LAN address is not one — this is a browser rule, not
a setting you can turn off.

## 4. On your Mac

Open **https://localhost:5173**

Safari will warn about the certificate because it is self-signed. Click
**Show Details → visit this website**. Once.

| Sign in as | Credentials |
| --- | --- |
| Owner | `owner@aura.test` / `aura1234` |
| Worker — assembly | `+201000000010`, code `1234` |
| Worker — finishing | `+201000000011`, code `1234` |
| Worker — upholstery | `+201000000012`, code `1234` |

## 5. On your phone

Both devices on the same Wi-Fi. The setup script prints your Mac's address; if
you need it again:

```bash
ipconfig getifaddr en0
```

Open **https://YOUR-MAC-IP:5173** in Safari. Accept the certificate warning the
same way, then:

**Add to Home Screen** — share button → Add to Home Screen. It installs with the
Aura droplet as its icon and opens fullscreen with no browser chrome. That is as
close to a downloaded app as this gets, and for a factory tool it is usually the
better answer: no store review, and an update is just a deploy.

### Try this on the phone, in this order

1. Sign in as the **assembly worker**. One job is waiting — the wardrobe.
2. Tap **ابدأ**. The camera opens, because assembly requires an arrival photo.
   Photograph the piece. The timer starts.
3. **Turn Wi-Fi off.** Keep working — pause with a reason, resume, finish with
   the second photo. A banner shows how many actions are waiting.
4. **Turn Wi-Fi back on.** The queue drains by itself. Nothing is lost, and
   nothing is double-counted if it retries.
5. Open the owner console on your Mac. Everything you just did on the phone is
   on **اليوم**, attributed to that worker and station, with the times you did
   it — not the times it synced.

### Printing labels to scan

On the Mac, sign in as owner → **الملصقات / Labels** → **Print all**. Print on
synthetic label stock, not paper — it has to survive dust and finish overspray.
Then on the phone, **امسح / Scan** reads them with the camera. A typed serial
always works as a fallback.

## If something goes wrong

**`pg_isready` fails / database errors**
```bash
brew services restart postgresql@16
```

**Port 4000 or 5173 already in use**
```bash
lsof -ti:4000 | xargs kill    # or :5173
```

**Phone cannot reach the Mac** — macOS firewall. System Settings → Network →
Firewall → Options, and allow incoming connections for Node. Also confirm both
devices are on the same network and it is not a guest network with client
isolation.

**Camera does not open on the phone** — you are on `http://`, not `https://`.
Check the URL, and that you started the web app with `npm run dev:https`.

**Start over with fresh data**
```bash
cd api && npx tsx prisma/seed.ts     # without SEED_IF_EMPTY, this resets
```

## Docker instead

```bash
docker compose up --build      # → http://localhost:8080
```

Postgres, API and web in one command, and the seed no-ops on restart so a trial
is never wiped. **This path is untested** — there was no Docker daemon in the
environment it was written in. The two-terminal path above has been run end to
end many times; use it if compose gives you trouble.

Note that compose serves plain HTTP on port 8080, so the **camera will not work
through it on a phone** without putting HTTPS in front. For phone testing, use
`npm run dev:https`.
