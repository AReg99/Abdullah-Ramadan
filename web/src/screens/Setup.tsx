import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type GroupRow, type LocationRow, type PersonRow, type ProductPhoto, type ProductRow, type Station } from "../api";

type Tab = "crews" | "staff" | "products" | "company";

/**
 * Where the business puts its own people and catalogue in.
 *
 * The factory manager gets the crews and the staff list; the catalogue and its
 * prices stay with the owner. Which roles his staff form offers is not decided
 * here — the server says what he may hand out, and the form asks.
 */
export default function Setup() {
  const { t, lang, toast, me } = useApp();
  // Each half of Setup belongs to different people: the factory's crews and
  // staff to whoever runs the factory, the catalogue to whoever sells from it.
  const catalogue = ["OWNER", "SHOWROOM_MANAGER", "SALES_REP"].includes(me?.role ?? "");
  const factory = ["OWNER", "FACTORY_MANAGER"].includes(me?.role ?? "");
  // A tax rate and the name on the invoice are the owner's alone.
  const owner = me?.role === "OWNER";
  const [tab, setTab] = useState<Tab>(factory ? "crews" : "products");
  const [stations, setStations] = useState<Station[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cats, setCats] = useState<{ id: string; nameAr: string; nameEn: string }[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [roles, setRoles] = useState<string[]>([]);

  // Each of these is fetched on its own terms. Not everyone on this screen may
  // read all of it, and one refusal should leave the rest of the page working
  // rather than blanking it.
  const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const load = async () => {
    const [st, gr, pe, pr, ca, lo, ro] = await Promise.all([
      soft(api.stations(), [] as Station[]),
      soft(api.groups(), [] as GroupRow[]),
      soft(api.people(), [] as PersonRow[]),
      soft(api.products(), [] as ProductRow[]),
      soft(api.categories(), [] as { id: string; nameAr: string; nameEn: string }[]),
      soft(api.locations(), [] as LocationRow[]),
      soft(api.grantableRoles(), [] as string[]),
    ]);
    setStations(st); setGroups(gr); setPeople(pe);
    setProducts(pr); setCats(ca); setLocations(lo); setRoles(ro);
  };
  useEffect(() => { load().catch(() => toast("error")); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); await load(); toast(ok); }
    // Show the message, not the machine's code for it.
    catch (e: any) { toast(e?.code ? t(e.code) : "error"); }
    finally { setBusy(false); }
  };
  const nm = (a: string, e: string) => (lang === "ar" ? a : e);

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        {factory && (
          <>
            <button className={`btn sm ${tab === "crews" ? "pri" : "sec"}`} onClick={() => setTab("crews")}>{t("crewsTab")}</button>
            <button className={`btn sm ${tab === "staff" ? "pri" : "sec"}`} onClick={() => setTab("staff")}>{t("staffTab")}</button>
          </>
        )}
        {catalogue && (
          <button className={`btn sm ${tab === "products" ? "pri" : "sec"}`}
                  onClick={() => setTab("products")}>{t("productsTab")}</button>
        )}
        {owner && (
          <button className={`btn sm ${tab === "company" ? "pri" : "sec"}`}
                  onClick={() => setTab("company")}>{t("companyTab")}</button>
        )}
      </div>

      {tab === "crews" && factory && <Crews stations={stations} groups={groups} people={people}
                                 roles={roles} busy={busy} run={run} nm={nm} />}
      {tab === "staff" && factory && <Staff people={people} locations={locations} stations={stations}
                                 roles={roles} busy={busy} run={run} nm={nm} />}
      {tab === "products" && catalogue && <Products products={products} cats={cats} busy={busy} run={run} nm={nm} />}
      {tab === "company" && owner && <Company />}
    </>
  );
}

