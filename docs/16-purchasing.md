# 16 — Purchasing

## The problem it fixes

The books learned about a purchase for the first time from **the supplier's
invoice** — which is the last possible moment anything can still be done about
it. By then the money is owed, nobody approved the spend, and there is nothing
to check the delivery against. If the invoice said thirty metres of timber and
twenty arrived, nothing in the system disagreed.

Worse, the material only existed in the store once somebody typed it in by hand,
so what was on the shelf and what had been paid for were two separate acts of
memory.

The cycle now has the three steps that come **before** the bill:

```
طلب شراء  →  أمر شراء  →  إذن استلام  →  الفاتورة
who wanted it   what was agreed   what turned up   what is owed
```

Each one answers a question the next cannot.

## What to buy — اللي لازم يتشترى

The first tab is a calculation, not a list somebody maintains.

Two things already existed and nothing was doing the subtraction:

- the **reorder level** on a stock item — what the shelf should not drop below
- the **bill of materials** on every open work order — what production will eat

So for each material:

```
short by = (what production will consume + the reorder level)
           − what is on the shelf − what is already on order
```

Netting off **what is already on order** is the part that stops the same
shortage being ordered twice by two different people in the same week.

Anything with a positive figure is listed, worst-by-value first, with what to
order. Tick the ones you want and the request form opens with the quantities
filled in.

## The request — طلب شراء

Deliberately **open to the floor**: the storekeeper and the supervisors are the
people who know what is running out. A request only the office may raise is a
request that gets shouted across a yard instead.

It carries the materials and quantities, which store they are for, and when they
are needed by. It commits nothing.

## The decision

**Only the owner approves.** It is money, so it stops there.

A refusal **must** carry a reason. One without gets asked again next week by the
same person for the same thing.

A request is decided once — a second attempt is refused with `already_decided`
rather than quietly overwriting the first answer.

## The order — أمر شراء

What was agreed, with whom, and at what price. **Only the books raise one**, and
only against a request that has been approved: ordering against something nobody
approved is exactly what this cycle exists to prevent.

The unit price is offered from **the last cost paid for that material**, which is
an honest first guess and saves retyping a price list nobody keeps up to date.
It is the price the goods will go on the shelf at.

An order can be cancelled while nothing has arrived against it. Once a delivery
has landed it cannot: cancelling would leave stock on a shelf pointing at an
order that says it never existed.

## The goods receipt — إذن استلام

What **actually turned up**, which is kept apart from the invoice on purpose.
Without it nothing distinguishes what arrived from what was billed, and nothing
stops the business paying for a delivery that never came.

- The quantities start at **what is still outstanding** — that is what a complete
  delivery looks like, so a short one is the only case anybody has to correct.
- Receiving **more than was ordered** is refused. It is nearly always a mistyped
  quantity, and it is the one that ends up paid for.
- A part delivery is normal: the order reads **استلام جزئي** and stays open for
  the rest.
- A batch or lot number can be recorded per line, for timber and dye tracked by
  shipment.

**The stock goes on the shelf here** — at the order's price, against the store
that took it — not when the bill is recorded. That is the single change that
makes the shelf and the ledger the same story. Recording the supplier invoice
against a purchase order therefore does *not* shelve the goods a second time.

## The three-way match — المطابقة الثلاثية

Ordered, arrived, billed — side by side.

Three questions no business can answer without all three documents: were these
goods ordered, did they arrive, and is the price the one agreed. **Any two of
them can agree while the third disagrees**, which is precisely the case worth
catching before a cheque is written.

The screen says which of four things is true:

| It reads | It means |
|---|---|
| المطلوب والواصل والمفوتر متطابقين | Everything agrees |
| الفواتير أكتر من اللي وصل فعلاً | **Billed for more than arrived — check before paying** |
| لسه في بضاعة ماوصلتش | The supplier still owes goods |
| لسه مافيش فواتير | Nothing has been billed yet |

The gap figure is hidden until something has actually been billed: before that
it is just the whole delivery with a minus sign in front of it, which reads like
money owed to you.

## Who may do what

| | Ask | Approve | Order | Receive | Match |
|---|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |
| Accountant | ✓ | | ✓ | ✓ | ✓ |
| Factory manager | ✓ | | | ✓ | |
| Supervisor | ✓ | | | ✓ | |
| Storekeeper | ✓ | | | ✓ | |

Nobody approves their own request; nobody outside the books commits money.

## Document numbers

`PR-2026-0001`, `PO-2026-0001`, `GRN-2026-0001` — counters held in the same
`DocumentSequence` table as invoices and vouchers, incremented inside the
transaction that creates the document, so two people saving at once cannot get
the same number. The prefixes are settings (`series.request`, `series.order`,
`series.goodsReceipt`) and can be changed per business.

## Not built

- **Supplier prices and lead times.** The price comes from the last cost paid,
  not from an agreed price list per supplier, and nothing predicts when an order
  will land.
- **Partial invoicing across several orders.** A supplier invoice attaches to one
  purchase order.
- **Returns to a supplier.** Goods that arrive faulty are written off through the
  store's damage movement, which records the loss but does not chase the credit.
- **A spend ceiling per role.** Every order goes through the books; there is no
  value above which a second approval is needed. That is the next piece.
