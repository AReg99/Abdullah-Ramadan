import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type LocationRow, type ProductRow, type StockItem,
         type StockMovement, type Stocktake } from "../api";

type Tab = "onHand" | "movements" | "stocktake";
const TABS: Tab[] = ["onHand", "movements", "stocktake"];

const REASONS = ["OPENING", "PURCHASE", "PRODUCTION", "SALE", "RETURN", "ADJUSTMENT", "DAMAGE"];

/**
 * The store.
 *
 * What is on the shelves is never typed in. It is the sum of every movement,
 * so any figure on this screen can be asked about — which is the difference
 * between a stock system and a spreadsheet somebody keeps forgetting to update.
 */
export default function Stock() {
  const { t, lang, toast, me } = useApp();
  const ar = lang === "ar";
  const [tab, setTab] = useState<Tab>("onHand");
  const [items, setItems] = useState<StockItem[]>([]);
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Setting up what is tracked, and what it is worth, is narrower than moving
  // goods around: the storekeeper does the second all day and never the first.
  const admin = ["OWNER", "FACTORY_MANAGER", "ACCOUNTANT"].includes(me?.role ?? "");

  const load = async () => {
    setLoading(true);
    try { setItems(await api.stockItems()); }
    catch { setItems([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { api.locations().then(setStores).catch(() => setStores([])); }, []);

  const num = (v: number) =>
    v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const low = items.filter((i) => i.low);
  const value = items.reduce((s, i) => s + i.value, 0);

  return (
    <>
      <div className="row scroll-x" style={{ marginBottom: 14 }}>
        {TABS.map((x) => (
          <button key={x} className={`btn sm ${tab === x ? "pri" : "sec"}`}
                  style={{ whiteSpace: "nowrap" }} onClick={() => setTab(x)}>
            {t(`stock_${x}` as any)}
          </button>
        ))}
      </div>

      {tab === "onHand" && (
        <>
          <div className="tiles g3">
            <div className="tile">
              <span className="k">{t("stockItems")}</span>
              <div className="big mono">{num(items.length)}</div>
            </div>
            <div className="tile">
              <span className="k">{t("stockValue")}</span>
              <div className="big mono">{num(Math.round(value))}</div>
            </div>
            <div className="tile">
              <span className="k">{t("runningOut")}</span>
              <div className="big mono" style={{ color: low.length ? "var(--warn)" : undefined }}>
                {num(low.length)}
              </div>
            </div>
          </div>

          {low.length > 0 && (
            <div className="card" style={{ marginTop: 11 }}>
              <span className="k">{t("runningOut")}</span>
              {low.map((i) => (
                <div className="evt" key={i.id}>
                  <span style={{ flex: 1 }}>
                    <b>{ar ? i.nameAr : i.nameEn}</b>
                    <span className="sub mono">{i.sku} · {t("reorderAt")} {num(i.reorderLevel)}</span>
                  </span>
                  <b className="mono" style={{ color: "var(--warn)" }}>{num(i.onHand)} {i.unit}</b>
                </div>
              ))}
            </div>
          )}

          <MoveDesk items={items} stores={stores} onDone={load} />
          {admin && <NewItem stores={stores} onDone={load} />}

          {loading && <div className="empty">{t("loading")}</div>}
          {!loading && items.length === 0 && <p className="note">{t("noStockYet")}</p>}

          {items.map((i) => (
            <ItemCard key={i.id} item={i} admin={admin} onDone={load} />
          ))}
        </>
      )}

      {tab === "movements" && <Movements items={items} stores={stores} admin={admin} />}
      {tab === "stocktake" && <Stocktakes stores={stores} admin={admin} onDone={load} />}
    </>
  );
}

/** One item: what is on each shelf, and what to do about it. */
function ItemCard({ item, admin, onDone }: { item: StockItem; admin: boolean; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ unitCost: String(item.unitCost), reorderLevel: String(item.reorderLevel) });
  const [busy, setBusy] = useState(false);
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });

  return (
    <div className="card">
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm">
            {ar ? item.nameAr : item.nameEn}
            {item.kind === "PRODUCT" && (
              <span className="pill" style={{ marginInlineStart: 7 }}>{t("kind_PRODUCT")}</span>
            )}
          </span>
          <span className="sub"><span className="mono">{item.sku}</span> · {item.unit}</span>
        </span>
        <b className="mono" style={{ color: item.low ? "var(--warn)" : undefined }}>
          {num(item.onHand)}
        </b>
        {admin && <button className="chip" style={{ marginInlineStart: 9 }}
                          onClick={() => setOpen(!open)}>{t("edit")}</button>}
      </div>

      {/* Where it actually is. A single total hides the piece sitting in the
          wrong showroom. */}
      {item.byWarehouse.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {item.byWarehouse.map((w) => (
            <div className="evt" key={w.warehouseId}>
              <span style={{ flex: 1 }} className="muted">{ar ? w.nameAr : w.nameEn}</span>
              <span className="mono">{num(w.qty)} {item.unit}</span>
            </div>
          ))}
        </div>
      )}

      {open && admin && (
        <>
          <span className="k" style={{ marginTop: 12, display: "block" }}>{t("unitCost")}</span>
          <input className="mono" inputMode="decimal" value={f.unitCost}
                 onChange={(e) => setF({ ...f, unitCost: e.target.value })} style={{ marginTop: 6 }} />
          <span className="k" style={{ marginTop: 10, display: "block" }}>{t("reorderLevel")}</span>
          <input className="mono" inputMode="decimal" value={f.reorderLevel}
                 onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} style={{ marginTop: 6 }} />
          <p className="note">{t("reorderHint")}</p>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
            <button className="btn pri sm" disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api.updateStockItem(item.id, {
                          unitCost: Number(f.unitCost) || 0,
                          reorderLevel: Number(f.reorderLevel) || 0,
                        });
                        toast(t("saved")); setOpen(false); onDone();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                      finally { setBusy(false); }
                    }}>{t("save")}</button>
          </div>
          <button className="btn dang sm" style={{ marginTop: 8 }} disabled={busy}
                  onClick={async () => {
                    if (!confirm(`${t("confirmRemoveItem")}\n\n${item.nameAr}`)) return;
                    setBusy(true);
                    try {
                      const r = await api.removeStockItem(item.id);
                      toast(r.removed === "retired" ? t("retired") : t("removed"));
                      setOpen(false); onDone();
                    } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    finally { setBusy(false); }
                  }}>{t("removeAccount")}</button>
        </>
      )}
    </div>
  );
}

