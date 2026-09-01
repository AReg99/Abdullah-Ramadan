# 21 — Cost accounting

## Why a separate job

There was an **accountant** — the person who keeps the drawer. There was no
**cost accountant**: the person who works out what a piece actually takes to
make, and therefore what it has to sell for.

One answers *did we get paid*. The other answers *was it worth making*. Handing
either of them the other's screens is how a small business ends up with one
person doing both badly.

## The parts that were already there

`Product.cost` was a number somebody typed once. Everything needed to work it
out was already in the database and **never multiplied together**:

| | |
|---|---|
| `BomLine` | What one piece is made of |
| `StockItem.unitCost` | What that material costs today |
| `RoutingStage.stdMinutes` | The standard time at every station |

So when timber went up twenty per cent, nothing said the margin on a wardrobe
had collapsed. It surfaced months later in a profit report as a figure nobody
could explain.

```
cost = materials + (standard hours × the labour rate) + overhead
```

## The computed figure never overwrites the stored one

This is the design decision the whole module turns on.

A cost that silently rewrites itself is a cost nobody can quote against — an
order written on Tuesday and one written on Thursday would carry different
costs for reasons neither invoice records. So the computed figure is shown
**against** the stored one, and **the gap between the two is the finding**.
Moving the stored figure is a decision somebody makes, with a reason.

Two buttons do it:

- **اعتمد التكلفة الجديدة** — take the computed cost, leave the price alone
- **اعتمدها وزوّد السعر** — move the price by the same proportion, which is what
  a business means by "pass it on"

## The price list

Every model with its price, its computed cost, and the margin between them —
**sorted worst margin first**. The bottom of an alphabetical list is where the
losses sit and nobody scrolls that far.

Margin is on **the selling price**, not mark-up on cost. Those are different
numbers, mark-up is always the larger one, and a showroom argues in the first.

The tiles double as filters: below the floor, cost has drifted, no recipe, sold
at a loss.

A model with **no bill of materials cannot be costed**, and is flagged as such
rather than shown a confident zero.

### Opening one

"This wardrobe costs 4,300" is not actionable. "It costs 4,300 and 2,900 of
that is timber" is a conversation with a supplier — so the breakdown lists
every material, **dearest first**, then labour by stage, then overhead.

It also shows **the price that would clear the margin floor**, which is the
number the cost accountant is actually reaching for.

## Telling the counter

The showroom used to find out a price had changed when a customer argued about
it.

Every price or cost move is written down **by the product route itself**, not by
whoever remembers — so a change made from Setup, from the costing screen, or
from anywhere else lands on the same list, with the old figure, the new one, who
moved it and why.

The showroom gets **a badge on their nav** and reads the notices in a batch: a
rep who opened the list has read the list, and making them tap each row is how a
badge stays lit for ever until nobody looks at it. The cost accountant can see
that the counter read it, and who.

The counter is told **what a price did**. It is not shown what anything costs.

## The realised margin

The price list says what a model *should* make. This says what it **did**.

Every order line carries the price it went out at and the cost it was made at
**on the day** — so a discount given at the counter shows up here and nowhere
else. Grouped by model, worst first, because the models losing money are the
reason to look.

## The three rates

| | |
|---|---|
| **سعر ساعة العمل** | All in, per hour |
| **مصاريف غير مباشرة** | A percent on materials and labour — rent, power, glue |
| **أقل ربح مقبول** | The floor, as a percent of the selling price |

The labour rate is a figure rather than a calculation off the payroll on
purpose: wages are weekly and by attendance, and **a cost that moves every
Saturday is a cost nobody can quote against**.

## Who may do what

| | Price list & margin | Move a price | Set the rates | Read the notices |
|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ |
| Cost accountant | ✓ | ✓ | ✓ | ✓ |
| Accountant | ✓ | | | |
| Factory & production managers | ✓ | | | |
| Showroom manager, sales rep | | | | ✓ |

The cost accountant also gets **the catalogue** (adding models and pricing
them is the job) and **the store's item costs** (they drive the sum, so
correcting one is theirs). Not the cash box, not payroll, not the staff form.

Staffing the post stops with the owner: costing is a money job.

## Not built

- **A routing per product.** Labour is the default routing's standard minutes
  for every model, so two models of very different complexity carry the same
  labour cost.
- **Actual time instead of standard time.** The stages record how long a piece
  really took; costing uses the standard. Comparing the two is the obvious next
  thing.
- **Scrap and rework in the cost.** A model that fails QC twice as often costs
  more to make, and nothing here says so.
- **Material price history.** A stock item's cost is a single current figure;
  what timber cost in March is not recorded.