function Crews({ stations, groups, people, roles, busy, run, nm }: any) {
  const { t, lang, me } = useApp();
  // The server refuses a removal outside your grant, so offering the button
  // there is a promise the app cannot keep. Show it only where it will work.
  const canRemove = (p: PersonRow) => p.id !== me?.id && (roles ?? []).includes(p.role);
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
              {canRemove(p) && p.canLogin && <ResetPassword person={p} busy={busy} run={run} />}
              {canRemove(p) && <RemoveButton person={p} busy={busy} run={run} />}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Setting someone else's password. Until now the only moment a password could
 * be typed was when the account was created, so a leader who forgot theirs had
 * no way back in and no one had a way to let them.
 */
function ResetPassword({ person, busy, run }: any) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");

  if (!open) return <button className="chip" onClick={() => setOpen(true)}>{t("resetPassword")}</button>;

  return (
    <span style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
      <input type="text" placeholder={t("newPassword")} value={pw} autoComplete="off"
             onChange={(e) => setPw(e.target.value)} style={{ width: 170 }} />
      <button className="chip" onClick={() => { setOpen(false); setPw(""); }}>{t("cancel")}</button>
      <button className="btn pri sm" style={{ width: "auto", padding: "0 12px", minHeight: 34 }}
              disabled={busy || pw.length < 6}
              onClick={() => run(() => api.updatePerson(person.id, { password: pw }), t("passwordReset"))
                .then(() => { setOpen(false); setPw(""); })}>
        {t("saveAccount")}
      </button>
    </span>
  );
}

/**
 * Removing someone is not undoable from here, and for anyone who has worked it
 * does not erase them — it retires them. Both facts belong in front of the
 * person tapping it, not in a manual.
 */
function RemoveButton({ person, busy, run }: any) {
  const { t } = useApp();
  return (
    <button className="btn dang sm" style={{ width: "auto", padding: "0 12px", minHeight: 34 }}
      disabled={busy}
      onClick={() => {
        if (!confirm(`${t("confirmRemove")}\n\n${person.nameAr}\n\n${t("removeHint")}`)) return;
        return run(async () => {
          const r = await api.removePerson(person.id);
          return r;
        }, t("removed"));
      }}>
      {t("removeAccount")}
    </button>
  );
}

function MyAccount({ people, busy, run }: any) {
  const { t, me } = useApp();
  const mine = people.find((p: PersonRow) => p.id === me?.id);
  const [phone, setPhone] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  if (!mine) return null;
  const value = phone ?? mine.phone ?? "";

  return (
    <div className="card">
      <span className="k">{t("myAccount")}</span>
      <p className="note" style={{ marginTop: 4 }}>{t("accountHint")}</p>
      <span className="k" style={{ marginTop: 8, display: "block" }}>{t("myPhone")}</span>
      <input className="mono" placeholder="01xxxxxxxxx" value={value}
             onChange={(e) => setPhone(e.target.value)} style={{ marginTop: 7 }} />
      <span className="k" style={{ marginTop: 8, display: "block" }}>{t("newPassword")}</span>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ marginTop: 7 }} />
      <button className="btn sec sm" style={{ marginTop: 10 }}
              disabled={busy || (value === (mine.phone ?? "") && pw.length < 6)}
              onClick={() => run(() => api.updatePerson(mine.id, {
                ...(value !== (mine.phone ?? "") ? { phone: value || null } : {}),
                ...(pw.length >= 6 ? { password: pw } : {}),
              }), t("saved")).then(() => { setPhone(null); setPw(""); })}>
        {t("saveAccount")}
      </button>
    </div>
  );
}

