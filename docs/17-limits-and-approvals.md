# 17 — Limits & approvals

## The problem it fixes

Two things had no bound at all.

A sales rep could take **any** amount off an order. The only check was that the
discount did not exceed the line itself, so a concession nobody would have
agreed to surfaced weeks later in the profit report — by which point it was a
customer's expectation and an argument with a colleague.

And whoever kept the books could commit the business to a **purchase order of
any size** with nobody else's name on it.

The showroom already rings the owner when a customer pushes for more off. This
does not replace that call. It gives the answer somewhere to land — so a
concession has a name against it, an amount, and cannot be spent twice.

## The rule that shapes everything

> **A ceiling that has never been set is not a ceiling of zero.**

Nothing here bites until the owner sets a figure. A business that upgrades on a
Thursday must not find its showroom unable to sell on Friday morning because a
release introduced a limit it had never heard of. This is why the form has to be
able to say *no limit* as distinct from *none allowed*: they are opposite
instructions, and a box that can only hold a number would silently turn "we have
never thought about this" into "you may not discount anything".

**The owner is never checked.** Asking somebody for permission to do the thing
only they can grant is a loop, not a control.

## The ceilings

Set in **الإعداد ← الحدود**, one row per role, and only the owner may set them.

| | What it bounds |
|---|---|
| **أقصى خصم** | A percent of the order's gross |
| **أقصى أمر شراء** | The value of one purchase order |

The discount ceiling is a **percent**, not a sum in pounds, because a hundred
off a bedroom suite and a hundred off a stool are not the same concession, and a
rule written in pounds says they are.

Only roles that can sell are offered a discount ceiling, and only roles that can
buy are offered a purchase one. Limits that could never apply are limits somebody
sets and then wonders about.

## Hitting one

The sale **stops** and names both figures: what this person may take off, and
what they entered. Refusing without saying by how much would leave a rep arguing
with a customer over a screen.

From the same panel they ask, giving a reason the owner reads on their phone.
Nothing is written to the order; the request is a separate thing.

Asking for something you are **already allowed** is refused rather than queued —
an inbox full of questions that answer themselves is an inbox nobody reads.

## Answering one

Only the owner. A refusal carries a reason for the same worn reason it does
everywhere else in this system: one without gets asked again tomorrow.

**Granting less than was asked is the normal outcome**, so the amount is a box,
not a yes/no. Granting *more* than was asked is refused — that is a decimal
point in the wrong place, not a decision.

## Spending one

An approval authorises **one act, once**. Everything that can go wrong with a
permission slip has its own answer, because "no" without a reason sends somebody
back to the owner to ask the same question again:

| | |
|---|---|
| `approval_not_decided` | Nobody has answered it yet |
| `approval_refused` | It was refused |
| `approval_already_used` | It has been spent |
| `approval_expired` | It went stale — 48 hours from the answer |
| `approval_not_yours` | It belongs to whoever asked, so one slip cannot circulate a showroom |
| `approval_wrong_kind` | A discount approval does not authorise a purchase order |
| `approval_too_small` | Approved for 1,000 means 1,000 **or less**, never more |

The slip is consumed **after** the order is written, never before: burning it on
a write that then fails would leave the showroom needing a permission it had
already spent.

The record keeps what it went on — the order code or the purchase order number —
so a concession can be traced from the profit report back to the person who
granted it.

## The inbox

**الموافقات** is one screen for the whole question *is anybody standing still
waiting for me?*

The owner sees everybody's, with a count on the tab — an inbox you have to
remember to open is one somebody is waiting on all afternoon. Purchase requests
are counted with it: they are a different table with their own screen, but from
the owner's side they are the same question, and splitting that across two places
is how one of them gets forgotten.

Everybody else sees their own, which is the other half of the feature: the rep
can see whether the answer has come back **without ringing again**, and read why
it was refused.

Either side can withdraw a question that no longer matters — the customer walked
away.

## Who may do what

| | Ask | Answer | Set the ceilings |
|---|---|---|---|
| Owner | — (never asked) | ✓ | ✓ |
| Showroom manager, sales rep | Discounts | | |
| Accountant | Purchase orders | | |
| Factory manager, supervisor, storekeeper | Purchase orders | | |

Every signed-in person may read **their own** ceiling, because being told where
the line is beats discovering it when a sale is refused at the counter.

## Not built

- **A second approver above a certain size.** One owner answers everything;
  there is no two-signature threshold.
- **Standing allowances.** Every approval is for one act. A rep who needs 10%
  every day needs their ceiling raised, not a slip a week.
- **Approval by WhatsApp.** The owner answers in the app. Pushing the question
  to their phone is the notifications module, which is not built.
- **Ceilings on anything else** — a payment out of the cash box, a write-off, a
  price below cost. The two here are the ones that were costing money.
