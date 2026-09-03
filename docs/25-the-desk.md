# 25 — The desk: list, board, form, chatter

## Two shells, on purpose

A group leader works in a workshop, on a handset, with dust on their hands and
maybe no signal. Five big targets and a scanner is not a compromise for them —
it is the right interface, and nothing about a desktop client improves it.

An accountant doing the books for two hours on a 24-inch screen is a different
person with a different problem. Four tabs and a bottom sheet waste the screen
they have and hide the twenty things they might want next.

So there are two shells over exactly the same application:

| | Phone shell | Desk |
| --- | --- | --- |
| Who | everyone on the floor, and everyone on a narrow screen | office roles, at 1000px and up |
| Navigation | five tabs, the fifth opening a grouped index | a rail of every app, always visible |
| Where you are | the tab that is lit | a breadcrumb naming the app **and the record** |
| Everything else | the index sheet | ⊞, the app switcher |

**The floor never gets the desk, whatever screen it signs in on.** A leader,
an inspector or a driver on a 1600px monitor still gets the phone shell. That is
decided by whether the person's menu includes the scanner, not by the window.

Both shells render the same routes from one component, so a screen cannot exist
in one and be missing from the other.

## A collection, not a screen

Orders is the first record collection rebuilt this way, and the pattern is meant
to be followed:

**One set of records, three ways of looking at them, over one search.** Switching
view does not lose what you were looking at, because the search belongs to the
collection rather than to the view.

### The list

A dense table. Every column that can be sorted says so, and clicking a heading
sorts on it. On a phone the same table becomes one card per row — seven columns
on a handset is a table nobody reads, and sideways-scrolling a data table is
worse than not having one.

### The board

Columns are `OrderStatus`, in the order an order moves through them, each with a
count. Columns nothing is in are not drawn.

A board is only readable when its columns are a state something *moves through*.
Grouping by an arbitrary field and calling it a board produces a list with more
whitespace.

### The search

One control doing three jobs, because they compose — "late" AND "this showroom",
grouped by customer, is a question somebody actually has:

- **text** across code, customer, invoice number and product names
- **filters** (late · open · unpaid · this month) which narrow, never widen
- **group by** (status · customer · month · showroom), which turns the list into
  collapsible groups **with counts**

The count on a group header is the point of grouping. "Eleven orders waiting on
the factory" is the answer; the rows underneath are the evidence.

## The record

### The status bar

The stages across the top: everything before the current one done, the current
one lit, everything after still to come. One glance answers "how far along is
this", which is what is being asked of an order screen nine times out of ten.

### The chatter

The history was always complete — every scan, every stage, every payment — and
there was **nowhere for a person to add a sentence to it**. So the things that
actually explain an order ("customer rang, wants it after the Eid", "left a
message twice") lived in a rep's head or a paper diary, and whoever picked the
order up next had no way to know them.

**اكتب ملاحظة** puts a note into the same stream as everything else, in its
right place among the machine's own events, marked so a person's words stand out
in a wall of them. A separate list of human notes is a list nobody reads.

Two rules on it:

- **The floor does not write on the order book.** Their record is the job card.
- **A note never reaches the customer's tracking page.** That page is for where
  the piece is, not for what the showroom said to each other about them.

## What it is not

There is no drag-and-drop between kanban columns — an order's status is derived
from what has actually happened to the piece, and dragging a card to "Delivered"
would be a lie the rest of the system would immediately contradict.

There are no editable list cells, no pivot view, no activity scheduling. Those
are worth having when somebody asks for them; building all of Odoo's client
because it exists is how you end up maintaining all of Odoo's client.

## Following the pattern

To give another collection the same treatment, from `web/src/views`:

```
useSearch(rows, { text, facets, groupings })   the search, shared by both views
<SearchPanel s={s} /> <ViewSwitch />           the controls
<ListView cols={…} groups={s.groups} />        the table
<KanbanView cols={…} colOf={…} card={…} />     the board
<StatusBar stages={…} current={…} />           on the record
<Chatter entries={…} onNote={…} />             underneath it
```

and `useCrumb(record.code)` so the breadcrumb names the record rather than
printing its database key.