function Staff({ people, locations, stations, roles, busy, run, nm }: any) {
  const { t, lang, me } = useApp();
  // Offer only what the server would accept from this person, so the form
  // cannot present a role that comes back refused.
  const offer: string[] = roles.length ? roles : [];
  const blank = { nameAr: "", email: "", phone: "", password: "", role: offer[0] ?? "",
                  locationId: "", stationId: "", salary: "", dayRate: "" };
  // Wages are the books' business. The factory manager may hire without ever
  // being told what the showroom manager earns.
  const setsPay = ["OWNER", "ACCOUNTANT"].includes(me?.role ?? "");
  const [p, setP] = useState(blank);
  const showrooms = locations.filter((l: LocationRow) => l.type === "SHOWROOM");
  const [room, setRoom] = useState({ nameAr: "", address: "" });

  // A branch only needs choosing when there is more than one; with a single
  // showroom the server assigns it and the field would be noise.
  const needsBranch = ["SHOWROOM_MANAGER", "SALES_REP"].includes(p.role) && showrooms.length > 1;
  // A QC inspector reads their own station's queue, exactly as a leader does.
  // Without a station their screen is simply empty, so ask for it here.
  const needsStation = p.role === "QC";
  const staff = people.filter((x: PersonRow) =>
    x.canLogin && x.role !== "GROUP_LEADER" && (offer.includes(x.role) || x.id === me?.id));

  return (
    <>
      <MyAccount people={people} busy={busy} run={run} />

      <div className="card">
        <span className="k">{t("addStaff")}</span>
        <p className="note" style={{ marginTop: 4 }}>{t("staffHint")}</p>
        <input placeholder={t("fullName")} value={p.nameAr}
               onChange={(e) => setP({ ...p, nameAr: e.target.value })} style={{ marginTop: 8 }} />
        <select value={p.role} onChange={(e) => setP({ ...p, role: e.target.value })} style={{ marginTop: 8 }}>
          {offer.map((r) => <option key={r} value={r}>{t(r as any)}</option>)}
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
        {setsPay && (
          <>
            <input className="mono" inputMode="decimal" placeholder={t("salary")} value={p.salary}
                   onChange={(e) => setP({ ...p, salary: e.target.value })} style={{ marginTop: 8 }} />
            {/* One or the other: the floor is on a day rate and paid weekly,
                the office on a salary and paid monthly. */}
            <input className="mono" inputMode="decimal" placeholder={t("dayRate")} value={p.dayRate}
                   onChange={(e) => setP({ ...p, dayRate: e.target.value })} style={{ marginTop: 8 }} />
            <p className="note">{t("dayRateHint")}</p>
          </>
        )}
        <button className="btn pri sm" style={{ marginTop: 10 }}
          disabled={busy || !p.nameAr || (!p.email && !p.phone) || p.password.length < 6
                    || (needsStation && !p.stationId)}
          onClick={() => run(() => api.addPerson({
            nameAr: p.nameAr, role: p.role, password: p.password,
            ...(p.email ? { email: p.email } : {}),
            ...(p.phone ? { phone: p.phone } : {}),
            ...(p.locationId ? { locationId: p.locationId } : {}),
            ...(p.stationId ? { stationId: p.stationId } : {}),
            // Blank means "not on the payroll", which is not the same as zero.
            ...(setsPay && p.salary.trim() ? { salary: Number(p.salary) } : {}),
            ...(setsPay && p.dayRate.trim() ? { dayRate: Number(p.dayRate) } : {}),
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
                {setsPay && x.payType === "DAILY" && x.dayRate != null && (
                  <span className="sub mono">{t("dayRate")}: {x.dayRate.toLocaleString()}</span>
                )}
                {setsPay && x.payType !== "DAILY" && x.salary != null && (
                  <span className="sub mono">{t("salary")}: {x.salary.toLocaleString()}</span>
                )}
              </span>
              <span className="mono muted">{x.email ?? x.phone}</span>
              {setsPay && <SalaryEditor person={x} busy={busy} run={run} />}
              {x.id !== me?.id && <ResetPassword person={x} busy={busy} run={run} />}
              {x.id !== me?.id && <RemoveButton person={x} busy={busy} run={run} />}
            </div>
          ))}
          {staff.length === 0 && <p className="note">{lang === "ar" ? "لسه مفيش موظفين" : "No staff yet"}</p>}
        </div>
      </div>
    </>
  );
}

/**
 * A product is not finished the moment it is created. A model loaded from the
 * printed catalogue arrives with no price at all, and until now the catalogue
 * was write-once, so there was no way to finish one.
 */
function ProductRowEditor({ product, cats, busy, run }: any) {
  const { t, me } = useApp();
  const [open, setOpen] = useState(false);
  // Cost only comes back for roles that keep the books, and only they may set
  // it — a rep who knows the margin can be argued down to it.
  const seesCost = ["OWNER", "ACCOUNTANT"].includes(me?.role ?? "");
  const [f, setF] = useState({
    nameAr: product.nameAr, sku: product.sku,
    basePrice: String(product.basePrice), cost: String(product.cost ?? 0),
    categoryId: product.categoryId,
  });
  const price = Number(f.basePrice) || 0;
  const cost = Number(f.cost) || 0;

  if (!open) {
    return (
      <div className="between">
        <span style={{ flex: 1 }}>
          <span className="nm">
            {product.nameAr}
            {!product.isActive && <span className="pill warn" style={{ marginInlineStart: 7 }}>{t("draft")}</span>}
          </span>
          <span className="sub">
            <span className="mono">{product.sku}</span> · {product.categoryAr} ·{" "}
            <span className="mono">{product.basePrice.toLocaleString()}</span> EGP
          </span>
          {product.description && <span className="sub">{product.description}</span>}
        </span>
        <button className="chip" onClick={() => setOpen(true)}>{t("edit")}</button>
      </div>
    );
  }

  return (
    <>
      <input value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} placeholder={t("productName")} />
      <input className="mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })}
             placeholder={t("sku")} style={{ marginTop: 8 }} />
      <input className="mono" inputMode="numeric" value={f.basePrice}
             onChange={(e) => setF({ ...f, basePrice: e.target.value })} placeholder={t("price")}
             style={{ marginTop: 8 }} />
      {seesCost && (
        <>
          <input className="mono" inputMode="numeric" value={f.cost}
                 onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder={t("cost")}
                 style={{ marginTop: 8 }} />
          <p className="note">{t("costHint")}</p>
        </>
      )}
      <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ marginTop: 8 }}>
        {cats.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </select>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !f.nameAr.trim() || !f.sku.trim()}
          onClick={() => run(() => api.updateProduct(product.id, {
            nameAr: f.nameAr.trim(), sku: f.sku.trim(),
            basePrice: price, categoryId: f.categoryId,
            ...(seesCost ? { cost } : {}),
          }), t("saved")).then(() => setOpen(false))}>
          {t("saveAccount")}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className={`btn sm ${product.isActive ? "dang" : "pri"}`}
          disabled={busy || (!product.isActive && price <= 0)}
          onClick={() => run(() => api.updateProduct(product.id,
            { basePrice: price, isActive: !product.isActive }), t("saved")).then(() => setOpen(false))}>
          {product.isActive ? t("deactivate") : t("activate")}
        </button>
        <button className="btn dang sm" disabled={busy}
          onClick={() => {
            if (!confirm(`${t("confirmRemoveProduct")}\n\n${product.nameAr}\n\n${t("removeProductHint")}`)) return;
            return run(() => api.removeProduct(product.id), t("removed")).then(() => setOpen(false));
          }}>
          {t("removeAccount")}
        </button>
      </div>
      {!product.isActive && price <= 0 && <p className="note">{t("priceBeforeActive")}</p>}
    </>
  );
}

