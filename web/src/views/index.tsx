import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "../app-context";

/**
 * The view primitives, in the sense an ERP means them: one set of records, seen
 * three ways, over one search.
 *
 * This is the part of Odoo's client worth having. A record collection is not a
 * screen — it is data that different people need to look at differently on the
 * same afternoon. The showroom manager wants a board of what is where; the
 * accountant wants a dense table they can sort by value; anybody chasing one
 * order wants that order. Building three screens gives you three things to keep
 * in step. Building one collection with three views does not.
 *
 * What is deliberately *not* here: this is for the office. The floor keeps its
 * own screens — a job card is two taps and a photo, and no amount of list-view
 * machinery improves it.
 */

// --------------------------------------------------------------- the search

export type Facet = { key: string; label: string; test: (r: any) => boolean };
export type Grouping = { key: string; label: string; of: (r: any) => string };

/**
 * Text, filters and grouping over one collection.
 *
 * Odoo's search is one control doing three jobs, and the reason it works is
 * that they compose: "late" AND "this showroom", grouped by customer, is a
 * question somebody actually has. Kept as state here so all three views share
 * it — switching from list to kanban must not lose what you were looking at.
 */
export function useSearch<T>(rows: T[], opts: {
  text: (r: T) => string;
  facets?: Facet[];
  groupings?: Grouping[];
}) {
  const [q, setQ] = useState("");
  const [on, setOn] = useState<string[]>([]);
  const [groupBy, setGroupBy] = useState<string>("");

  const facets = opts.facets ?? [];
  const groupings = opts.groupings ?? [];

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (needle && !opts.text(r).toLowerCase().includes(needle)) return false;
      // Every chosen filter must hold: they narrow, they do not widen.
      return on.every((k) => facets.find((f) => f.key === k)?.test(r) ?? true);
    });
  }, [rows, q, on, facets, opts]);

  const groups = useMemo(() => {
    const g = groupings.find((x) => x.key === groupBy);
    if (!g) return null;
    const map = new Map<string, T[]>();
    for (const r of found) {
      const k = g.of(r) || "—";
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map].sort((a, b) => a[0].localeCompare(b[0]));
  }, [found, groupBy, groupings]);

  const toggle = (k: string) =>
    setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return { q, setQ, on, toggle, groupBy, setGroupBy, found, groups, facets, groupings };
}

