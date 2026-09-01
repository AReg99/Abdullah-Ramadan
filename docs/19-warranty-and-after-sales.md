# 19 — Warranty & after-sales

## The problem it fixes

The system forgot a piece the moment it was handed over.

A customer ringing six months later about a sagging wardrobe door reached a
WhatsApp message and somebody's memory. Nothing said whether the piece was still
under warranty. Nothing tracked the repair. Nothing recorded that a van went out
twice. And nothing learned **which models keep coming back** — which is the only
figure here that would change what the factory builds.

Every part of the answer was already in the database. `Product.warrantyMonths`
has been in the schema since the first release and nothing ever read it.
`OrderLine.deliveredAt` has been written all along. The warranty was computable
and simply never computed.

## When the warranty runs out

```
until = the day the customer took it + the model's warranty months
```

**From delivery, not from the order.** An order placed in March and delivered in
May is not eleven months of cover.

A piece that has not been delivered has **no warranty running yet** — a
different answer from *expired*, and said differently. A complaint about one is
refused: that is a production problem, and letting it into the after-sales
figures is what would stop those figures meaning anything.

The answer appears the moment a piece is picked on the new-complaint form,
because the showroom is on the phone to the customer and needs it **in that
conversation**, not after saving a record.

## The complaint

Raised against the line the piece was sold on, and against a specific unit where
the label was scanned — a line can be three chairs and only one of them broken.

The fault is recorded against **the same list production uses at the QC gate**,
so a fault found in a customer's house and one caught in the factory are the
same kind of thing and can be counted together.

The warranty answer is **copied onto the ticket** at the moment it is raised.
Somebody will shorten a product's warranty next year, and a ticket that silently
changes its own answer afterwards is worse than no record at all.

## Who pays

| | |
|---|---|
| **ضمان** | Inside the period. Costs the customer nothing |
| **بمقابل** | Outside it, or damage the customer caused |
| **على حسابنا** | Outside it, and we are doing it anyway |

Goodwill is **named** rather than filed as a warranty job. Filing it as warranty
is how the warranty figures stop meaning anything.

A warranty or goodwill job with money on it is refused — that is one of the two
fields filled in by mistake, and the customer finds out at the door. The charge
box is not even offered unless the job is chargeable.

## The visits

**Append-only, because they go more than once**: the first trip finds it needs a
hinge, the second fits it. A single "what happened" field on the ticket would
lose the first trip entirely — and the first trip is the one that cost a van and
an afternoon.

Six outcomes: fixed, needs parts, taken to the factory, nobody in, not our
fault, something else. Recording one **moves the ticket** — a technician who has
to remember to change a status separately is a technician whose tickets stay
open.

## Who may do what

| | Raise & close | Record a visit | See the cost |
|---|---|---|---|
| Owner, showroom, sales rep, accountant, factory & production managers | ✓ | ✓ | ✓ |
| Driver, supervisor, QC, group leader | | ✓ | |

The technician list is wider on purpose: the person who actually drives to the
house is a carpenter or the driver, and a visit only the office may write down
is a visit written down from memory that evening.

A technician gets the list too, **narrowed to what they were sent to** — they
need the address and the fault — but not the money. What a repair cost and what
was charged is not fetched-and-blanked for them; the server does not send it.

The showroom names who goes, from a list of **people who may record a visit** —
because the staff list belongs to the factory manager, and without this they
could assign a ticket with no way to see who to assign it to.

## The report

The point of recording any of it.

- **By model, worst first** — "this wardrobe came back four times and cost
  eleven thousand" is a decision about a hinge supplier
- **By fault**, in production's own words
- **What it cost us**, against what was charged
- **How many needed a second visit** — a van and an afternoon nobody was
  counting, and the cheapest thing on the list to fix
- **How long a customer waited**, which is the number they remember

## Not built

- **The charge does not post to the cash box.** A chargeable repair records what
  was charged; the accountant enters the collection as they do everything else.
  Nothing links the two records yet.
- **Parts off the shelf.** A hinge fitted on a visit does not come out of stock.
- **A repair as a work order.** A piece brought back to the factory is marked
  `IN_REPAIR` and fixed; it does not get a routing and stages.
- **The customer cannot raise one themselves.** The tracking page shows progress,
  not a way to report a fault or see the warranty.
- **Nothing tells the customer their warranty is about to end.** That needs the
  notifications module.
