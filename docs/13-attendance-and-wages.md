# 13 — Attendance & wages

The floor is paid **weekly, for the days they were actually in**. The office is
paid **monthly**. Both run through the same payroll.

## How somebody is paid

Set in Setup → Staff, by the owner or the accountant only:

- **By the day** (`DAILY`) — a day rate, paid weekly.
- **Monthly** (`MONTHLY`) — a salary, paid monthly.

Somebody given a day rate and no salary is plainly on the floor, so the system
says so without being asked. Clearing the figure takes them off the payroll,
which is not the same as being paid zero.

## الحضور — the register

One row per person per day, because that is how it is actually taken: a name
and a tick each morning.

**Everybody starts present.** That is what happens most mornings, and the person
holding the phone at seven should only have to touch the exceptions. Four
states:

| | Counts as | |
| --- | --- | --- |
| **حاضر** In | 1 day | |
| **نص يوم** Half day | ½ day | |
| **إجازة مدفوعة** Paid leave | 1 day | Away, still paid — annual leave, a public holiday |
| **غايب** Away | 0 | Away, not paid |

Two things it refuses: a day that has not happened yet — always a mistyped date,
and it would quietly inflate a wage — and any change to a week that has already
been paid.

The week view is a row per person and a column per day, with the days totalled
and priced.

## The pay period

A period is a key: `2026-08` for a month, `2026-W35` for a week.

**Weeks run Saturday to Friday**, which is the working week in Egypt. This is
deliberately not ISO 8601, whose weeks start on Monday and would cut every
Egyptian week across two pay periods. You pick a week by naming any day in it,
because nobody knows what week number it is.

## What a payslip comes to

```
weekly   net = (days worked × day rate) + overtime + bonus − advance − deduction − insurance
monthly  net = salary                   + overtime + bonus − advance − deduction − insurance
```

Adjustments live on the **period**, not on the wage, because the next one starts
clean: an advance taken in one week must not quietly repeat in the next.

Nobody is ever paid a negative amount. Somebody whose advances swallowed the
whole wage is simply not paid this period, and no empty voucher is written.

**A weekly run pays only people on a day rate; a monthly run pays only people on
a salary.** Paying everybody in both would pay the office twice.

## Posting

One cash entry per person, so a single payslip can be reversed without unpicking
the rest, and each gets its own payment voucher number. Wages land on the last
day of the period worked, not the day the money moved.

A period can only be paid once. Once posted, the run is the record: an old week
reads back with the days and the rate that earned it, not with today's figures.

## Who may do what

- **Taking the register** — owner, factory manager, supervisor, accountant.
  Whoever is on the floor at seven has to be able to mark who turned up, and the
  accountant needs it to pay. QC and crew leaders have no register.
- **Wages** — owner and accountant only. The supervisor takes the register
  without ever seeing what anybody earns.

The payroll and the register both sit in the accountant's own navigation, which
is where the weekly job actually happens.

## Not built

- **Clocking in and out by time.** Attendance is a day, or half a day. Hours
  beyond that go on as overtime, in money rather than in hours.
- **Statutory Egyptian social-insurance calculation.** Insurance is a figure you
  enter, not one the system works out from the wage brackets.
- **End-of-service and annual-leave balances.**
