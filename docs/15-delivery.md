# 15 — Delivery

## The problem it fixes

The driver had one screen — the same board the showroom manager reads — listing
order lines with no customer name, no phone number and no address, and a Deliver
button that recorded nothing but a timestamp.

So there was no route, no way to reach the customer from the app, nothing that
proved a handover happened, and **nowhere to say why one did not**. A driver
whose customer was out had two options: lie, or say nothing.

## The run

Two lists, because they are two different journeys:

- **على العربية** — coming from the factory. Signed in when it reaches the
  showroom.
- **للتسليم** — waiting at the showroom to go out to a customer.

Ordered by promise date, so what is already late is first. Every stop carries
the three things the driver never had: **the customer's name, the number to ring
when the street turns out to be one-way, and the address** — with a call button
and a map button, because those are the two taps a driver actually makes.

## The proof

A handover needs **a photograph of the piece where it was left, or the
customer's signature**. Either is enough on its own — demanding both would leave
a driver stuck in a stairwell because a camera failed. A timestamp alone is
refused: it is what the driver had before, and it settles no argument.

The signature is drawn with a finger on the phone and stored as an image.

Also recorded: **who took it** (not always the customer — a doorman, a son),
a note, and where the phone was, if it will say. The location is raced against a
two-and-a-half-second timer rather than the browser's own: a device that never
answers the permission prompt calls back neither way, and the driver would be
left holding a sofa staring at a dead button. **The location is nice to have;
the handover is the job.**

## When it does not happen

Seven reasons: nobody in, refused, arrived damaged, wrong address, no way to get
it in, customer rescheduled, something else.

The piece **stays on the run**, marked as a second visit — a customer who was
out once has to be visited again, and a piece that quietly left the list is a
piece nobody delivers.

**Every attempt is kept**, not just the one that worked. A piece delivered on the
third try says something about the address, the customer or the van that a
single success record throws away — and a driver accused of not turning up has
the record to say otherwise.

## The customer is told

A missed visit reaches the customer's own tracking page. Before this, a piece
somebody drove to and could not deliver still read as *"ready for collection at
the showroom"* — telling a customer their furniture is waiting for them, hours
after a van stood outside their door. It now says we tried and will call to
arrange another time.

## The report

The number worth watching is not how many were delivered but **how many took
more than one visit, and why**: a van going out twice for the same piece is a
cost nobody was measuring.

- **First-time success rate**
- **By reason** — which of the seven, ranked
- **By driver** — delivered against failed

## Who may do what

- **The run and the handover** — the driver, the owner, and the showroom, which
  answers the phone when a customer asks where their bedroom is.
- Nobody else. The storekeeper loads the van; they do not sign for it.

## Not built

- **Route optimisation.** The run is ordered by promise date, not by geography.
- **A live map of where the van is.** The location is captured at the handover,
  not tracked continuously — which is a decision about the driver as much as
  about the software.
- **An ETA message before the van arrives.** The failed-visit notice reaches the
  tracking page; a "we are twenty minutes away" message needs the notifications
  module.
