# 12 — Stock

What is on the shelves, where it is, what it is worth, and why it moved.

## The one idea, again

**A quantity is never stored.** It is the sum of every movement in and out, the
same way the cash balance is the sum of every entry. That is what makes any
figure on the stock screen answerable: "why is it four?" has a list behind it,
not a shrug.

```
on hand = Σ(in) − Σ(out)   per item, per store
```

Nothing edits a balance. A wrong movement is corrected by its reverse, and both
stay on the record.

## Why it moved

Every movement carries a reason, because a shelf that dropped by four tells you
nothing until you know which of these it was:

| Reason | Arabic | When |
| --- | --- | --- |
| `OPENING` | رصيد افتتاحي | What was there when you started using the system |
| `PURCHASE` | شراء | A supplier's delivery arrived |
| `PRODUCTION` | تصنيع | Materials consumed, or a finished piece added |
| `SALE` | بيع | Handed to a customer |
| `RETURN` | مرتجع | Came back |
| `TRANSFER` | نقل | Moved between two of your own stores |
| `ADJUSTMENT` | تسوية | A correction with a note |
| `DAMAGE` | تالف | Written off |
| `STOCKTAKE` | فرق جرد | The difference a count found |

## Items, not products

A stock item stands on its own and *may* point at a catalogue product.

That split matters: a factory stocks timber, foam and glue that will never
appear in a showroom, and a showroom holds pieces the catalogue does list. If
every product were automatically stock, the catalogue would fill with shelves
that do not exist; if only products could be stock, the timber would be
invisible.

Linking an item to a product is what makes a sale move it by itself. One item
per product — otherwise selling one would not know which shelf to take it off.

## Two things happen on their own

- **A supplier's delivery arrives.** A purchase-invoice line that names a stock
  item lands on the shelf when the bill is recorded, at what it actually cost
  that time. Lines that name nothing — a repair, a delivery charge — stay off
  the shelf, which is most of what a factory's bills contain.
- **A delivered piece leaves.** When an order line is handed to the customer,
  the linked item comes off the store the line named, or the showroom the order
  belongs to.

Both are **best-effort on purpose**. The customer has the piece whether or not
the shelf figure could be updated, and refusing a delivery over a stock count
would be the software arguing with what already happened. Delivering twice does
not take it off twice.

## A shelf cannot hold less than nothing

Unlike a cash account — which is allowed to go negative and simply shows in red,
because back-dating often records a payment before the receipt that funded it —
taking out more stock than is on the shelf is **refused**.

The reason is that the shelf is physical. A negative quantity is always either a
typo or the wrong store, and letting it through means every count from then on
argues with the system instead of with the shelf. The form says what is actually
there before you type, and the button will not submit a number it cannot cover.

## الجرد — the stocktake

Counting the shelf against the books:

1. Open a count for one store. Only one at a time — two people counting the same
   shelves would post contradictory adjustments.
2. The sheet lists every item with **what the system believes**, and each box
   starts at that figure. A shelf that is right needs no typing at all; only the
   differences get touched.
3. The variance shows as you type.
4. Posting turns each difference into a movement with reason `STOCKTAKE` — never
   a silent correction of the balance. A shelf that came up four short has a
   record saying so, with a date and a name on it.

A posted count cannot be posted again.

## Running out

Each item can carry a reorder level. At or below it, the item is flagged — on
the stock screen, and on the owner's summary, which is where you want to be told
before a customer asks for it. A level of zero never flags, so items you do not
want to be nagged about simply have none.

## Who may do what

- **`STOCK`** — owner, factory manager, supervisor, storekeeper, showroom
  manager, sales rep, accountant. Seeing stock, moving it, transferring it,
  counting it. Deliberately wide: the storekeeper and the showroom put things on
  and off shelves all day, and **stock only the office may touch is stock nobody
  records**.
- **`STOCK_ADMIN`** — owner, factory manager, accountant. Deciding what is
  tracked, what it costs, what its reorder level is, reversing a movement, and
  posting a count. Narrower because cost is money.

Crew leaders and QC have no stock screen at all — it is not their job.

## Deleting and retiring

The same rule as everywhere else in this system: an item nothing has ever
happened to is **deleted**; one with movements is **retired**, because deleting
it would leave its history describing a thing that does not exist.

## Not built

- **Materials consumed automatically by production.** A work order knows what it
  is building but not what goes into it — that needs a bill of materials per
  product, which is its own piece of work. Materials come off with a
  `PRODUCTION` movement by hand today.
- **Batch or serial tracking within an item.** Unit labels exist for finished
  pieces; stock is counted, not tracked per unit.
- **Stock valuation methods** (FIFO, weighted average). Valuation is at the
  item's current cost, which is honest for a business buying at stable prices
  and would need to be revisited for one that is not.
