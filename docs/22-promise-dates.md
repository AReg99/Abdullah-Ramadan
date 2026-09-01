# 22 — Promise dates

## The problem it fixes

A delivery date was a rep's guess, or `baseLeadDays` — a fixed fourteen that
knows nothing about what is standing in the factory. So a customer was told two
weeks while cutting had eleven days of work in front of it, and **the first
anybody heard about it was the order going red**.

Everything needed was already here and never put together: the routing says
which stations a piece passes through and how long it takes at each, every
station carries a daily capacity, and the open work orders say what is already
queued.

## How the date is worked out

A forward pass through the routing. At each station the piece waits for
whatever is queued in front of it, and cannot start before it has finished at
the station before:

```
ready[i] = max( ready[i-1], queue at station i ) + this piece's own time
```

That is finite-capacity scheduling at its simplest, and it is the honest shape
of the answer: **the bottleneck decides the date**, not the sum of the standard
times.

Then:

- **Working days, not calendar days.** Counting calendar days quietly promises a
  piece on a Friday, and a customer told Friday who rings on Friday is a
  customer nobody can help. The rest days are a setting.
- **Plus slack** (`promise.bufferDays`, two days). The calculation assumes every
  station works every day at its full rate and nothing goes wrong, which is
  never true. A promise with no slack is one broken by the first machine that
  stops.
- **Lines queue behind each other, not beside.** Quoting three wardrobes does
  not quote each as though it were alone in the factory.

A station with no capacity is refused rather than guessed at: a made-up number
here is a date nobody could defend.

## At the counter

The showroom asks, not the factory — it is the counter that makes the promise,
and a date only the factory can see is a date nobody quotes.

As soon as a product is picked, the new-order screen shows **the soonest
possible date**, the working days behind it, and the station it is waiting on.
One tap fills it into the promise field.

**"الموعد جه منين؟"** opens the workings: every station, what it waits for and
what it takes, with the slack named at the bottom rather than hidden inside the
number. The rep is about to argue about a week either way; showing the
arithmetic is what makes the date defensible.

A rep can still promise sooner. **They are told, not stopped** — sometimes the
owner has already decided to move something up.

## The watch list

**الوعود** on the planning board: dates already given that the factory can no
longer meet.

The early warning the business never had. "Late" used to arrive as a fact on the
day it happened; this says it a fortnight earlier, while there is still a phone
call that helps — which is why the customer's number is on every row.

Measured from the work **left** on each piece, not from a fresh order's lead
time: a piece three stages in has three stages behind it, and judging it as
though it were new would call the whole factory late.

### A piece waits only for what is ahead of it

This is the subtlety that decides whether the screen is worth opening.

The first version counted the **whole** station queue as standing in front of
every piece — so an order taken this afternoon pushed out a promise made last
week, and half the factory lit up as at risk for no reason. A warning screen
that cries wolf is one nobody opens twice.

Each station's queue is now ordered exactly as the floor works it — priority
first, then the promise date, then the code — and a piece waits only for the
work that sorts **ahead** of it. So:

- an order taken later, promised later, does **not** move an earlier promise
- a piece deliberately **bumped** ahead does move it, which is the honest
  consequence of bumping something

## Who may do what

| | Ask for a date | The watch list |
|---|---|---|
| Owner, showroom manager, sales rep | ✓ | |
| Factory & production managers | ✓ | ✓ |

The storekeeper does not quote dates, and the rep does not get the factory's
watch list.

## The settings

| | |
|---|---|
| `promise.bufferDays` | Days of slack on the calculation (2) |
| `promise.restDays` | Weekdays the factory is shut, `0`=Sunday … `6`=Saturday. Friday, so `5` |

## Not built

- **A routing per product.** Every model uses the default routing's stations and
  times, so a stool and a wardrobe are quoted the same standard minutes.
- **Actual times instead of standard times.** The stages record how long a piece
  really took; the calculation uses the standard.
- **Holidays.** Weekly rest days are honoured; Eid is not.
- **Material lead time.** A piece whose timber has not arrived is quoted as
  though the shelf were full. The purchasing module knows what is on order and
  nothing joins the two.
- **Nothing tells the customer** when a promise slips. The watch list tells the
  factory; the call is still a person picking up a phone.
