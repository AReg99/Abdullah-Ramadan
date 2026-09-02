# 23 — The spec: from the counter to the bench

## The problem this exists for

An order is taken at the showroom and made at the factory, and between those two
sentences the app used to carry **one free-text box**. It was called
"المواصفات", it sat at the bottom of the order line, and the worker saw it as a
single grey line on the job card.

That is where orders went wrong. Not because anyone was careless — because a
sentence cannot be checked:

- If the rep never wrote the colour, nothing noticed. The order was accepted, the
  work order was created, the label was printed, and the first person to discover
  that nobody knew the colour was the man at the bench with a spray gun in his
  hand.
- If they did write it, nothing made anyone read it. One line of grey text
  among the quantity and the standard minutes is a line you skim.
- If the customer rang on the Tuesday to change it, there was **no route in the
  app at all**. Order lines could not be edited after the order was taken. So it
  happened by telephone, one person at the counter to one person at the factory,
  and whether it arrived depended on who was standing where.
- If the bench was unsure, the only move was to block the stage with
  `AWAITING_CUSTOMER` — which names nobody, carries no question, and expects no
  answer. So nobody blocked. The alternative to asking is guessing, and a guess
  about a colour is a piece made twice.
- The drawing the customer actually approved lived on the order screen, which
  nobody at a bench has ever opened.

Afterwards, "we were never told the colour" and "you were told and didn't read
it" leave exactly the same evidence: none. Neither can be prevented by trying
harder.

## The shape of the fix

**A spec is a set of fields, not a sentence.** Each product says what has to be
decided about it. An order cannot be taken with a required one blank. Every
answer, and every change to an answer, is recorded with who and when.

Four parts:

| | |
| --- | --- |
| **1. The product says what must be decided** | Colour, fabric, width — per product, because what must be settled about a wardrobe is not what must be settled about a dining chair |
| **2. The order cannot be taken without it** | A blank required answer is refused at the counter, while the customer is still standing there |
| **3. The bench can ask, the counter answers** | A question against the order line, answered by name, both visible on the job card and in the order's history |
| **4. A change after the order is loud** | Recorded rather than telephoned; if the piece is already being made, the floor is told rather than finding out at delivery |

## 1. Defining the fields

**Setup → Products → a product → المواصفات المطلوبة.**

Each field has a name, a code, and a kind:

- **اختيار من قايمة (CHOICE)** — one of a list you write, one option per line.
  This is the kind worth using. The counter then cannot promise a colour the
  factory has no lacquer for, and the answer is one of a set the bench already
  recognises.
- **رقم (NUMBER)** — with a unit (`سم`), printed beside the answer.
- **كلام (TEXT)** — free text, for the genuinely open ones.

Each is **إجباري** or **اختياري**. Only a required one blocks an order — so
"اسم العميل على اللوحة" can be optional without weakening the rule.

A CHOICE with no options is refused: it would make the product impossible to
order.

**A product with no fields defined behaves exactly as it did before.** That is
what makes this safe to switch on: you do it one product at a time, starting
with whatever goes wrong most, rather than on a flag day.

### Retiring a field does not rewrite history

Take a colour out of the list, or drop a field entirely, and orders already
taken keep what they were actually ordered with. The answer copies the text at
the time rather than pointing at the option row, so last year's "بني غامق"
survives this year's tidy-up, and the job card still shows it under
*retiredSpecs*.

## 2. Taking the order

The fields appear on the order line, above the free-text note — because this is
the part that has to be right, and the note is the part that is only ever read
if somebody remembers to.

A blank required answer shows in red, names itself, and the **confirm** button
stays off. The server refuses the same order independently (`spec_required`,
naming the missing codes per line); the screen just says it earlier, when it is
still cheap to answer.

## 3. Asking, instead of guessing

On the job card: **اسأل المعرض**.

The question goes against the order line, carries the job it was asked from, and
can be marked **واقف مستني الرد** — somebody is standing still over this. It
lands on the showroom's المواصفات screen, sorted with the blocking ones first
and then oldest-first: a question asked this morning that nobody answered is
worse than one asked five minutes ago.

The answer comes back onto the job card, under the question, with the name of
whoever answered. Both are in the order's event stream (`SPEC_QUESTION_ASKED`,
`SPEC_QUESTION_ANSWERED`).

A question is answered **once**. A second answer is refused rather than
overwriting the first — otherwise the bench has acted on something no longer in
the record.

Who may do what:

| | Ask | Answer |
| --- | --- | --- |
| Factory manager, production manager, supervisor, group leader, QC | ✅ | — |
| Owner, showroom manager, sales rep | — | ✅ |

The factory cannot answer its own question, and the showroom cannot ask itself
one. The counter spoke to the customer; the counter answers.

## 4. Changing the spec after the order

From the showroom's المواصفات screen: **غيّر المواصفات** on any line.

- **Before the factory starts**, a change is a correction. It is recorded, and
  the floor is not interrupted.
- **Once the piece is being made**, a reason is *required* — refused without one
  (`reason_required_in_production`). Changing what a piece is meant to be, once
  it is being made, is a decision with a cost; saying why is the least it can
  carry.

A change after work has started then does three things:

1. Lands on the job card as the loudest thing on the screen — what it was, what
   it is now, why, and who — above the spec and above everything else.
2. Flags the job **on the floor list**, not only inside the card. A worker who
   has to open a job to find out that it changed will find out after they have
   made it.
3. Sits in the factory's المواصفات queue until somebody on the floor marks it
   **خلاص شفتها**, at which point the flag clears. It is a queue that empties,
   not a badge that is always on.

The floor takes it in; the counter cannot mark its own change as read.

## What the bench now sees

The job card carries, in this order:

1. Any unseen spec change — loud, in red, with a button to take it in
2. **The spec, field by field**, in bold — the colour, not the word "colour"
3. Quantity, serial, standard minutes, and the free-text note if there is one
4. **The drawings attached to the order** — the thing the customer approved,
   which used to live where no worker ever looked
5. Questions asked on this piece, and their answers
6. The stage photos

## The badge

The المواصفات tab counts what **the other side** is waiting on:

- for the showroom — questions nobody has answered
- for the factory — spec changes nobody on the floor has taken in

Both are somebody else's work stopped, which is why they are worth a number on a
tab rather than a screen you have to remember to open.

## Data model

| Table | Holds | Notes |
| --- | --- | --- |
| `SpecField` | What must be decided about a product | Retired, never deleted |
| `SpecOption` | The choices a CHOICE field offers | Replaced wholesale; safe because answers copy text |
| `LineSpec` | The answer on the order line | Label copied too, so it reads correctly years later |
| `SpecChange` | Every move of an answer | Append-only: from, to, why, who, and whether the piece was already being made |
| `SpecQuestion` | A question from the bench and its answer | One answer, by name |

Events: `SPEC_FIELDS_SET`, `SPEC_SET`, `SPEC_CHANGED_IN_PRODUCTION`,
`SPEC_QUESTION_ASKED`, `SPEC_QUESTION_ANSWERED`.

## What this does not do

- It does not price an option. "قطيفة" and "كتان" cost the same today. Options
  are rows rather than a delimited string precisely so a price and a lead-time
  can hang off one later without a migration of the answers.
- It does not decide whether a change mid-production means rework. It makes sure
  a person on the floor knows about it and says so; the decision is theirs.
- It does not touch the free-text note, which is still there for the things no
  field will ever cover.
