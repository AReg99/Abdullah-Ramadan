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

## Doing the work, not just reading it

Every report is also where the work happens, because that is the order the job
is actually done in: you look at who owes, you ring them, you write down what
they paid. Each row carries the one action it allows, and no others.

| Where | Row | Button |
| --- | --- | --- |
| Receivables, Sales | An order still owing | **Collect** — pre-filled with the full outstanding amount, since settling in full is the common case and a part payment is one edit away |
| Purchase invoices | A bill not yet settled | **Pay** — pre-filled the same way, and the payment is linked to the invoice so it pays that bill down rather than vanishing into general expenses |
| Collections, Cash box | Any entry that is not itself a reversal | **Reverse** — asks why, then writes the opposite entry |

A row with nothing to do gets no button. A reversal is never offered a reversal.

Suppliers and their bills are added from the purchase-invoices tab, where the
person looking at what is owed to suppliers is the person about to record
another one. Expenses that are not a supplier bill — wages, rent, electricity —
go through **Record an expense** at the bottom of every tab.

## VAT

VAT ships **off**. Turning it on is a decision with a switch, in Setup →
Company & VAT, because half-done VAT changes every total on every screen at
once.

Three things are configured, and all three are stored rather than assumed:

- **The rate.** Egypt's standard rate is 14%, and that is the default, but the
  number is yours to set. Anything outside 0–100 is refused — a typo here
  reprices the business.
- **Whether your prices already include it.** This is the decision that changes
  every total, so it is asked rather than guessed. Egyptian retail prices are
  usually quoted inclusive — the customer is told one number and pays it — so
  that is the default. With it on, the tax is carved out of the price you type.
  With it off, the tax is added on top.
- **The registration number**, which is what makes the printed document a tax
  invoice rather than a receipt.

**Turning it on affects new orders only.** Every order stores the rate it was
written at, so an invoice reprinted next year is the invoice that was issued —
not last year's sale repriced at today's rate. An order written before VAT was
switched on keeps its total exactly as typed.

The **VAT report** (الضريبة) gives the return in one place: what was charged in
the period, the invoices behind it, and each one's rate.

## The printed invoice

Any order opens to a printable invoice. It is laid out in the browser rather
than rendered on a server, which is what gives a phone a PDF with nothing extra
installed: **Print → Save as PDF**, then send it on WhatsApp. The same page is
what comes out of a shop printer.

It carries the letterhead, the customer, the lines, the tax when there is any,
what has been paid and what is left, and every payment received against it.
When the order has no tax it prints as an invoice; when it has, it prints as a
tax invoice with the registration number.

## Cost and profit

Margin is a lie without cost, so cost lives on the product — and is **copied
onto the order line on the day of sale**. Last year's margin does not move when
this year's timber does.

The **Profit report** answers in the order the question is actually asked:

```
net sales  −  cost of goods  =  gross profit
gross profit  −  expenses    =  net profit
```

Two things it deliberately does not do, because either would flatter the figure:

- **Revenue is net of tax.** VAT collected is the government's money passing
  through. Counting it as income overstates every margin on the page.
- **Expenses exclude materials and transfers.** A supplier bill for timber is
  already inside the cost of the piece it became; counting it again would
  double-count it. A transfer between your own accounts is not a cost at all.

Cost is visible only to the owner and the accountant. A sales rep who knows the
margin is a sales rep who can be argued down to it.

## Payroll

A wage lives on the person, set in Setup → Staff, and only by the owner or the
accountant — the factory manager may hire without ever being told what the
showroom manager earns. Someone with no salary set is simply not on the
payroll, which is not the same as being paid zero.

The payroll screen shows a month, who is owed what, and pays it in one go.
Three things it is careful about:

- **A month can only be paid once.** Paying August twice is the mistake the
  whole record exists to prevent.
- **Each person is their own entry**, so one payslip can be reversed without
  unpicking the rest.
- **Somebody can be skipped for a month** without touching their salary — they
  were away, not demoted.
- **Wages belong to the month worked**, not the day the transfer cleared, so a
  posted month lands on that month's last day.

Once posted, the month stops being a view of today's salaries and becomes the
record: an old month reads back as it was paid.

## Putting money into the cash box

A drawer that can only be filled by customers paying invoices is a drawer that
is always wrong. Three things are on the cash box tab:

- **Money in** — capital the owner puts in, a supplier refund, scrap sold.
- **Transfer between accounts** — cash banked, cash drawn out. It posts as two
  entries sharing one id, because a transfer is not income to one drawer and an
  expense from another; recorded as two unrelated movements it inflates both
  figures and every report built on them is then wrong.
- **Opening balance** — what was in the account the day you started using the
  system. It is the one figure nothing else can derive, because the business
  existed before the software did.

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

## Still not built

- **Input VAT on purchases.** The sales side is complete. Reclaiming the tax on
  what you buy needs the tax to be recorded on each supplier bill, which means
  the purchase invoice needs its own rate field.
- **An invoice numbering series separate from the order code.** Today the order
  code is the invoice number. Egyptian e-invoicing has its own rules about
  sequence, and inventing one before reading them would be worse than using the
  code you already recognise.
- **Payroll beyond a flat monthly wage** — overtime, advances, deductions,
  social insurance. What is there pays a fixed salary correctly.
