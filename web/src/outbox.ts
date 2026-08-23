/**
 * The outbox. Factory Wi-Fi drops and so do customers' flats, so the rule is:
 * the app never blocks on the network.
 *
 * Every mutation is written here first with its own id and the device clock,
 * then replayed in order when the connection returns. The server is idempotent
 * on clientEventId, so a retried batch is a no-op and a double tap cannot
 * double-count. occurredAt travels with the action, so a scan at 09:12 that
 * syncs at 11:40 still counts at 09:12.
 */
const DB_NAME = "aura-outbox";
const STORE = "queue";

export type Job =
  | { kind: "start" | "resume" | "finish"; stageId: string; clientEventId: string; occurredAt: string }
  | { kind: "pause"; stageId: string; reason: string; note?: string; clientEventId: string; occurredAt: string }
  | { kind: "photo"; stageId: string; photoKind: "BEFORE" | "AFTER"; blob: Blob; w: number; h: number;
      clientEventId: string; occurredAt: string };

type Row = Job & { id: number; tries: number };

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE))
        r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const outbox = {
  add: (job: Job) => tx("readwrite", (s) => s.add({ ...job, tries: 0 } as any)),
  all: () => tx<Row[]>("readonly", (s) => s.getAll() as IDBRequest<Row[]>),
  remove: (id: number) => tx("readwrite", (s) => s.delete(id)),
  bump: async (row: Row) => tx("readwrite", (s) => s.put({ ...row, tries: row.tries + 1 })),
  count: async () => (await outbox.all()).length,
};

type Listener = (pending: number, online: boolean) => void;
const listeners = new Set<Listener>();
export const onSyncChange = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
const notify = async () => {
  const n = await outbox.count();
  listeners.forEach((l) => l(n, navigator.onLine));
};

let running = false;

/** Drains the queue in order. Order matters: a photo must land before its gate. */
export async function flush(send: (job: Row) => Promise<void>) {
  if (running || !navigator.onLine) { await notify(); return; }
  running = true;
  try {
    const rows = (await outbox.all()).sort((a, b) => a.id - b.id);
    for (const row of rows) {
      try {
        await send(row);
        await outbox.remove(row.id);
      } catch (e: any) {
        // 4xx that is not auth means the server rejected it for good — drop it
        // rather than blocking the queue behind a job that can never succeed.
        const status = e?.status ?? 0;
        if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
          await outbox.remove(row.id);
          continue;
        }
        await outbox.bump(row);
        break; // preserve order; retry from here next time
      }
    }
  } finally {
    running = false;
    await notify();
  }
}

export const queued = notify;
