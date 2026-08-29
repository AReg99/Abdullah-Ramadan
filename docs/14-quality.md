# 14 — Quality

## The problem it fixes

The inspector had a station and worked it exactly like a group leader: start the
stage, take a photo, tap Finish. Which meant **"it passed" and "somebody tapped
Finish" were the same event**. There was no quality record, so there was no
quality report, so nothing about defects could be answered at all.

## The gate

A routing stage can be marked an **inspection gate**. Finishing one the ordinary
way is refused — it asks for a verdict instead. The seeded QC stage is a gate,
and any routing that already had one is upgraded on the next start.

Three verdicts:

| | | What happens |
| --- | --- | --- |
| **عدّت** | Passed | The stage closes and production carries on. |
| **ترجع تتصلّح** | Send back | The named station reopens, everything after it waits again, and the piece comes back to the gate. |
| **خردة** | Scrap | The piece is written off with a reason. The stage closes so the floor is not left holding a job it cannot finish. |

A rejection must name **what was wrong**, and a rework must name **where it goes
back to**. Both are refused otherwise — a fault nobody recorded is a fault
nobody can fix, and a rework with no destination is just a stalled job.

It can only be sent **backwards**. The screen offers only stages the piece has
already been through, and the server refuses anything else.

## Every inspection is kept

A verdict is its own record, not a status on the stage. A piece can be
inspected, rejected, reworked and inspected again — and **"how many went back"
is only answerable if each pass is kept**. The inspector sees the earlier
verdicts before giving a new one, so the same fault is not waved through the
second time.

## Where faults come from

That is the point of the module. The report groups by:

- **Fault** — what goes wrong most.
- **Station** — where it comes from. Not always where it was found: a bad cut is
  discovered at final QC, and the defect is attributed to the station the piece
  is sent back to.
- **Crew** — who was on it.
- **Product** — which model fails most often, as a rate rather than a count, so a
  model you make twice a year is not flattered by a model you make weekly.

Plus the number a factory manager actually watches: the **pass rate**.

A count with nobody attached to it changes nothing on the floor, which is why
the attribution is not optional decoration.

## The vocabulary of faults

Eight fault types ship with the system — scratch, bad joint, finish defect,
wrong measurement, fabric fault, hardware, timber flaw, something else. The
owner adds more, because every workshop has its own words for what goes wrong,
and **a list nobody can add to is a list that gets bypassed with "other"**.

A fault type that has been used is retired rather than deleted; the reports
behind it would otherwise start describing nothing.

## Who may do what

- **A verdict** — the inspector, plus the owner, factory manager and supervisor.
  Wide enough that a piece is not stuck when the inspector is off.
- **The fault list** — the owner. It is the vocabulary the whole report is
  grouped by, not a preference.
- **The report** — everybody who runs the floor, and the inspector on their own
  work.

## One thing that works differently

Unlike the rest of the shop floor, **a verdict is not queued offline**. A rework
reopens a station and changes what other people see next, so it needs an answer
from the server rather than a promise from the phone. Starting, finishing,
pausing and photographing all still work with no signal.

## Not built

- **Photos of the defect itself.** The stage's photos are attached to the
  inspection's stage, but there is no defect-specific capture yet.
- **A checklist per product** — a list of points to check rather than a single
  verdict.
- **CAPA** — tracking what was done about a recurring fault, as opposed to
  recording the fault.
