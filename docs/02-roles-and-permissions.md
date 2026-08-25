# 02 — Roles & permissions

## The eleven roles

| Role | Where | Primary app | Core job in the system |
| --- | --- | --- | --- |
| **Owner** | Anywhere | Owner mobile + web | Watch everything, approve exceptions, receive reports |
| **Factory manager** | Factory | Web | Accept showroom orders, plan production, resolve blockers |
| **Production supervisor** | Factory | Web + tablet | Assign work to stations and workers, unblock, sign off shifts |
| **Group leader** | Factory | Mobile (Arabic, large targets) | Scan, start, finish, report a problem — for their whole crew |
| *Worker* | Factory | — | Does not sign in. A roster record so output stays attributable |
| **QC inspector** | Factory | Mobile | Run the checklist, pass/fail, photograph defects |
| **Storekeeper** | Factory / warehouse | Mobile + web | Issue material to work orders, receive POs, stock counts, transfers |
| **Purchasing officer** | Factory | Web | Turn shortages into purchase orders, chase suppliers |
| **Showroom manager** | Showroom | Web + tablet | Showroom stock and display, team performance, discount approval |
| **Sales representative** | Showroom | Tablet | Configure, quote, sell, collect deposit, follow their customers' orders |
| **Delivery driver / installer** | On the road | Mobile | Load scan, navigate, deliver, capture proof, collect balance |
| **Accountant** | Office | Web | Invoices, payments, costing, margin, exports |
| *Customer* | — | Public link, no login | Track, approve a design or photo, pay a balance, request after-sales |


## What each role opens in the app today

Ten of the eleven roles above exist in the system and each signs in to a screen
built for them. Verified by signing in as every one of them and opening its
first tab.

| Role | Signs in to | Sees |
| --- | --- | --- |
| Owner | Today | Everything: floor, dispatch, showroom, orders, new order, setup |
| Factory manager | Today | Floor, dispatch, orders, labels, and Setup's crews and staff — no prices |
| Supervisor | Today | Floor, dispatch, orders, labels |
| Group leader | Work | Only their own group's station |
| QC inspector | Work | Only the QC station's queue — needs a station assigned in Setup |
| Storekeeper | Dispatch | The outbound bench, labels, orders |
| Showroom manager | Showroom | Their branch's board and orders |
| Sales rep | Showroom | Their branch's board and orders |
| Delivery driver | Showroom | What is on the van, and signing it in on arrival |
| Accountant | Orders | Order values and status |
| *Worker* | — | Does not sign in, by design: a roster record so output stays attributable |

**Purchasing officer is not in the system.** The role only makes sense with the
purchasing module — shortages, purchase orders, suppliers, chasing — and none of
that is built. Adding the role now would create an account with nothing to open.

**The customer tracking page is not built either.** Every order already carries
its `trackingToken`, so the link exists in the data and nothing serves it yet.

Any role not listed above falls back to the shop-floor tabs and, without a
station, sees no work at all — deliberately, so an unassigned account can never
be handed the whole factory's job list.


### Attachments

What arrives with an order — a photo of the piece to copy, room measurements,
the signed quotation — is attached to the **order**, so the factory still has it
three weeks after the showroom took it. The showroom attaches them; the factory
reads them.

Only images and PDF are accepted; anything else is refused rather than stored.
The name on disk is generated, never the uploaded one, so a hostile filename
cannot climb out of the folder. Files are served from `/uploads/` by an
unguessable path and are **not behind a login** — anyone given the link can open
it, the same as the stage photos. Treat the link as the secret.

### Removing someone

Two different things wear the same word.

An account created by mistake five minutes ago is **deleted** — nothing of it
remains. An account that has done work cannot be: their name is on stages,
photos and events, and the point of an append-only record is that finished work
stays attributable to whoever did it. Those accounts are **retired** instead:
they cannot sign in, they disappear from every list and crew picker, and their
phone and email are released so a replacement can be given the same number.
What they did stays on the record under their name.

The app decides which of the two applies; the person removing them does not
have to. Any crew they led is left with no leader rather than pointing at
somebody gone.

You may remove exactly the roles you may create — the same rule as editing —
and never yourself, and never the last owner.


### Who sees the activity feed

The whole-factory activity feed on **Today** — every action by every person, in
one running list — is the **owner's alone**. That is oversight rather than
operation: a manager needs the figures, the blocked list and the live floor to
do the job, not a record of who did what all day.

A single order's own timeline stays visible to everyone who may open that
order, because it explains that piece rather than watching the people.


### Who sees the money