/** Goods in, goods out, and goods moved between stores. */
function MoveDesk({ items, stores, onDone }: { items: StockItem[]; stores: LocationRow[]; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [open, setOpen] = useState<"" | "in" | "out" | "move">("");
  const [f, setF] = useState({ itemId: "", warehouseId: "", toWarehouseId: "",
                               qty: "", reason: "PURCHASE", note: "" });
  const [busy, setBusy] = useState(false);

  const item = items.find((i) => i.id === f.itemId);
  const onShelf = item?.byWarehouse.find((w) => w.warehouseId === f.warehouseId)?.qty ?? 0;
  const itemOpts = items.map((i) => (
    <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn} · {i.sku}</option>
  ));
  const storeOpts = stores.map((w) => (
    <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>
  ));

  if (!open) {
    return (
      <div className="row scroll-x" style={{ margin: "11px 0" }}>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }}
                onClick={() => { setF({ ...f, reason: "PURCHASE" }); setOpen("in"); }}>
          {t("goodsIn")}
        </button>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }}
                onClick={() => { setF({ ...f, reason: "DAMAGE" }); setOpen("out"); }}>
          {t("goodsOut")}
        </button>
        <button className="btn sec sm" style={{ whiteSpace: "nowrap" }}
                onClick={() => setOpen("move")}>{t("moveBetween")}</button>
      </div>
    );
  }

  const transfer = open === "move";
  const short = (open === "out" || transfer) && Number(f.qty) > onShelf;

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">
        {transfer ? t("moveBetween") : open === "in" ? t("goodsIn") : t("goodsOut")}
      </span>
      <select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}
              style={{ marginTop: 8 }}>
        <option value="">{t("pickItem")}</option>{itemOpts}
      </select>
      <select value={f.warehouseId} onChange={(e) => setF({ ...f, warehouseId: e.target.value })}
              style={{ marginTop: 8 }}>
        <option value="">{transfer ? t("transferFrom") : t("pickWarehouse")}</option>{storeOpts}
      </select>
      {transfer && (
        <select value={f.toWarehouseId} onChange={(e) => setF({ ...f, toWarehouseId: e.target.value })}
                style={{ marginTop: 8 }}>
          <option value="">{t("transferTo")}</option>{storeOpts}
        </select>
      )}
      <input className="mono" inputMode="decimal" placeholder={t("qty")} value={f.qty}
             onChange={(e) => setF({ ...f, qty: e.target.value })} style={{ marginTop: 8 }} />
      {!transfer && (
        <select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}
                style={{ marginTop: 8 }}>
          {REASONS.map((r) => <option key={r} value={r}>{t(`why_${r}` as any)}</option>)}
        </select>
      )}
      <input placeholder={t("note")} value={f.note}
             onChange={(e) => setF({ ...f, note: e.target.value })} style={{ marginTop: 8 }} />

      {/* What is actually there, so nobody has to remember it. */}
      {item && f.warehouseId && (
        <p className="note" style={{ color: short ? "var(--bad)" : undefined }}>
          {t("onShelfNow")} {onShelf.toLocaleString()} {item.unit}
          {short ? ` — ${t("not_enough_stock")}` : ""}
        </p>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen("")}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !f.itemId || !f.warehouseId || !(Number(f.qty) > 0) || short
                          || (transfer && (!f.toWarehouseId || f.toWarehouseId === f.warehouseId))}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (transfer) {
                      await api.stockTransfer({
                        itemId: f.itemId, fromWarehouseId: f.warehouseId,
                        toWarehouseId: f.toWarehouseId, qty: Number(f.qty),
                        note: f.note.trim() || undefined,
                      });
                    } else {
                      await api.stockMove({
                        itemId: f.itemId, warehouseId: f.warehouseId,
                        direction: open === "in" ? "IN" : "OUT",
                        qty: Number(f.qty), reason: f.reason,
                        note: f.note.trim() || undefined,
                      });
                    }
                    toast(t("saved"));
                    setF({ itemId: "", warehouseId: "", toWarehouseId: "", qty: "",
                           reason: "PURCHASE", note: "" });
                    setOpen(""); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/** Adding something new to track. */
