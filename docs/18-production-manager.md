# 18 — The production manager

## Why a separate job

The app had a **مدير المصنع** — the person who staffs the plant, answers for
it, and configures it. It had no **مدير الإنتاج**: the person who decides *what
gets made in what order*, watches where the queue is piling up, and knows which
promises are about to be missed.

In a furniture shop these are two people and two jobs. Running the factory is
about people and machines; planning it is about sequence and load.

## The parts that were already there

The schema has carried three fields since the first release, and **nothing ever
read or wrote any of them**:

| | |
|---|---|
| `WorkOrder.priority` | The floor's work list has been sorting by it all along |
| `Station.dailyCapacityMinutes` | What a station can do in a day |
| `RoutingStage.stdMinutes` | How long each stage should take |

So every work order sat at priority zero — the sort was real and the data behind
it was meaningless — and the one number a production manager lives by, *where
the pile-up is*, could not be read anywhere.

## طابور الشغل — the queue

Every piece still to be made, **in the order the floor actually sees it**.

A planning board that disagrees with the work list is worse than no board: the
manager reorders something, the floor does not move, and nobody trusts either
screen again. So the board sorts exactly as `/work/today` sorts — priority
first, then the promise date.

Each piece shows what a decision needs: which order and customer, how far along
it is, **which station it is standing at**, how many hours of standard work are
left in it, when it was promised, and how many days that is from now.

The tiles across the top double as filters: open, late, blocked, at risk,
bumped, hours of work left.

### Bumping a piece

Three levels — **عادي / مستعجل / حرج** — not a free number. Free numbers become
1, 5, 10 and 100 within a fortnight and then nobody on the floor knows what a 7
means. Within a level the promise date decides, which is the honest tie-break.

The change reaches every station **the moment it is made**. There is no planning
run and nothing to publish: the floor's work list already sorted by this field.

Raising one piece lowers every other one, so the reason is asked for at the time
and written to the event stream — `WO_PRIORITY_SET`, with who, from what, to
what, and why. The floor is entitled to know who moved their queue.

## تحميل المحطات — station load

For each station: the standard minutes queued in front of it, against what it
can do in a day.

```
days of queue = work waiting at the station ÷ its daily capacity
```

**The bottleneck is named**, not left to be worked out. A list of numbers makes
the reader hunt for it, and the bottleneck is the reason they opened the screen.
"Cutting has eleven days in front of it and finishing has one" is a decision
about where to move people, and no screen in the app could say it.

Also shown per station: pieces waiting, how many are on the bench right now, how
many are blocked, and how many people can stand there — eight days of queue with
four people is not the same problem as eight days with nobody.

### Capacity is editable here

The load figures are worthless against a capacity nobody has ever corrected, and
the person who reads them is the person who knows. Editable from this screen
rather than only from setup.

Capacity is **per station, not per head**: a second bench does not double a
single machine.

## What the job can reach

| Screen | Why |
|---|---|
| التخطيط | The job |
| اليوم · المصنع | What is happening right now |
| الطلبات · الملصقات · التسليم للمعرض | The work itself |
| الجودة | What is being sent back, and from where |
| الحضور | Who turned up — capacity is people |
| المخزن · المشتريات | A stopped station is usually a missing material |

**Not** the money, the summary, the staff form, or setup. Planning production
does not require the books, and hiring is the factory manager's.

The factory manager can hand out the job; so can the owner.

## Two role lists that had drifted

Adding a role exposed three more copies of the list of jobs: one in the staff
form's validation, one deciding who may dispatch to the showroom, one deciding
who sees work at every station rather than only their own. The staff form's copy
meant a role added to the schema was **rejected by the one place somebody could
be hired into it**.

All three now read from `ROLE_KEYS` and the scope lists in `api/src/auth/scopes.ts`,
which is the file that exists so exactly this cannot happen.

## Not built

- **Automatic scheduling.** Nothing assigns a start date to a piece or levels
  the load for you. The manager decides; the board tells them what they need to
  decide it.
- **Planned start and end dates.** `WorkOrder.plannedStart` and `plannedEnd` are
  still unused. Hand-entering target dates for every piece is data entry nobody
  keeps up in a twenty-person factory; the load calculation answers the same
  question without the typing.
- **A promise date the system will stand behind.** Telling a customer a
  realistic date from the current load is the next piece.
- **Finite-capacity sequencing per station.** The queue is one list for the
  factory, not a plan per bench.
