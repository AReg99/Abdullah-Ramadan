import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type GroupRow, type PersonRow, type ProductRow, type Station } from "../api";

type Tab = "crews" | "products";

/** Where the factory puts its own people and catalogue in. Owner and factory manager only. */
export default function Setup() {
  const { t, lang, toast } = useApp();
  const [tab, setTab] = useState<Tab>("crews");
  const [stations, setStations] = useState<Station[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cats, setCats] = useState<{ id: string; nameAr: string; nameEn: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [st, gr, pe, pr, ca] = await Promise.all([
      api.stations(), api.groups(), api.people(), api.products(), api.categories(),
    ]);
    setStations(st); setGroups(gr); setPeople(pe); setProducts(pr); setCats(ca);
  };
  useEffect(() => { load().catch(() => toast("error")); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); toast(ok); }
    catch (e: any) { toast(e?.code ?? "error"); }
    finally { setBusy(false); }
  };
  const nm = (a: string, e: string) => (lang === "ar" ? a : e);

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={`btn sm ${tab === "crews" ? "pri" : "sec"}`} onClick={() => setTab("crews")}>{t("crewsTab")}</button>
        <button className={`btn sm ${tab === "products" ? "pri" : "sec"}`} onClick={() => setTab("products")}>{t("productsTab")}</button>
      </div>

      {tab === "crews" ? (
        <Crews stations={stations} groups={groups} people={people} busy={busy} run={run} nm={nm} />
      ) : (
        <Products products={products} cats={cats} busy={busy} run={run} nm={nm} />
      )}
    </>
  );
}