function NewItem({ stores, onDone }: { stores: LocationRow[]; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [f, setF] = useState({ sku: "", nameAr: "", kind: "MATERIAL", unit: "قطعة",
                               unitCost: "", reorderLevel: "", productId: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && f.kind === "PRODUCT" && products.length === 0) {
      api.products().then(setProducts).catch(() => setProducts([]));
    }
  }, [open, f.kind]);

  if (!open) {
    return (
      <button className="btn sec sm" style={{ marginBottom: 11 }} onClick={() => setOpen(true)}>
        {t("newStockItem")}
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 11 }}>
      <span className="k">{t("newStockItem")}</span>
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, productId: "" })}
              style={{ marginTop: 8 }}>
        <option value="MATERIAL">{t("kind_MATERIAL")}</option>
        <option value="PRODUCT">{t("kind_PRODUCT")}</option>
      </select>
      {/* Linking to a catalogue product is what makes a sale take it off the
          shelf by itself. */}
      {f.kind === "PRODUCT" && (
        <>
          <select value={f.productId}
                  onChange={(e) => {
                    const p = products.find((x) => x.id === e.target.value);
                    setF({ ...f, productId: e.target.value,
                           nameAr: p?.nameAr ?? f.nameAr, sku: p?.sku ?? f.sku });
                  }}
                  style={{ marginTop: 8 }}>
            <option value="">{t("pickProduct")}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.nameAr} · {p.sku}</option>)}
          </select>
          <p className="note">{t("linkProductHint")}</p>
        </>
      )}
      <input placeholder={t("itemName")} value={f.nameAr}
             onChange={(e) => setF({ ...f, nameAr: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" placeholder={t("sku")} value={f.sku}
             onChange={(e) => setF({ ...f, sku: e.target.value })} style={{ marginTop: 8 }} />
      <input placeholder={t("unit")} value={f.unit}
             onChange={(e) => setF({ ...f, unit: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("unitCost")} value={f.unitCost}
             onChange={(e) => setF({ ...f, unitCost: e.target.value })} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="decimal" placeholder={t("reorderLevel")} value={f.reorderLevel}
             onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} style={{ marginTop: 8 }} />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
        <button className="btn pri sm"
                disabled={busy || !f.sku.trim() || !f.nameAr.trim()
                          || (f.kind === "PRODUCT" && !f.productId)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.addStockItem({
                      sku: f.sku.trim(), nameAr: f.nameAr.trim(), kind: f.kind,
                      unit: f.unit.trim() || "قطعة",
                      unitCost: Number(f.unitCost) || 0,
                      reorderLevel: Number(f.reorderLevel) || 0,
                      productId: f.productId || undefined,
                    });
                    toast(t("saved"));
                    setF({ sku: "", nameAr: "", kind: "MATERIAL", unit: "قطعة",
                           unitCost: "", reorderLevel: "", productId: "" });
                    setOpen(false); onDone();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("save")}</button>
      </div>
    </div>
  );
}

/** Everything that has moved, and why. */
function Movements({ items, stores, admin }: { items: StockItem[]; stores: LocationRow[]; admin: boolean }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [rows, setRows] = useState<StockMovement[]>([]);
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setRows(await api.stockMovements({ itemId: itemId || undefined,
                                             warehouseId: warehouseId || undefined })); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [itemId, warehouseId]);

  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });
  const when = (d: string) =>
    new Date(d).toLocaleDateString(ar ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" });

  return (
    <>
      <div className="card">
        <select value={itemId} onChange={(e) => setItemId(e.target.value)}>
          <option value="">{t("allItems")}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{ar ? i.nameAr : i.nameEn}</option>)}
        </select>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                style={{ marginTop: 8 }}>
          <option value="">{t("allWarehouses")}</option>
          {stores.map((w) => <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>)}
        </select>
      </div>

      {loading && <div className="empty">{t("loading")}</div>}
      {!loading && rows.length === 0 && <p className="note">{t("noRows")}</p>}

      {rows.map((m) => (
        <div className="card" key={m.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <b>{m.item}</b>
              <span className="sub">
                {when(m.date)} · {m.warehouse} · {t(`why_${m.reason}` as any)}
                {m.by ? ` · ${m.by}` : ""}
              </span>
              {m.note && <span className="sub">{m.note}</span>}
            </span>
            <b className="mono" style={{ color: m.direction === "IN" ? "var(--ok)" : "var(--bad)" }}>
              {m.direction === "IN" ? "+" : "−"}{num(m.qty)}
            </b>
          </div>
          {admin && !m.reversal && (
            <button className="btn sec sm" style={{ marginTop: 9 }}
                    onClick={async () => {
                      const why = prompt(`${t("reverseEntry")}\n\n${t("reverseWhy")}`);
                      if (!why || why.trim().length < 3) return;
                      try {
                        await api.reverseStockMovement(m.id, why.trim());
                        toast(t("reversed")); await load();
                      } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                    }}>
              {t("act_reverse")}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * الجرد — counting the shelf against the books.
 *
 * The sheet starts at what the system believes, so a shelf that is right needs
 * no typing at all: only the differences get touched, and only those become
 * movements.
 */
function Stocktakes({ stores, admin, onDone }: { stores: LocationRow[]; admin: boolean; onDone: () => void }) {
  const { t, lang, toast } = useApp();
  const ar = lang === "ar";
  const [list, setList] = useState<{ id: string; warehouse: string; startedAt: string;
                                     postedAt: string | null; lines: number }[]>([]);
  const [open, setOpen] = useState<Stocktake | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => api.stocktakes().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  const show = async (id: string) => {
    const s = await api.stocktake(id);
    setOpen(s);
    setCounts(Object.fromEntries(s.lines.map((l) => [l.itemId, String(l.counted)])));
  };
  const num = (v: number) => v.toLocaleString(ar ? "ar-EG" : "en-GB", { maximumFractionDigits: 3 });

  if (open) {
    const changed = open.lines.filter((l) => Number(counts[l.itemId] ?? l.counted) !== l.expected);
    return (
      <>
        <div className="card">
          <div className="between">
            <span style={{ flex: 1 }}>
              <b>{open.warehouse}</b>
              <span className="sub">
                {new Date(open.startedAt).toLocaleDateString(ar ? "ar-EG" : "en-GB")}
                {open.postedAt ? ` · ${t("stocktakePosted")}` : ""}
              </span>
            </span>
            <button className="chip" onClick={() => setOpen(null)}>{t("back")}</button>
          </div>
          <p className="note">{t("stocktakeHint")}</p>
        </div>

        {open.lines.map((l) => {
          const typed = Number(counts[l.itemId] ?? l.counted);
          const diff = typed - l.expected;
          return (
            <div className="card" key={l.itemId}>
              <div className="between">
                <span style={{ flex: 1 }}>
                  <b>{l.nameAr}</b>
                  <span className="sub mono">{l.sku} · {t("expected")} {num(l.expected)} {l.unit}</span>
                </span>
                {Math.abs(diff) > 0.0005 && (
                  <b className="mono" style={{ color: diff > 0 ? "var(--ok)" : "var(--bad)" }}>
                    {diff > 0 ? "+" : "−"}{num(Math.abs(diff))}
                  </b>
                )}
              </div>
              {!open.postedAt && (
                <input className="mono" inputMode="decimal" value={counts[l.itemId] ?? String(l.counted)}
                       onChange={(e) => setCounts({ ...counts, [l.itemId]: e.target.value })}
                       style={{ marginTop: 8 }} />
              )}
            </div>
          );
        })}

        {!open.postedAt && (
          <div className="card">
            <p className="note">
              {t("differences")}: {changed.length} / {open.lines.length}
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sec sm" disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.saveStocktake(open.id, open.lines.map((l) => ({
                            itemId: l.itemId, counted: Number(counts[l.itemId] ?? l.counted) || 0,
                          })));
                          toast(t("saved")); await show(open.id);
                        } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                        finally { setBusy(false); }
                      }}>{t("save")}</button>
              {admin && (
                <button className="btn pri sm" disabled={busy}
                        onClick={async () => {
                          if (!confirm(`${t("confirmPostStocktake")}\n\n${changed.length} ${t("differences")}`)) return;
                          setBusy(true);
                          try {
                            await api.saveStocktake(open.id, open.lines.map((l) => ({
                              itemId: l.itemId, counted: Number(counts[l.itemId] ?? l.counted) || 0,
                            })));
                            const r = await api.postStocktake(open.id);
                            toast(`${t("saved")} · ${r.posted}`);
                            await show(open.id); refresh(); onDone();
                          } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                          finally { setBusy(false); }
                        }}>{t("postStocktake")}</button>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="card">
        <span className="k">{t("newStocktake")}</span>
        <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                style={{ marginTop: 8 }}>
          <option value="">{t("pickWarehouse")}</option>
          {stores.map((w) => <option key={w.id} value={w.id}>{ar ? w.nameAr : w.nameEn}</option>)}
        </select>
        <button className="btn pri sm" style={{ marginTop: 10 }} disabled={busy || !warehouseId}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api.openStocktake(warehouseId);
                    await show(r.id); refresh();
                  } catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                  finally { setBusy(false); }
                }}>{t("startCounting")}</button>
      </div>

      {list.map((s) => (
        <div className="card" key={s.id}>
          <div className="between">
            <span style={{ flex: 1 }}>
              <b>{s.warehouse}</b>
              <span className="sub">
                {new Date(s.startedAt).toLocaleDateString(ar ? "ar-EG" : "en-GB")} · {s.lines}
                {s.postedAt ? ` · ${t("stocktakePosted")}` : ` · ${t("stocktakeOpen")}`}
              </span>
            </span>
            <button className="chip" onClick={() => show(s.id)}>{t("open")}</button>
          </div>
        </div>
      ))}
      {list.length === 0 && <p className="note">{t("noStocktakes")}</p>}
    </>
  );
}