/**
 * A product's pictures. They attach after the product exists, which is why this
 * lives on the row rather than in the add form: there is nothing to attach a
 * photo to until the product has been saved.
 */
function ProductPhotos({ product, busy, run }: any) {
  const { t, toast } = useApp();
  const [uploading, setUploading] = useState(false);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const failed: string[] = [];
    for (const f of [...files]) {
      if (f.size > 8 * 1024 * 1024) { failed.push(f.name); continue; }
      try { await api.addProductPhoto(product.id, f); } catch { failed.push(f.name); }
    }
    setUploading(false);
    if (failed.length) toast(t("fileTooBig"));
    // Reload through the parent so the new thumbnails appear.
    await run(async () => {}, t("saved"));
  };

  return (
    <>
      {product.photos?.length > 0 && (
        <div className="crew" style={{ marginTop: 9, gap: 8 }}>
          {product.photos.map((ph: ProductPhoto) => (
            <span key={ph.id} style={{ position: "relative" }}>
              <img src={`/uploads/${ph.path}`} alt={ph.filename}
                   style={{ width: 74, height: 74, objectFit: "cover",
                            borderRadius: "var(--rs)", border: "1px solid var(--g3)" }} />
              <button className="chip" style={{ position: "absolute", insetInlineEnd: 2, top: 2, padding: "1px 7px" }}
                      disabled={busy}
                      onClick={() => run(() => api.removeProductPhoto(product.id, ph.id), t("removed"))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <label className="btn sec sm" style={{ marginTop: 10, cursor: "pointer" }}>
        {uploading ? t("loading") : t("addPhotos")}
        <input type="file" multiple accept="image/*" hidden
               onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      </label>
    </>
  );
}

function Products({ products, cats, busy, run, nm }: any) {
  const { t, toast } = useApp();
  const [c, setC] = useState("");
  const BLANK = { sku: "", nameAr: "", categoryId: "", basePrice: "", baseLeadDays: "14", description: "" };
  const [p, setP] = useState(BLANK);
  const [files, setFiles] = useState<File[]>([]);

  return (
    <>
      {products.map((x: ProductRow) => (
        <div className="card" key={x.id}>
          <ProductRowEditor product={x} cats={cats} busy={busy} run={run} />
          <ProductPhotos product={x} busy={busy} run={run} />
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
        <input placeholder={t("productDescription")} value={p.description}
          onChange={(e) => setP({ ...p, description: e.target.value })} style={{ marginTop: 8 }} />

        <span className="k" style={{ display: "block", marginTop: 12 }}>{t("productPhotos")}</span>
        <p className="note">{t("photoHint")}</p>
        <input type="file" multiple accept="image/*" style={{ marginTop: 8 }}
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            const ok = picked.filter((f) => f.size <= 8 * 1024 * 1024);
            if (ok.length < picked.length) toast(t("fileTooBig"));
            setFiles((cur) => [...cur, ...ok]);
            e.target.value = "";
          }} />
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="evt">
            <span style={{ flex: 1 }}>{f.name}
              <span className="muted mono"> · {Math.round(f.size / 1024)} KB</span></span>
            <button className="chip" onClick={() => setFiles((cur) => cur.filter((_, k) => k !== i))}>
              {t("remove")}
            </button>
          </div>
        ))}

        <button className="btn pri sm" style={{ marginTop: 10 }}
          disabled={busy || !p.nameAr || !p.sku || !p.categoryId || !p.basePrice}
          onClick={() => run(async () => {
            const created = await api.addProduct({
              sku: p.sku.trim(), nameAr: p.nameAr.trim(), categoryId: p.categoryId,
              basePrice: Number(p.basePrice), baseLeadDays: Number(p.baseLeadDays) || 14,
              description: p.description.trim() || undefined,
            });
            // The pictures can only attach once the product exists. A failure
            // here is not a failure to create it — saying otherwise would have
            // the owner add the same product twice.
            const failed: string[] = [];
            for (const f of files) {
              try { await api.addProductPhoto(created.id, f); } catch { failed.push(f.name); }
            }
            if (failed.length) toast(`${t("attachFailed")}: ${failed.join(", ")}`);
            return created;
          }, t("saved")).then(() => { setP(BLANK); setFiles([]); })}>
          {t("add")}
        </button>
      </div>
    </>
  );
}


/**
 * The letterhead and the tax rate.
 *
 * VAT ships off, and turning it on affects new orders only: an order already
 * written keeps the total it was written at, because reissuing last month's
 * invoices at a rate the customer never agreed to is not a feature.
 */
function Company() {
  const { t, toast } = useApp();
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.settings().then(setF).catch(() => setF(null)); }, []);
  if (!f) return <div className="empty">{t("loading")}</div>;

  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const field = (k: string, label: string, extra: Record<string, unknown> = {}) => (
    <>
      <span className="k" style={{ marginTop: 10, display: "block" }}>{label}</span>
      <input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)}
             style={{ marginTop: 6 }} {...extra} />
    </>
  );

  return (
    <div className="card">
      <span className="k">{t("companyTab")}</span>
      {field("company.name", t("companyName"))}
      {field("company.nameEn", `${t("companyName")} (EN)`)}
      {field("company.address", t("companyAddress"))}
      {field("company.phone", t("companyPhone"), { inputMode: "tel" })}
      {field("company.email", t("companyEmail"), { inputMode: "email" })}

      <div className="evt" style={{ marginTop: 16 }}>
        <span style={{ flex: 1 }}><b>{t("vatEnabled")}</b></span>
        <button className={`btn sm toggle ${f["vat.enabled"] === "1" ? "pri" : "sec"}`}
                onClick={() => set("vat.enabled", f["vat.enabled"] === "1" ? "0" : "1")}>
          {f["vat.enabled"] === "1" ? "✓" : "—"}
        </button>
      </div>

      {f["vat.enabled"] === "1" && (
        <>
          {field("vat.rate", t("vatRate"), { inputMode: "decimal", className: "mono" })}
          {field("vat.number", t("vatNumber"), { className: "mono" })}
          <div className="evt" style={{ marginTop: 12 }}>
            <span style={{ flex: 1 }}>
              <b>{t("vatInclusive")}</b>
              <span className="sub">{t("vatInclusiveHint")}</span>
            </span>
            <button className={`btn sm toggle ${f["vat.inclusive"] === "1" ? "pri" : "sec"}`}
                    onClick={() => set("vat.inclusive", f["vat.inclusive"] === "1" ? "0" : "1")}>
              {f["vat.inclusive"] === "1" ? "✓" : "—"}
            </button>
          </div>
          <p className="note">{t("vatHint")}</p>
        </>
      )}

      <span className="k" style={{ marginTop: 16, display: "block" }}>{t("valuation")}</span>
      <select value={f["stock.valuation"] ?? "CURRENT"}
              onChange={(e) => set("stock.valuation", e.target.value)} style={{ marginTop: 6 }}>
        {["CURRENT", "AVERAGE", "FIFO"].map((v) => (
          <option key={v} value={v}>{t(`val_${v}` as any)}</option>
        ))}
      </select>
      <p className="note">{t("valuationHint")}</p>

      <button className="btn pri" style={{ marginTop: 14 }} disabled={busy}
              onClick={async () => {
                setBusy(true);
                try { setF(await api.saveSettings(f)); toast(t("saved")); }
                catch (e: any) { toast(e?.code ? t(e.code) : t("signInFailed")); }
                finally { setBusy(false); }
              }}>
        {t("save")}
      </button>
    </div>
  );
}