function Crews({ stations, groups, people, busy, run, nm }: any) {
  const { t, lang } = useApp();
  const [g, setG] = useState({ nameAr: "", stationId: "" });
  const [l, setL] = useState({ nameAr: "", phone: "", password: "", groupId: "" });
  const [w, setW] = useState({ nameAr: "", groupId: "" });

  return (
    <>
      {groups.map((grp: GroupRow) => (
        <div className="card" key={grp.id}>
          <div className="between">
            <b>{nm(grp.nameAr, grp.nameEn)}</b>
            <span className="pill pri">{nm(grp.stationAr, grp.stationEn)}</span>
          </div>
          <div className="note" style={{ marginTop: 6 }}>
            {grp.leader
              ? <>{t("leader")}: <b style={{ color: "var(--g9)" }}>{grp.leader.nameAr}</b> <span className="mono">{grp.leader.phone}</span></>
              : <span style={{ color: "var(--bad)" }}>{t("noLeader")}</span>}
          </div>
          {grp.members.length > 0 && (
            <div className="crew" style={{ marginTop: 9 }}>
              {grp.members.map((m) => <span key={m.id} className="crewchip on">{m.nameAr}</span>)}
            </div>
          )}
        </div>
      ))}

      <div className="card">
        <span className="k">{t("addGroup")}</span>
        <input placeholder={t("groupName")} value={g.nameAr} onChange={(e) => setG({ ...g, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <select value={g.stationId} onChange={(e) => setG({ ...g, stationId: e.target.value })} style={{ marginTop: 8 }}>
          <option value="">{t("pickStation")}</option>
          {stations.map((s: Station) => <option key={s.id} value={s.id}>{nm(s.nameAr, s.nameEn)}</option>)}
        </select>
        <button className="btn pri sm" style={{ marginTop: 10 }} disabled={busy || !g.nameAr || !g.stationId}
          onClick={() => run(() => api.addGroup(g), t("saved")).then(() => setG({ nameAr: "", stationId: "" }))}>
          {t("add")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("addLeader")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("leaderHint")}</p>
        <input placeholder={t("fullName")} value={l.nameAr} onChange={(e) => setL({ ...l, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <input className="mono" placeholder="+2010…" value={l.phone} onChange={(e) => setL({ ...l, phone: e.target.value })} style={{ marginTop: 8 }} />
        <input placeholder={t("password")} value={l.password} onChange={(e) => setL({ ...l, password: e.target.value })} style={{ marginTop: 8 }} />
        <select value={l.groupId} onChange={(e) => setL({ ...l, groupId: e.target.value })} style={{ marginTop: 8 }}>
          <option value="">{t("pickGroup")}</option>
          {groups.map((x: GroupRow) => <option key={x.id} value={x.id}>{nm(x.nameAr, x.nameEn)}</option>)}
        </select>
        <button className="btn pri sm" style={{ marginTop: 10 }}
          disabled={busy || !l.nameAr || !l.phone || l.password.length < 6 || !l.groupId}
          onClick={() => {
            const grp = groups.find((x: GroupRow) => x.id === l.groupId);
            return run(() => api.addPerson({
              nameAr: l.nameAr, role: "GROUP_LEADER", phone: l.phone,
              password: l.password, groupId: l.groupId, stationId: grp?.stationId,
            }), t("saved")).then(() => setL({ nameAr: "", phone: "", password: "", groupId: "" }));
          }}>
          {t("add")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("addWorker")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("workerHint")}</p>
        <input placeholder={t("fullName")} value={w.nameAr} onChange={(e) => setW({ ...w, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <select value={w.groupId} onChange={(e) => setW({ ...w, groupId: e.target.value })} style={{ marginTop: 8 }}>
          <option value="">{t("pickGroup")}</option>
          {groups.map((x: GroupRow) => <option key={x.id} value={x.id}>{nm(x.nameAr, x.nameEn)}</option>)}
        </select>
        <button className="btn pri sm" style={{ marginTop: 10 }} disabled={busy || !w.nameAr || !w.groupId}
          onClick={() => {
            const grp = groups.find((x: GroupRow) => x.id === w.groupId);
            return run(() => api.addPerson({ nameAr: w.nameAr, role: "GROUP_LEADER", canLogin: false,
              groupId: w.groupId, stationId: grp?.stationId }), t("saved"))
              .then(() => setW({ nameAr: "", groupId: "" }));
          }}>
          {t("add")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("everyone")} · {people.filter((p: PersonRow) => p.isActive).length}</span>
        <div style={{ marginTop: 8 }}>
          {people.filter((p: PersonRow) => p.isActive).map((p: PersonRow) => (
            <div key={p.id} className="evt">
              <span style={{ flex: 1 }}>
                <b>{p.nameAr}</b>
                <span className="muted"> · {p.canLogin ? (lang === "ar" ? "بيسجل دخول" : "signs in") : (lang === "ar" ? "عامل" : "worker")}</span>
                {p.groupName && <span className="muted"> · {p.groupName}</span>}
              </span>
              {p.phone && <span className="mono muted">{p.phone}</span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Products({ products, cats, busy, run, nm }: any) {
  const { t } = useApp();
  const [c, setC] = useState("");
  const [p, setP] = useState({ sku: "", nameAr: "", categoryId: "", basePrice: "", baseLeadDays: "14" });

  return (
    <>
      {products.map((x: ProductRow) => (
        <div className="job" key={x.id}>
          <span style={{ flex: 1 }}>
            <span className="nm">{x.nameAr}</span>
            <span className="sub"><span className="mono">{x.sku}</span> · {x.categoryAr} · <span className="mono">{x.basePrice.toLocaleString()}</span> EGP</span>
          </span>
        </div>
      ))}

      <div className="card">
        <span className="k">{t("addCategory")}</span>
        <input placeholder={t("categoryName")} value={c} onChange={(e) => setC(e.target.value)} style={{ marginTop: 8 }} />
        <button className="btn sec sm" style={{ marginTop: 10 }} disabled={busy || !c}
          onClick={() => run(() => api.addCategory({ nameAr: c }), t("saved")).then(() => setC(""))}>
          {t("add")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("addProduct")}</span>
        <input placeholder={t("productName")} value={p.nameAr} onChange={(e) => setP({ ...p, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <input className="mono" placeholder={t("sku")} value={p.sku} onChange={(e) => setP({ ...p, sku: e.target.value })} style={{ marginTop: 8 }} />
        <select value={p.categoryId} onChange={(e) => setP({ ...p, categoryId: e.target.value })} style={{ marginTop: 8 }}>
          <option value="">{t("pickCategory")}</option>
          {cats.map((x: any) => <option key={x.id} value={x.id}>{x.nameAr}</option>)}
        </select>
        <input className="mono" inputMode="numeric" placeholder={t("price")} value={p.basePrice}
          onChange={(e) => setP({ ...p, basePrice: e.target.value })} style={{ marginTop: 8 }} />
        <input className="mono" inputMode="numeric" placeholder={t("leadDays")} value={p.baseLeadDays}
          onChange={(e) => setP({ ...p, baseLeadDays: e.target.value })} style={{ marginTop: 8 }} />
        <button className="btn pri sm" style={{ marginTop: 10 }}
          disabled={busy || !p.nameAr || !p.sku || !p.categoryId || !p.basePrice}
          onClick={() => run(() => api.addProduct({
            sku: p.sku, nameAr: p.nameAr, categoryId: p.categoryId,
            basePrice: Number(p.basePrice), baseLeadDays: Number(p.baseLeadDays) || 14,
          }), t("saved")).then(() => setP({ sku: "", nameAr: "", categoryId: "", basePrice: "", baseLeadDays: "14" }))}>
          {t("add")}
        </button>
      </div>
    </>
  );
}
