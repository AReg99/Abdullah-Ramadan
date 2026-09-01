# 20 — Leads & quotations

## The problem it fixes

The showroom could record exactly **one** thing: a confirmed order.

A customer who walked in, was given a price and said they would think about it
left no trace at all. So nobody could be followed up. Nobody knew how many
walk-ins became sales, or why the rest did not. And the next quote for the same
person was retyped from nothing.

## Two objects, because they answer different questions

The **lead** is the person and the follow-up. The **quotation** is the paper.
One lead can be quoted twice — they asked for a bedroom, then a bedroom and a
dressing table.

## The board

Ordered by **what has to be done today**: anybody overdue a call first, then
whoever is due next, then everyone else. A list of names sorted by when they
walked in is a list nobody works from.

The single field that turns a list of names into work is **the next call**. A
lead without one is counted on its own tile, because it is a name nobody rings.
Logging a call asks for the next date in the same breath — a call almost always
ends in agreeing to another one.

Conversations are **append-only**. What was said in March is not edited in May,
and the trail is the only thing that makes a follow-up in June sensible.

## Where they came from

Seven sources — walked in, phone, WhatsApp, Instagram, Facebook, referral,
something else. **This is the figure that decides where to spend on
advertising**, and it costs one tap at the moment somebody is written down.

## The quotation

A price in writing, with **a date it stops being true**. A quote with no end
date is a price the customer holds you to next year, after the timber has moved
twice. The default is a setting (`quote.validDays`, 14 days).

Nobody sets *expired* — it is what the date says. Storing it would mean a
nightly job whose absence quietly makes old quotes look live.

Quoting somebody **moves them along the board by itself**. A rep who has to
remember to also change a status is a rep whose board goes stale.

### The discount ceiling bites here

Not at the order. **A quote is a price promise on paper**: letting a rep write
20% off and only refusing it when the customer comes back to buy hands them a
document the business will not honour, which is worse than refusing at the
counter. The approval is asked for and spent on the quote, from the same panel
(see [17 — Limits & approvals](17-limits-and-approvals.md)).

### It prints

Laid out in the browser like the invoice, so a phone turns it into a PDF from
the print sheet with no rendering service. The **valid-until date is printed as
large as the total** — an end date buried in a footer is one the customer
produces in September expecting March's price.

## Becoming an order

The prices are copied from **the paper the customer is holding**, not looked up
again. The whole value of a written quote is that it is still true when they
come back, and re-pricing at today's list would quietly break that.

An expired quote cannot be converted — re-quote instead, rather than letting a
document from March become an order in September at March's timber cost.

The order is written by the order route, which also creates the work orders, the
stages and the labels; **the quote is linked in that same request**, so a client
that dies between two calls cannot leave an order nobody can trace back. The
lead becomes a customer at that moment — the only moment the distinction stops
mattering — and a lead whose phone number is already on the books is linked to
the existing customer rather than duplicating them.

## Losing one

Six reasons: the price, the lead time, bought elsewhere, changed their mind,
stopped answering, something else.

**A reason from a list rather than a free box**, because a reason nobody can
count is a reason nobody acts on — and "the price" being half of them is a
different business decision from "the lead time" being half.

A lost lead's next-call date is cleared. Leaving it on is how a dead list fills
the follow-up screen until nobody reads it.

## The conversion report

The figure the showroom has never had. A month of orders says what was sold; it
says nothing about the four people who came in for the same bedroom and went
somewhere else.

- **Conversion**, out of the leads that reached an answer. Counting the
  still-undecided as losses reads as a collapse every time the showroom has a
  busy week
- **By source**, with a rate each — where to advertise
- **By rep**, with a rate each
- **Why the lost ones were lost**
- What the wins were worth, and how long people took to decide

The accountant reads this and touches nothing else: they are offered the report
alone, not a board that would refuse them.

## Who may do what

| | The board & quotes | The report |
|---|---|---|
| Owner, showroom manager, sales rep | ✓ | ✓ |
| Accountant | | ✓ |

The factory has no view of any of it, and the accountant's ledger still starts
at the order.

## Not built

- **Sending the quote.** It prints and can be handed over or photographed; it
  is not emailed or WhatsApped from the app. That needs the notifications
  module.
- **Reminders.** The board shows who is overdue; nothing pushes it to a phone.
- **Quote revisions.** A changed price is a new quote, not version two of the
  old one.
- **A lead without a phone number.** Everything here assumes somebody can be
  rung back.
