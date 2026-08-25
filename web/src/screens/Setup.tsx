import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type GroupRow, type LocationRow, type PersonRow, type ProductRow, type Station } from "../api";

type Tab = "crews" | "staff" | "products";

/**
 * The people who sign in but do not stand at a station. Without this the app
 * could staff the factory floor and nothing else — the showroom board had no
 * way to get a manager, so it was a screen nobody could reach.
 */
const STAFF_ROLES = ["FACTORY_MANAGER", "SUPERVISOR", "SHOWROOM_MANAGER", "SALES_REP",
                     "STOREKEEPER", "QC", "DRIVER", "ACCOUNTANT"] as const;

/** Where the factory puts its own people and catalogue in. Owner and factory manager only. */
export default function Setup() {
  const { t, lang, toast } = useApp();
  const [tab, setTab] = useState<Tab>("crews");
  const [stations, setStations] = useState<Station[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cats, setCats] = useState<{ id: string; nameAr: string; nameEn: string }[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [st, gr, pe, pr, ca, lo] = await Promise.all([
      api.stations(), api.groups(), api.people(), api.products(), api.categories(), api.locations(),
    ]);
    setStations(st); setGroups(gr); setPeople(pe); setProducts(pr); setCats(ca); setLocations(lo);
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
        <button className={`btn sm ${tab === "staff" ? "pri" : "sec"}`} onClick={() => setTab("staff")}>{t("staffTab")}</button>
        <button className={`btn sm ${tab === "products" ? "pri" : "sec"}`} onClick={() => setTab("products")}>{t("productsTab")}</button>
      </div>

      {tab === "crews" && <Crews stations={stations} groups={groups} people={people} busy={busy} run={run} nm={nm} />}
      {tab === "staff" && <Staff people={people} locations={locations} stations={stations} busy={busy} run={run} nm={nm} />}
      {tab === "products" && <Products products={products} cats={cats} busy={busy} run={run} nm={nm} />}
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

function Staff({ people, locations, stations, busy, run, nm }: any) {
  const { t, lang } = useApp();
  const blank = { nameAr: "", email: "", phone: "", password: "", role: "SHOWROOM_MANAGER",
                  locationId: "", stationId: "" };
  const [p, setP] = useState(blank);
  const showrooms = locations.filter((l: LocationRow) => l.type === "SHOWROOM");
  const [room, setRoom] = useState({ nameAr: "", address: "" });

  // A branch only needs choosing when there is more than one; with a single
  // showroom the server assigns it and the field would be noise.
  const needsBranch = ["SHOWROOM_MANAGER", "SALES_REP"].includes(p.role) && showrooms.length > 1;
  // A QC inspector reads their own station's queue, exactly as a leader does.
  // Without a station their screen is simply empty, so ask for it here.
  const needsStation = p.role === "QC";
  const staff = people.filter((x: PersonRow) => x.canLogin && x.role !== "GROUP_LEADER");

  return (
    <>
      <div className="card">
        <span className="k">{t("addStaff")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("staffHint")}</p>
        <input placeholder={t("fullName")} value={p.nameAr}
               onChange={(e) => setP({ ...p, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} style={{ marginTop: 8 }}>
          {STAFF_ROLES.map((r) => <option key={r} value={r}>{t(r as any)}</option>)}
        </select>
        {needsStation && (
          <select value={p.stationId} onChange={(e) => setP({ ...p, stationId: e.target.value })} style={{ marginTop: 8 }}>
            <option value="">{t("pickStation")}</option>
            {stations.map((st: Station) => <option key={st.id} value={st.id}>{nm(st.nameAr, st.nameEn)}</option>)}
          </select>
        )}
        {needsBranch && (
          <select value={p.locationId} onChange={(e) => setP({ ...p, locationId: e.target.value })} style={{ marginTop: 8 }}>
            <option value="">{t("allShowrooms")}</option>
            {showrooms.map((l: LocationRow) => <option key={l.id} value={l.id}>{nm(l.nameAr, l.nameEn)}</option>)}
          </select>
        )}
        <input className="mono" placeholder={t("email")} value={p.email}
               onChange={(e) => setP({ ...p, email: e.target.value })} style={{ marginTop: 8 }} />
        <input className="mono" placeholder="+2010…" value={p.phone}
               onChange={(e) => setP({ ...p, phone: e.target.value })} style={{ marginTop: 8 }} />
        <input placeholder={t("password")} value={p.password}
               onChange={(e) => setP({ ...p, password: e.target.value })} style={{ marginTop: 8 }} />
        <button className="btn pri sm" style={{ marginTop: 10 }}
          disabled={busy || !p.nameAr || (!p.email && !p.phone) || p.password.length < 6
                    || (needsStation && !p.stationId)}
          onClick={() => run(() => api.addPerson({
            nameAr: p.nameAr, role: p.role, password: p.password,
            ...(p.email ? { email: p.email } : {}),
            ...(p.phone ? { phone: p.phone } : {}),
            ...(p.locationId ? { locationId: p.locationId } : {}),
            ...(p.stationId ? { stationId: p.stationId } : {}),
          }), t("saved")).then(() => setP(blank))}>
          {t("add")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("showrooms")} · {showrooms.length}</span>
        {showrooms.map((l: LocationRow) => (
          <div key={l.id} className="evt">
            <span style={{ flex: 1 }}><b>{nm(l.nameAr, l.nameEn)}</b>
              {l.address && <span className="muted"> · {l.address}</span>}</span>
          </div>
        ))}
        <input placeholder={t("showroomName")} value={room.nameAr}
               onChange={(e) => setRoom({ ...room, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <input placeholder={t("address")} value={room.address}
               onChange={(e) => setRoom({ ...room, address: e.target.value })} style={{ marginTop: 8 }} />
        <button className="btn sec sm" style={{ marginTop: 10 }} disabled={busy || !room.nameAr}
          onClick={() => run(() => api.addLocation({ nameAr: room.nameAr, address: room.address || undefined }), t("saved"))
            .then(() => setRoom({ nameAr: "", address: "" }))}>
          {t("addShowroom")}
        </button>
      </div>

      <div className="card">
        <span className="k">{t("staffTab")} · {staff.length}</span>
        <div style={{ marginTop: 8 }}>
          {staff.map((x: PersonRow) => (
            <div key={x.id} className="evt">
              <span style={{ flex: 1 }}>
                <b>{x.nameAr}</b>
                <span className="muted"> · {t(x.role as any)}</span>
                {x.locationName && <span className="muted"> · {x.locationName}</span>}
                {x.stationName && <span className="muted"> · {x.stationName}</span>}
              </span>
              <span className="mono muted">{x.email ?? x.phone}</span>
            </div>
          ))}
          {staff.length === 0 && <p className="note">{lang === "ar" ? "لسه مفيش موظفين" : "No staff yet"}</p>}
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