/**
 * A wage, set or cleared after the fact.
 *
 * Clearing takes the person off the payroll rather than paying them nothing —
 * a zero would look like a decision, and next month's run would quietly post a
 * zero payslip for someone who should never have been on the list.
 */
function SalaryEditor({ person, busy, run }: any) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"MONTHLY" | "DAILY">(person.payType ?? "MONTHLY");
  const [v, setV] = useState(
    person.payType === "DAILY"
      ? (person.dayRate == null ? "" : String(person.dayRate))
      : (person.salary == null ? "" : String(person.salary)));

  if (!open) {
    return <button className="chip" onClick={() => setOpen(true)}>{t("salary")}</button>;
  }
  return (
    <span style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
      <select value={kind} onChange={(e) => setKind(e.target.value as any)} style={{ width: 130 }}>
        <option value="MONTHLY">{t("payType_MONTHLY")}</option>
        <option value="DAILY">{t("payType_DAILY")}</option>
      </select>
      <input className="mono" inputMode="decimal" value={v}
             placeholder={kind === "DAILY" ? t("dayRate") : t("salary")}
             onChange={(e) => setV(e.target.value)} style={{ width: 110 }} />
      <button className="btn pri sm" disabled={busy}
              onClick={() => run(() => api.updatePerson(person.id, {
                payType: kind,
                // Clearing takes them off the payroll; the other field is
                // cleared too, so nobody ends up with both and neither
                // obviously in force.
                salary: kind === "MONTHLY" && v.trim() !== "" ? Number(v) : null,
                dayRate: kind === "DAILY" && v.trim() !== "" ? Number(v) : null,
              }), t("saved")).then(() => setOpen(false))}>
        {t("save")}
      </button>
      <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
    </span>
  );
}
