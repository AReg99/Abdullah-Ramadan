# 11 — Money & the books

The accounting module: sales invoices, purchase invoices, the cash box
(الخزنة), and what has been collected from each customer.

## The one idea

**Every movement of money is one entry against one account.** A deposit taken at
the showroom counter, a payment to a timber supplier, the electricity bill out of
the drawer — all the same record shape, `CashEntry`, distinguished only by a
direction (`IN` / `OUT`) and by what it is linked to (an order, a purchase
invoice, or neither).

That is what makes the cash box trustworthy. The balance is not a number somebody
maintains; it is re-derived every time it is asked for:

```
closing = opening + Σ(IN) − Σ(OUT)
```

If the drawer disagrees with the screen, the entries are the argument, and every
one of them carries who posted it and when.

## Nothing is edited, nothing is deleted

An entry posted by mistake is corrected by **reversing** it: a second entry, equal
and opposite, linked to the first. Both stay visible for ever.

This is not bureaucracy for its own sake. A cash book that can be quietly edited
is a cash book that cannot be used to settle a dispute — with a customer, with a
supplier, or with a member of staff. Reversal keeps the wrong figure and its
correction both on the record, and still comes out at the right balance. An entry
can only be reversed once; a second attempt is refused (409).

## What each thing is

| Record | Arabic | What it is |
| --- | --- | --- |
| `CashAccount` | الخزنة / الحساب البنكي | A place money sits. Two are seeded: the main cash box and the bank account. More can be added (a second showroom's drawer, a second bank). |
| `CashEntry` | حركة | One movement in or out. Optionally linked to an order (a collection) or to a purchase invoice (a supplier payment). |
| `Supplier` | مورد | Who bills you. |
| `PurchaseInvoice` | فاتورة مشتريات | What they billed. Paid down by entries linked to it, so an invoice is fully paid, part paid, or unpaid — never guessed. |

The **sales invoice** is the order itself. There is no separate invoice record,
because a second copy of the same figure is how the printed total and the screen
total start to disagree. An order's `paidTotal` is likewise never typed in — it
is recalculated from the entries against it after every collection and every
reversal.

## Two protections that come up daily

- **You cannot collect more than is outstanding.** An overpayment is nearly
  always an extra zero, and refusing it (`exceeds_outstanding`, with the real
  outstanding figure in the reply) is far cheaper than unpicking it from the
  books a month later.
- **The same supplier cannot bill the same invoice number twice**
  (`invoice_number_taken`). This is the duplicate that otherwise gets paid a
  second time in the following month.

## The reports

All five take `?from=&to=` (defaulting to the last 30 days, with the whole of the
`to` day included) and answer in the same shape: a few totals a person can read
at a glance, then the rows behind them.

| Report | Arabic | Answers |
| --- | --- | --- |
| `sales` | فواتير المبيعات | What was sold in the period, what came in against it, what is still owed. |
| `purchases` | فواتير المشتريات | What suppliers billed, what has been paid, what is outstanding. |
| `cashbox` | الخزنة | Opening balance, in, out, closing — per account, reconciling by construction. |
| `collections` | التحصيل | Every collection, with the customer, the order, the method and who took it. |
| `receivables` | المديونية | Everything still owed, aged into buckets (0–30, 31–60, 61–90, 90+ days). |

Plus **the customer statement** (`/money/reports/customer/:id`) — every invoice
and every payment for one customer in date order with a running balance. This is
the page to open when a customer rings to argue about what they owe.

Any report can be downloaded as a spreadsheet (`/money/export?report=…`). The
export does not re-query anything; it asks the report route for its own answer,
carrying the caller's own credentials, so the CSV can never show more than the
person was allowed to see on screen — and the printed figure cannot drift from
the on-screen one. The file is written with a UTF-8 BOM, without which Excel
opens every Arabic name as mojibake.

## Who may do what

Two scopes, in `api/src/auth/scopes.ts`:

- **`BOOKS`** — owner and accountant. The reports, the export, spending,
  reversal, suppliers, purchase invoices, opening new accounts.
- **`COLLECT`** — owner, accountant, showroom manager, sales rep. Taking a
  payment, and seeing the account balances needed to take one.

So the counter can take a deposit but cannot take money *out* of the drawer, and
cannot see the books. The factory manager, supervisors, storekeeper and drivers
see none of it — money is not their job, and the fastest way to lose a showroom
manager to a competitor is for them to have seen the margins.

A sales rep collecting is branch-scoped like everything else they touch: an order
belonging to another showroom is not found, rather than refused, so branch
structure is not leaked by the error message.

## Deliberately not built yet

Stated plainly because a half-built one of these is worse than none:

- **VAT / الضريبة.** Adding it changes every order total, every report and the
  printed invoice at once. It needs to be done in one deliberate pass with the
  real registration details, not bolted on.
- **A printable / PDF sales invoice.** The data is all there; the layout,
  numbering series and Arabic typesetting are a piece of work in themselves.
- **Cost and profit.** Requires per-product cost, which the catalogue does not
  carry yet. Revenue is honest today; margin would not be.
- **Payroll.** Wages currently go through as ordinary expenses.
- **A supplier and purchase-invoice screen.** The API is complete and tested;
  only the expense form is wired into the Money screen so far.
