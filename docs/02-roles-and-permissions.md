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
