# 1. First week setup
*For the owner and whoever will administer the system. Do this once, in order,
before anyone else logs in. Budget one working week.*

Setting up in the wrong order is the most common reason a rollout stalls — you
cannot create a product before its materials exist, and you cannot schedule work
before your stations are defined.

---


> **Loading the 2025 catalogue.** The three collections and their twelve models
> — dining, bedrooms, kids — are in the app already, ready to load in one command
> on the server:
>
> ```bash
> cd /opt/aura && docker compose -f docker-compose.prod.yml --env-file .env.prod \
>   exec api npx tsx prisma/load-catalogue.ts
> ```
>
> Each model arrives **switched off with no price**, because the printed
> catalogue carries none. Open **Setup → Products**, press **Edit** on each one,
> type the price, and press **Activate**. Until you do, it cannot be put on an
> order — deliberately, so nothing is ever sold at zero. Running the command
> twice is safe: a model already there is left exactly as it is.

## Day 1 — Company, places, people

**1.1 Company profile.** Name (Arabic and English), logo, tax number, addresses,
the phone number customers will see on WhatsApp messages, and the default
currency (EGP) and language (Arabic).

**1.2 Locations.** Create every physical place:
- the factory
- each showroom, by name
- the finished-goods warehouse, if it is separate

**1.3 Stations.** Inside the factory, create one station per real work area —
cutting, edge banding, assembly, sanding, finishing, curing, upholstery, quality,
packing. For each, set **daily capacity in minutes**: number of workers × working
minutes per day. Be honest here. Every promise date the showroom gives a customer
comes from these numbers, so an inflated capacity becomes a broken promise six
weeks later.

**1.4 Users.** Create an account per person with their real name, phone number and
role. Do not share accounts — a shared account destroys the productivity reports
and the audit trail, which are two of the main reasons you are buying the system.

**1.5 Approval limits.** Set the thresholds that escalate to you:
discount %, purchase order value, promise-date change in days, scrap write-off
value, refund value. Start tighter than feels comfortable; loosening later is
easy, tightening later is a fight.

---

## Day 2 — Materials

**2.1 Materials.** Enter every raw material you buy: wood, board, fabric, foam,
adhesive, finish, hardware. For each: code, Arabic name, English name, unit
(metre, m², piece, kg, litre), current average cost, supplier, and **reorder
point** — the quantity at which you want a warning.

Do not try to be complete on day one. Enter the materials used by the product
line you will pilot; add the rest as you go.

**2.2 Suppliers.** Name, phone, payment terms, typical lead time in days.

**2.3 Opening stock.** Count what you physically have and enter it per location.
This is worth doing properly — every shortage warning for the next year depends
on it. Do the count on a day the factory is closed.

---

## Day 3 — The catalogue

**3.1 Categories.** Bedrooms, dining, living, office, and so on.

**3.2 Option groups.** The things a customer chooses: fabric, wood type, finish
colour, dimensions, hardware. For each option, add the swatch photo, the price
effect (fixed amount, percentage, or per metre), any extra days it adds, and
**link it to its material** — this is what lets a fabric choice in the showroom
reserve metres in the warehouse.

**3.3 Products.** For each product: code, Arabic and English name, category,
photos, base price, warranty period, and whether it is standard (جاهز),
customisable, or both. Attach the option groups it offers.

**3.4 Bill of materials.** For each product, what it consumes: material,
quantity per unit, and a waste percentage. Get your most experienced carpenter to
check these numbers, not the office. The BOM drives shortage warnings, costing
and margin — a wrong BOM produces confident, wrong reports.

---

## Day 4 — How you build

**4.1 Routings.** For each product category, list the stages in order, assign each
to a station, and set the **standard minutes** for that stage. Use real observed
times, not ideal times. If you do not know, time three units and take the middle.

**4.2 Mark customer-visible stages.** Decide which stages the customer will see on
their tracking page. Most factories expose about five: production started,
in finishing, quality passed, ready, out for delivery. You do not need to show
the customer that a piece is in sanding.

**4.3 Quality checklists.** For each stage that needs an inspection, write the
checklist items in Arabic — what the inspector actually looks at. Keep it to
five to eight items; a twenty-item checklist gets ticked without being read.

**4.4 Defect codes.** The short list of things that go wrong: finish run, dent,
wrong dimension, loose joint, fabric flaw, colour mismatch, scratch. This list
becomes your quality reports, so keep it short and unambiguous.

---

## Day 5 — Rules, messages, hardware

**5.1 Notification rules.** Start with the defaults and turn OFF anything you do
not want. The failure mode is too many notifications, not too few — after two
weeks of everyone ignoring their phone, the system is dead. Recommended starting
set for the owner: the daily 20:00 summary, orders at risk, approvals needed, and
station blocked over an hour. Nothing else, for the first month.

**5.2 Customer message templates.** Review every Arabic message a customer will
receive. These are your brand's voice — do not ship the defaults unread. WhatsApp
templates must be submitted to Meta for approval, which takes a few days, so do
this early in the week.

**5.3 Hardware.** Install the label printer and print a test sheet of labels.
Check they survive dust and finish fumes — use synthetic label stock, not paper.
Set up a tablet or shared phone at each station and log it in. Put a screen on the
wall showing the live floor view.

**5.4 Numbering.** Set the formats for order, work order and invoice numbers —
e.g. `AUR-2026-0001`. Changing these later is painful.

---

## Then: pilot, do not launch

Pick **one product line** with steady volume and a stable routing. Run it in the
system alongside your existing paper process for two weeks. Compare the two at
the end of each week and fix what does not match.

Train by role, not by feature: a worker needs fifteen minutes, a sales rep needs
two hours, the factory manager needs a day.

Only when the pilot line's numbers match reality do you add the rest of the
products, then bring in the showroom, then stop the paper.

## Setup checklist

- [ ] Company profile, logo, WhatsApp number
- [ ] Locations: factory, showrooms, warehouse
- [ ] Stations with honest daily capacity
- [ ] One account per person, no shared logins
- [ ] Approval thresholds set
- [ ] Materials, suppliers, reorder points
- [ ] Opening stock counted physically
- [ ] Categories, option groups with swatches, products, prices
- [ ] Bills of materials checked by a carpenter
- [ ] Routings with real standard minutes
- [ ] Customer-visible stages chosen
- [ ] Quality checklists and defect codes in Arabic
- [ ] Notification rules trimmed to the minimum
- [ ] Customer message templates reviewed and submitted to WhatsApp
- [ ] Label printer tested with synthetic labels
- [ ] Station devices installed and logged in
- [ ] Wall screen showing the live floor
- [ ] Numbering formats fixed
- [ ] Pilot product line chosen
