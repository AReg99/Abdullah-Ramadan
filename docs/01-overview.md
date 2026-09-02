# 01 — System overview

## The eleven modules

| # | Module | Owns |
| --- | --- | --- |
| 1 | **Catalogue & configurator** | Products, option groups (fabric, wood finish, dimensions, hardware), swatch library, price and lead-time rules |
| 2 | **CRM & sales** | Customers, inquiries, quotations, approvals, deposits, sales-rep attribution |
| 3 | **Orders** | Order header + lines, standard/custom lifecycles, promise dates, split shipments |
| 4 | **Design & custom spec** | Design briefs, measurements, drawings, revisions, customer sign-off |
| 5 | **Production** | Work orders, routings, stations, stage tracking, worker time, blocked reasons |
| 6 | **Quality** | Checklists per stage, pass/fail, defect taxonomy, rework orders |
| 7 | **Materials & inventory** | Materials, BOM, stock by location, reservations, stock moves, purchase orders, suppliers |
| 8 | **Logistics** | Transfers factory↔showroom, delivery shipments, driver routes, proof of delivery, installation jobs |
| 9 | **Finance** | Quotation totals, invoices, payments/deposits, planned vs. actual cost, margin per order |
| 10 | **Notifications** | Event→rule→channel engine, templates, quiet hours, delivery log |
| 11 | **Analytics & reports** | Dashboards, scheduled report pack, at-risk detection, bottleneck analysis |

Cross-cutting: identity & RBAC, audit log, attachments/media, i18n (ar/en + RTL),
tracking event stream.

## How factory and showroom actually connect

This is the part most furniture businesses get wrong, so it is specified
explicitly. Six concrete integration points:

### 1. One shared catalogue and one shared swatch library
Fabric code `F-214` means the same physical fabric in the showroom, in the BOM,
and on the cutting table. The showroom cannot sell an option the factory has
retired, and a new finish appears in the showroom the moment production approves
it.

### 2. Availability is a live, four-state answer
When a sales rep opens a product they see, per variant:

- **In this showroom** — qty on display / in showroom stock, deliverable today
- **In factory stock** — qty finished, needs a transfer (transfer lead time shown)
- **In production** — qty already being built and unallocated, with its finish date
- **Made to order** — earliest date the scheduler can commit to

### 3. Promise dates come from capacity, not from optimism
The configurator asks the scheduler for the earliest date that fits the required
station minutes into remaining capacity, adds the material lead time for any
option that must be purchased, and returns a date. The rep quotes *that* date.
Nobody can hand-type an earlier one without a factory-manager override, which is
logged.

### 4. Orders are handed over, not thrown over the wall
A showroom order enters the factory queue as `PENDING_FACTORY_ACCEPTANCE`. The
factory manager accepts (which commits the capacity slot) or rejects with a
reason and a proposed alternative date. The showroom is notified either way, and
the customer is only told a date after acceptance.

### 5. One message thread per order
Every order carries a thread with three visibility levels — internal (factory
only), showroom (factory ↔ showroom), and customer. This replaces the WhatsApp
group where decisions get lost. Photos posted at a stage automatically appear in
the thread.

### 6. Transfers are a tracked object
"Send the display sofa from the showroom back to the factory for re-upholstery"
is a `transfer_request` with an approval, a dispatch scan, and a receive scan —
not a phone call. Showroom display stock stays accurate.

## The event model

Everything that happens writes one row to `tracking_events`:

```
tracking_events(
  id, order_id, entity_type, entity_id, event_code, actor_id,
  location_id, station_id, payload jsonb, photo_urls[],
  occurred_at, recorded_at, is_customer_visible, client_event_id
)
```

Three properties make this work:

- **Append-only.** A mistake is corrected by a compensating event, never by an
  update. The owner's numbers can always be re-derived and defended.
- **`occurred_at` vs. `recorded_at`.** An offline scan at 09:12 that syncs at
  11:40 is still counted at 09:12. Without this, offline sync silently corrupts
  productivity reports.
- **`client_event_id`.** The worker app generates a UUID per scan, so a retried
  sync is idempotent and a double-tap does not double-count.

Every view in the system is a projection of this stream:

| Consumer | Projection |
| --- | --- |
| Customer tracking page | Events where `is_customer_visible = true`, mapped to friendly stage names |
| Owner live floor | Latest event per work order, grouped by station |
| Notification engine | Subscribes to the stream, matches rules, dispatches |
| Reports | Aggregations over the stream (stage durations, throughput, defect rate) |
| Order timeline | All events for `order_id`, filtered by the viewer's role |

## Traceability: the unit label

The moment a work order is created, the system prints a label per unit carrying a
QR code (`unit_labels.serial`). That label is physically attached to the piece and
stays on it through cutting, assembly, finishing, QC, packing, and loading. It is
removed at installation.

Every scan of that label is a tracking event with a station, an actor, and a
timestamp. This single mechanism is what makes "follow everything" true rather
than aspirational — and it is why the worker app must be two taps, not a form.

### Printing them

A label is created with the work order, but it is not printed then — printing
is a choice made at the printer, and the Labels screen is where it is made.

Pick the ones you want by ticking them. Narrow the list first if it is long:
search by serial, customer or product, filter to one order, or filter to the
ones **not printed yet** — which after the first run is usually the whole job.
"Select shown" ticks everything the filter left. Only the ticked labels go to
the printer; the rest are not on the sheet.

Two behaviours worth knowing:

- **A ticked label prints even if the filter has since hidden it.** Narrowing
  the list after ticking must not silently drop half a batch, so it does not —
  and the screen says how many are ticked but out of sight.
- **Marking is the operator's word, not the browser's.** Nothing can tell the
  app whether paper actually came out, so after the print dialog closes it
  asks. Say yes and those labels carry a printed date; say no and nothing
  changes, so a jammed printer does not cost you the batch.

Reprinting is normal — a label soaked in lacquer or torn off in transit gets
another — so a label already printed can be printed again and its date moves
forward. `LABEL_PRINTED` is recorded per label either way, so the count of
reprints on a piece is answerable.
