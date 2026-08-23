# 05 — Screens

Five client applications share one API.

---

## 1. Owner app (mobile-first, plus a web version of the same screens)

**S1 — Today**
Six tiles, refreshed live: orders taken today (count + value) · units produced ·
on-time delivery % (rolling 30d) · orders at risk · cash collected today ·
pending approvals. Each tile taps through to a filtered list. One line at the
top: "3 things need you" if the approvals inbox is non-empty.

**S2 — Live factory floor**
A card per station: current WIP, who is working, the piece on the bench (photo +
order code), minutes on the current job vs. standard, and a red badge if blocked
with the reason. Blocked longer than the configured threshold pushes a
notification, so the owner rarely has to open this screen — which is the point.

**S3 — Orders pipeline**
Kanban by lifecycle stage, filterable by showroom, sales rep, standard/custom,
value. Card shows customer, product thumbnail, promise date, and a colour band:
green on track, amber at risk, red late.

**S4 — Order detail**
Header (customer, value, paid/outstanding, promise date) then the **timeline** —
every event with actor, time, photos — then tabs: lines & specs, drawings &
approval, work orders & stages, materials, costs (planned vs actual, margin),
messages, documents.

**S5 — At-risk & late**
The list the owner actually acts on. Each row: order, days late or projected
late, the specific cause (blocked stage / material shortage / awaiting customer
approval / capacity overbooked), and the owner responsible.

**S6 — Approvals inbox**
Discounts, purchase orders, promise-date changes, rush insertions, scrap
write-offs, refunds. Approve or reject with a reason, from the phone.

**S7 — Reports**
The report pack (see doc 06), each openable, filterable by period, exportable to
PDF/Excel, and schedulable.

**S8 — Notification feed**
Chronological, grouped by type, with read state and a mute-per-type control.

---

## 2. Factory web console

**F1 — Incoming orders.** Queue of `PENDING_FACTORY_ACCEPTANCE`. Each shows the
required station minutes, material availability, and the earliest feasible date.
Accept (commits capacity) / reject with reason and counter-date.

**F2 — Planning board.** Days across, stations down. Work orders as blocks,
drag to reschedule; the board shows capacity used vs. available per station per
day and refuses an overbook without an override. Rush insertion shows what it
pushes back and who must be told.

**F3 — Work order detail.** Routing, stages, assignees, times vs standard,
material issues, QC results, attached drawings, unit labels with their current
stage.

**F4 — Blockers.** Everything `PAUSED`, sorted by minutes lost, grouped by
reason. This is the supervisor's morning screen.

**F5 — Quality.** Failures and rework by station, by product, by defect code,
with photos. Trend line per station.

**F6 — Materials.** Below reorder point, reserved vs available, shortages
blocking scheduled work orders, open purchase orders and expected dates.

**F7 — People.** Attendance from first/last scan, output per worker per day,
average time vs standard per stage, rework attributed.

---

## 3. Station worker app (Android, Arabic, offline-first)

Deliberately four screens. Text is large, targets are thumb-sized, and no screen
requires typing except a note.

**W1 — My work today.** Ordered list of jobs assigned to my station. Each row:
order code, product photo, qty, due, and a big **Start** button.

**W2 — Scan.** Full-screen camera. Scan the unit label → job card.

**W3 — Job card.** Photo and drawing (pinch to zoom), the exact spec including
chosen options in Arabic, materials needed and their bin, standard minutes, and
three buttons: **Start** · **Pause** (opens the fixed reason list) · **Finish**.
A running timer since Start. One more button: **Report a problem** — take a
photo, pick a reason, send; it lands on the supervisor's screen instantly.

A strip of thumbnails at the bottom shows the photos already on this stage, and
the *after* photo from the previous stage — so the worker can see the condition
the piece was handed over in before they touch it.

**W3b — Capture (before / after).** Tapping **Start** on a stage that wants an
arrival photo opens the camera immediately; the same happens on **Finish**. Not a
separate flow to remember — one extra tap, the shutter.

- A faint **ghost outline** of the previous photo for this product and stage sits
  over the viewfinder, so before and after are shot from the same angle and are
  actually comparable. Without it you get two photos of different corners of the
  workshop.
- Big shutter, then **Retake** or **Use**. Nothing else.
- A blur and darkness check runs on-device and asks for a retake once, then lets
  the worker through — a nagging camera gets worked around, usually by
  photographing the floor.
- **Add another** for multiple angles where the stage asks for more than one.
- On an `OPTIONAL` stage there is a **Skip** button. Skips are recorded.
- Offline: the photo is written to the local queue and the stage proceeds
  immediately. **The camera never blocks the work.**

**W4 — My day.** Units finished, minutes worked, comparison to standard. Shown
because a worker who can see their own numbers scans reliably; a worker who
cannot, does not.

Offline: everything queues locally with `client_event_id` and a device clock
`occurred_at`; a sync badge shows pending count. Nothing blocks on the network.

---

## 4. Showroom app (tablet + web)

**R1 — Catalogue.** Grid with photos and an availability badge per product: in
this showroom / in factory stock / in production / made to order — N days.

**R2 — Configurator.** Pick a product, then walk the option groups with real
swatch images. Price and lead time update live at the bottom. Custom dimensions
open a measurement form that recomputes material and price. The result is a
quotation line — the rep cannot invent a date.

**R3 — Quotation.** Multi-line, discount (escalates above the rep's limit), terms,
validity. Send as PDF over WhatsApp or email in one tap; the customer's view of
it is tracked.

**R4 — Convert to order.** Capture deposit, choose delivery vs pickup, capture
the delivery address with a map pin, and — for custom lines — capture the signed
design approval on the tablet.

**R5 — My orders.** The rep's own customers with live status and the next action.

**R6 — Showroom stock & display.** What is on the floor, what is reserved, what
is sellable today. Request a transfer from the factory; request a pickup of a
display piece.

**R7 — Sample library.** Fabrics, woods, finishes with codes, price band, current
availability and lead time. Ends the "we ran out of that fabric two months ago"
conversation.

**R8 — Customer conversation.** The order's message thread at `SHOWROOM`
visibility, plus a one-tap "ask the factory" that creates an internal question
attached to the order.

---

## 5. Driver / installer app

**D1 — My route today.** Stops in sequence with customer, address, navigation
launch, phone button, and the balance to collect.
**D2 — Load.** Scan each unit onto the vehicle against the manifest; a wrong scan
is rejected loudly.
**D3 — At the stop.** Delivery checklist, installation checklist if applicable,
photos of the installed piece, receiver name, signature pad, GPS stamp.
**D4 — Payment.** Amount due, method, reference, receipt sent to the customer.
**D5 — Failed delivery.** Fixed reason list + photo + note; triggers rebooking.

---

## 6. Customer tracking page (no app, no login)

A tokenised link sent on confirmation. Mobile web, Arabic/English.

- A friendly progress bar with the stages the factory chose to expose
  (`is_customer_visible` on the routing stage), not the internal ones.
- Photos at milestones — the single feature that most reduces "where is my
  order?" phone calls.
- Promise date, and if it changed, the new one with a short reason.
- Action buttons when needed: **approve the design**, **approve the preview
  photos**, **choose a delivery slot**, **pay the balance**.
- Documents: quotation, approved drawing, invoice, warranty certificate.
- **Contact us** — writes into the order thread at `CUSTOMER` visibility, so the
  reply is attached to the order rather than lost in a personal phone.
- After delivery: rate the experience, open a warranty ticket.