Prices, order values and takings are visible to the **owner, accountant,
showroom manager and sales rep** — the people who sell or account for them.

The **factory manager and supervisor see none of it**: no order value on the
orders list or the order page, no takings figure on their dashboard, and no
access to the price list or the customer list. They run the factory, and what a
piece sold for is not part of running it.

### Who can change the business

**The catalogue, prices and branches are the owner's alone.**

**The staff list and the crews are shared with the factory manager**, who staffs
his own factory: he may add a supervisor, group leader, QC inspector,
storekeeper or driver, and reset their passwords.

He may not create an owner, another factory manager, a showroom role or an
accountant — and he may not edit one either. Both halves matter, because they
are the same escalation by different doors: minting an owner account, or
resetting the existing owner's password and signing in as them. The rule is one
sentence — **you may edit exactly the roles you may create, plus yourself** —
and the staff form asks the server which roles those are rather than deciding
for itself.

**Order entry belongs to the showroom** — the owner, showroom manager and sales
rep. The factory does not take orders; it makes what has been sold.

## Permission matrix

`R` = read, `W` = create/edit, `A` = approve, `—` = no access.

| Capability | Owner | Fact. mgr | Supervisor | Worker | QC | Store | Purch. | SR mgr | Sales rep | Driver | Acct |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| View any order end-to-end | R | R | R | — | — | — | — | R (own showroom) | R (own customers) | — | R |
| Create quotation | R | — | — | — | — | — | — | W | W | — | — |
| Discount above threshold | A | — | — | — | — | — | — | A (to limit) | — | — | — |
| Confirm order / take deposit | R | — | — | — | — | — | — | W | W | — | R |
| Accept order into factory | A | A | — | — | — | — | — | — | — | — | — |
| Change a promise date | A | W | — | — | — | — | — | R | R | — | — |
| Create / schedule work orders | R | W | W | — | — | — | — | — | — | — | — |
| Start / finish a stage | R | R | W | W (own crew) | — | — | — | — | — | — | — |
| Record QC result | R | R | R | — | W | — | — | — | — | — | — |
| Raise rework | R | A | W | — | W | — | — | — | — | — | — |
| Issue material | R | R | R | — | — | W | — | — | — | — | — |
| Create purchase order | R | A | — | — | — | W | W | — | — | — | R |
| Approve PO above threshold | A | A (to limit) | — | — | — | — | — | — | — | — | — |
| Request / approve transfer | R | A | — | — | — | W | — | W | W (request) | — | — |
| Dispatch shipment | R | R | R | — | — | W | — | R | R | R | — |
| Capture proof of delivery | R | R | — | — | — | — | — | R | R | W | R |
| Collect payment | R | — | — | — | — | — | — | W | W | W (balance) | W |
| View costs & margin | R | R (factory cost) | — | — | — | — | R (material) | — | — | — | R |
| View reports pack | R | R (ops only) | R (own dept) | — | — | — | — | R (own showroom) | — | — | R (finance) |
| Manage users & roles | A | — | — | — | — | — | — | — | — | — | — |

## Rules worth stating explicitly

- **A sales rep sees only their own customers' orders**, plus showroom stock.
  The showroom manager sees the whole showroom. The owner sees everything.
- **Costs are compartmentalised.** The factory manager sees factory cost, the
  accountant sees full cost and margin, the sales rep sees price only. This
  matters when reps move between competitors.
- **Approval thresholds are configurable per role**, stored as numbers not code:
  discount %, purchase order value, rush-order insertion, promise-date change
  beyond N days. Anything above the threshold escalates to the owner's approvals
  inbox and blocks until decided.
- **The floor runs on groups, not individuals.** One group leader per station
  carries the phone and operates the app; the workers in their crew do not sign
  in at all. This matches how the factory already works, and it means the system
  needs one connected device per crew rather than one per person.
- **Attribution survives it.** When a leader starts a job they confirm who is on
  it, defaulting to their whole crew and tapping anyone absent. Output, rework
  and quality stay attributable to the people who did the work, which is what
  the productivity and defect reports depend on — losing that would have been
  the real cost of the change.
- **Two names on every stage:** the leader who operated the app, and the crew who
  did the work. The floor view shows the leader; the reports use the crew.
- **Leaders cannot edit history.** A leader who finished the wrong stage taps
  "report a problem"; the supervisor posts the correction, which is itself an
  event with a reason.
- **Every override is logged** with actor, timestamp, old value, new value, and
  reason. The override report is part of the owner's monthly pack.
- **The customer has no login.** They hold a signed, expiring tokenised URL. It
  exposes only customer-visible events, their own documents, and their own
  payment link.
