# 08 — Roadmap

Sequenced so that each phase is independently useful. Do not build the whole
system before anyone uses it — the tracking spine in Phase 1 already changes how
the factory runs.

## Phase 0 — Foundation (3 weeks)
Auth, roles and permissions, locations, stations, users. Product catalogue with
option groups and the swatch library. Customers. Arabic/RTL shell. CI, staging
environment, backups.

**Usable outcome:** the catalogue and swatch library replace the printed binder.

## Phase 1 — The tracking spine (6 weeks) ← *the MVP*
Orders and order lines (standard + custom), quotations, deposits. Routings,
stations, work orders and stages. **Unit labels + QR printing.** The worker app:
scan, start, pause with reason, finish, report a problem — offline-first. The
tracking event stream. Order timeline. Owner app: Today, live floor, pipeline,
order detail, notification feed. Push notifications with a first set of rules.

**Usable outcome:** the owner can answer "where is order 412?" from their phone,
and every stage has a timestamp. This is the phase that pays for the project.

## Phase 2 — Materials and money (5 weeks)
Materials, BOM, stock by location, reservations and stock moves, material issue
against work orders, stock counts. Suppliers and purchase orders with approval
thresholds. Planned vs. actual cost and margin per order. QC checklists, defects,
rework with cost attribution.

**Usable outcome:** material shortages surface before they block a job, and the
owner sees margin per order rather than revenue.

## Phase 3 — The showroom bridge (5 weeks)
Showroom app: catalogue with live four-state availability, the configurator with
capacity-driven lead times, quotations sent over WhatsApp, convert-to-order with
deposit and signature capture. Factory acceptance queue. Promise-date change
propagation. Transfer requests. Order message thread with its three visibility
levels. Showroom stock and display management.

**Usable outcome:** the showroom stops promising dates the factory never agreed
to — the failure mode this whole system exists to remove.

## Phase 4 — To the customer's door (5 weeks)
Packing and loading scans, shipments, driver app with route, manifest, proof of
delivery and balance collection. Installation jobs and checklists. The public
customer tracking page with milestone photos, approval actions, slot selection
and online payment. WhatsApp customer notification templates. Invoices.

**Usable outcome:** the "where is my order?" phone calls stop, and delivery is
evidenced with photos and a signature.

## Phase 5 — Intelligence (6 weeks)
The full report pack with scheduled PDF/Excel delivery. Capacity planning board
with drag-and-drop and overbook protection. At-risk detection and escalation.
After-sales tickets with SLAs and warranty tracking. Accounting export. Sales-rep
and product profitability scorecards.

**Usable outcome:** the owner manages by exception and by report instead of by
walking the floor.

## Later, if warranted
Customer-facing configurator on the website · barcode-driven automated cutting
optimisation · demand forecasting from order history · multi-factory support ·
supplier portal · loyalty and referral tracking.

---

## Indicative team and timeline

| Role | Count | Phases |
| --- | --- | --- |
| Backend engineer | 2 | throughout |
| Mobile engineer (React Native) | 1 | 1, 4, 5 |
| Frontend engineer (React) | 1 | 0, 2, 3, 5 |
| Product designer | 1 (part-time) | 0–4 |
| QA | 1 (part-time) | from Phase 1 |
| Product owner | you or a nominated manager | throughout |

Roughly **7 months** to the end of Phase 5, with the first real value in the
factory at the end of month 2. Phases 2 and 3 can partly overlap with two backend
engineers.

## Rollout plan

1. **Pilot one product line.** Pick a category with high volume and a stable
   routing. Run it in parallel with the current paper process for two weeks.
2. **Train by role, not by feature.** The worker needs 15 minutes; the factory
   manager needs a day.
3. **Put a screen on the wall** showing the live floor view. Visibility drives
   the scanning discipline more effectively than instruction.
4. **Tie one report to a real conversation.** Review the blocked-time report every
   Saturday morning. Once people see decisions made from the data, data quality
   improves on its own.
5. **Expand to all products, then to the showroom**, then switch off the paper.
6. **Migrate history** only for open orders and current stock. Do not import years
   of closed orders — it delays the launch and nobody reads them.

## The risks that actually kill projects like this

| Risk | Why it happens | Mitigation |
| --- | --- | --- |
| **Workers stop scanning** | The app takes too long or is in the wrong language | Two taps, Arabic, large targets, and the worker sees their own output; supervisors get an idle-station alert within the hour |
| **Data is entered but wrong** | People work around the system to hit targets | Cross-check scans against material issues and QC; review variances weekly at first |
| **The showroom keeps using WhatsApp** | The old channel still works | Order thread must be genuinely faster; retire the group once Phase 3 is live |
| **Notification fatigue** | Everything is urgent, so nothing is | Throttling, digests, quiet hours, and a quarterly review of which rules were acted on |
| **Custom orders escape the process** | "This one is special, just do it" | The deposit gate is enforced in software; the override is possible but logged and reported |
| **Scope creep before launch** | Every stakeholder wants their feature in the MVP | Phase 1 is the tracking spine and nothing else; everything else has a phase number |