export function SearchPanel({ s, placeholder }: { s: any; placeholder: string }) {
  const { t } = useApp();
  return (
    <div className="searchbar">
      <input className="searchbox" value={s.q} placeholder={placeholder}
             onChange={(e: any) => s.setQ(e.target.value)} />
      {s.facets.length > 0 && (
        <div className="facets">
          <span className="facet-k">{t("filters")}</span>
          {s.facets.map((f: Facet) => (
            <button key={f.key} type="button"
                    className={`chip${s.on.includes(f.key) ? " on" : ""}`}
                    aria-pressed={s.on.includes(f.key)}
                    onClick={() => s.toggle(f.key)}>{f.label}</button>
          ))}
        </div>
      )}
      {s.groupings.length > 0 && (
        <div className="facets">
          <span className="facet-k">{t("groupBy")}</span>
          {s.groupings.map((g: Grouping) => (
            <button key={g.key} type="button"
                    className={`chip${s.groupBy === g.key ? " on" : ""}`}
                    aria-pressed={s.groupBy === g.key}
                    onClick={() => s.setGroupBy(s.groupBy === g.key ? "" : g.key)}>
              {g.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the views

export type ViewKind = "list" | "kanban";

export function ViewSwitch({ view, setView }: {
  view: ViewKind; setView: (v: ViewKind) => void;
}) {
  const { t } = useApp();
  return (
    <div className="viewswitch" role="group" aria-label={t("view")}>
      <button type="button" aria-pressed={view === "list"}
              onClick={() => setView("list")} title={t("listView")}>☰</button>
      <button type="button" aria-pressed={view === "kanban"}
              onClick={() => setView("kanban")} title={t("kanbanView")}>▨</button>
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  /** Right-aligned tabular figures. */
  num?: boolean;
  /** Narrow, never the column that grows. */
  tight?: boolean;
  cell: (r: T) => ReactNode;
  /** What to sort on. Absent means the column does not sort. */
  sort?: (r: T) => string | number;
};

/**
 * The dense table.
 *
 * Sortable on any column that says how, grouped where the search says to, and
 * every row opens the record. The count on a group header is the point of
 * grouping — "eleven orders waiting on the factory" is the answer, and the rows
 * under it are only the evidence.
 */
export function ListView<T extends { id: string }>({ rows, groups, cols, onOpen, empty }: {
  rows: T[];
  groups: [string, T[]][] | null;
  cols: Column<T>[];
  onOpen: (r: T) => void;
  empty: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);

  const order = (list: T[]) => {
    const c = cols.find((x) => x.key === sort?.key);
    if (!c?.sort) return list;
    return [...list].sort((a, b) => {
      const av = c.sort!(a), bv = c.sort!(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * (sort!.dir);
    });
  };

  const head = (
    <thead>
      <tr>
        {cols.map((c) => (
          <th key={c.key} className={c.num ? "num" : ""}
              style={{ width: c.tight ? 1 : undefined }}>
            {c.sort
              ? <button type="button" className="sorter"
                        onClick={() => setSort((s) =>
                          s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 }
                                           : { key: c.key, dir: 1 })}>
                  {c.label}
                  <span className="arrow">{sort?.key === c.key ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
                </button>
              : c.label}
          </th>
        ))}
      </tr>
    </thead>
  );

  const body = (list: T[]) => (
    <tbody>
      {order(list).map((r) => (
        <tr key={r.id} tabIndex={0} className="rowlink"
            onClick={() => onOpen(r)}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(r); }}>
          {cols.map((c) => (
            <td key={c.key} className={c.num ? "num" : ""}>{c.cell(r)}</td>
          ))}
        </tr>
      ))}
    </tbody>
  );

  if (!rows.length) return <p className="empty">{empty}</p>;

  return (
    <div className="tbl-wrap">
      {groups
        ? groups.map(([name, list]) => (
            <details key={name} className="grp" open>
              <summary>{name} <span className="count">{list.length}</span></summary>
              <table className="listview">{head}{body(list)}</table>
            </details>
          ))
        : <table className="listview">{head}{body(rows)}</table>}
    </div>
  );
}

export type KanbanCol = { key: string; label: string; tone?: "ok" | "warn" | "bad" };

/**
 * The board.
 *
 * Columns are a state somebody moves through, not an arbitrary grouping — that
 * is what makes a board readable at a glance rather than being a list with more
 * whitespace. Where a grouping is chosen in the search, it wins: the question
 * "what is each customer waiting on" is a board too.
 */
export function KanbanView<T extends { id: string }>({ rows, cols, colOf, card, onOpen, empty }: {
  rows: T[];
  cols: KanbanCol[];
  colOf: (r: T) => string;
  card: (r: T) => ReactNode;
  onOpen: (r: T) => void;
  empty: string;
}) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  const used = cols.filter((c) => rows.some((r) => colOf(r) === c.key));
  return (
    <div className="kanban">
      {used.map((c) => {
        const list = rows.filter((r) => colOf(r) === c.key);
        return (
          <div key={c.key} className="kcol">
            <div className={`kcol-h${c.tone ? " " + c.tone : ""}`}>
              {c.label} <span className="count">{list.length}</span>
            </div>
            {list.map((r) => (
              <button key={r.id} type="button" className="kcard" onClick={() => onOpen(r)}>
                {card(r)}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------- the form

/**
 * The stages of a record, across the top of its form.
 *
 * Everything before the current one is done, the current one is where it is,
 * everything after is still to come. One glance answers "how far along is
 * this", which on an order screen is the question being asked nine times out of
 * ten.
 */
export function StatusBar({ stages, current }: { stages: { key: string; label: string }[]; current: string }) {
  const at = stages.findIndex((s) => s.key === current);
  return (
    <div className="statusbar" role="list">
      {stages.map((s, i) => (
        <span key={s.key} role="listitem"
              className={`stage${i < at ? " done" : i === at ? " now" : ""}`}>
          {s.label}
        </span>
      ))}
    </div>
  );
}

export type ChatterEntry = {
  id: string;
  kind: "note" | "event";
  when: string;
  who: string | null;
  title: string;
  body?: string | null;
};

/**
 * The chatter: what happened to this record, and somewhere to say something.
 *
 * The history was already complete — every scan, every stage, every payment —
 * and there was nowhere for a person to add a sentence to it. So the things
 * that actually explain an order ("customer rang, wants it after the Eid")
 * lived in somebody's head, and whoever picked the order up next had no way to
 * know them.
 *
 * A note goes into the same stream as the machine's own events, in its right
 * place among them, because a separate list of human notes is a list nobody
 * reads.
 */
export function Chatter({ entries, onNote, busy }: {
  entries: ChatterEntry[];
  onNote?: (note: string) => Promise<void>;
  busy?: boolean;
}) {
  const { t, lang } = useApp();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const when = (s: string) =>
    new Date(s).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB",
                               { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="chatter">
      <div className="between">
        <span className="k">{t("history")}</span>
        {onNote && !open && (
          <button className="chip" onClick={() => setOpen(true)}>{t("logNote")}</button>
        )}
      </div>

      {onNote && open && (
        <div style={{ marginTop: 9 }}>
          <textarea rows={3} value={text} placeholder={t("notePlaceholder")}
                    onChange={(e) => setText(e.target.value)} />
          <div className="row wrap" style={{ marginTop: 9 }}>
            <button className="btn pri sm toggle" disabled={busy || !text.trim()}
                    onClick={async () => { await onNote(text.trim()); setText(""); setOpen(false); }}>
              {t("postNote")}
            </button>
            <button className="btn sec sm toggle"
                    onClick={() => { setOpen(false); setText(""); }}>{t("cancel")}</button>
          </div>
        </div>
      )}

      <ol className="thread">
        {entries.map((e) => (
          <li key={e.id} className={e.kind === "note" ? "note-entry" : ""}>
            <span className="dot" aria-hidden="true" />
            <div>
              <div className="thread-h">
                <b>{e.title}</b>
                <span className="muted mono">{when(e.when)}</span>
              </div>
              {e.body && <div className="thread-b">{e.body}</div>}
              {e.who && <span className="sub muted">{e.who}</span>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
