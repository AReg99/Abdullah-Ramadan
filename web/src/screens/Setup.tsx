import { useEffect, useState } from "react";
import { useApp } from "../app-context";
import { api, type GroupRow, type IgMedia, type LocationRow, type PersonRow, type ProductPhoto, type ProductRow, type Station } from "../api";

type Tab = "crews" | "staff" | "products";

/**
 * Where the business puts its own people and catalogue in.
 *
 * The factory manager gets the crews and the staff list; the catalogue and its
 * prices stay with the owner. Which roles his staff form offers is not decided
 * here — the server says what he may hand out, and the form asks.
 */
export default function Setup() {
  const { t, lang, toast, me } = useApp();
  const catalogue = me?.role === "OWNER";
  const [tab, setTab] = useState<Tab>("crews");
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
        <button className={`btn sm ${tab === "crews" ? "pri" : "sec"}`} onClick={() => setTab("crews")}>{t("crewsTab")}</button>
        <button className={`btn sm ${tab === "staff" ? "pri" : "sec"}`} onClick={() => setTab("staff")}>{t("staffTab")}</button>
        {catalogue && (
          <button className={`btn sm ${tab === "products" ? "pri" : "sec"}`}
                  onClick={() => setTab("products")}>{t("productsTab")}</button>
        )}
      </div>

      {tab === "crews" && <Crews stations={stations} groups={groups} people={people}
                                 roles={roles} busy={busy} run={run} nm={nm} />}
      {tab === "staff" && <Staff people={people} locations={locations} stations={stations}
                                 roles={roles} busy={busy} run={run} nm={nm} />}
      {tab === "products" && catalogue && <Products products={products} cats={cats} busy={busy} run={run} nm={nm} />}
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
              {canRemove(p) && <RemoveButton person={p} busy={busy} run={run} />}
            </div>
          ))}
        </div>
      </div>
    </>
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
 * A product's pictures. They attach after the product exists, which is why this
 * lives on the row rather than in the add form: there is nothing to attach a
 * photo to until the product has been saved.
 */
/**
 * Bringing the catalogue in from the page it already lives on.
 *
 * Instagram's own API, with a token the owner pastes. It is used for the two
 * requests and not kept: a long-lived token is a key to the account, and the
 * app has no reason to hold one between clicks.
 */
/**
 * A product is not finished the moment it is created — an import arrives with a
 * price of zero and a caption for a name. Until now the catalogue was
 * write-once, so a mistake stayed.
 */
function ProductRowEditor({ product, cats, busy, run }: any) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    nameAr: product.nameAr, sku: product.sku,
    basePrice: String(product.basePrice), categoryId: product.categoryId,
  });

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
      <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} style={{ marginTop: 8 }}>
        {cats.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
      </select>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn sec sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
        <button className="btn pri sm" disabled={busy || !f.nameAr.trim() || !f.sku.trim()}
          onClick={() => run(() => api.updateProduct(product.id, {
            nameAr: f.nameAr.trim(), sku: f.sku.trim(),
            basePrice: Number(f.basePrice) || 0, categoryId: f.categoryId,
          }), t("saved")).then(() => setOpen(false))}>
          {t("saveAccount")}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className={`btn sm ${product.isActive ? "dang" : "pri"}`} disabled={busy}
          onClick={() => run(() => api.updateProduct(product.id, { isActive: !product.isActive }),
                             t("saved")).then(() => setOpen(false))}>
          {product.isActive ? t("deactivate") : t("activate")}
        </button>
      </div>
    </>
  );
}

function InstagramImport({ cats, busy, run }: any) {
  const { t, toast } = useApp();
  const [token, setToken] = useState("");
  const [media, setMedia] = useState<IgMedia[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, { on: boolean; name: string; price: string }>>({});
  const [categoryId, setCategoryId] = useState("");
  const [loading, setLoading] = useState(false);

  // A caption is a post, not a product name: take the first line, drop the
  // hashtags, and let the owner correct it.
  const nameFrom = (caption: string | null) =>
    (caption ?? "").split("\n")[0].replace(/#[^\s]+/g, "").trim().slice(0, 60);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.instagramMedia(token.trim());
      setMedia(rows);
      setChosen(Object.fromEntries(rows.map((m) => [m.id, { on: false, name: nameFrom(m.caption), price: "" }])));
      if (rows.length === 0) toast(t("igEmpty"));
    } catch (e: any) {
      toast(e?.code === "instagram_failed" ? t("igTokenBad") : t("igFailed"));
    } finally { setLoading(false); }
  };

  const picked = media?.filter((m) => chosen[m.id]?.on && chosen[m.id]?.name.trim()) ?? [];

  return (
    <div className="card">
      <span className="k">{t("igImport")}</span>
      <p className="note" style={{ marginTop: 4 }}>{t("igHint")}</p>

      <input className="mono" placeholder={t("igToken")} value={token}
             onChange={(e) => setToken(e.target.value)} style={{ marginTop: 8 }} />
      <button className="btn sec sm" style={{ marginTop: 10 }}
              disabled={loading || token.trim().length < 20} onClick={() => void load()}>
        {loading ? t("loading") : t("igLoad")}
      </button>

      {media && media.length > 0 && (
        <>
          <div className="divide" />
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t("pickCategory")}</option>
            {cats.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
          </select>

          {media.map((m) => {
            const c = chosen[m.id];
            return (
              <div key={m.id} className="evt" style={{ alignItems: "flex-start", gap: 10 }}>
                <img src={m.imageUrl} alt="" width={64} height={64}
                     style={{ objectFit: "cover", borderRadius: "var(--rs)", border: "1px solid var(--g3)",
                              opacity: c?.on ? 1 : 0.45 }} />
                <span style={{ flex: 1 }}>
                  <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <input type="checkbox" checked={c?.on ?? false}
                           onChange={(e) => setChosen((s) => ({ ...s, [m.id]: { ...s[m.id], on: e.target.checked } }))} />
                    <span className="muted" style={{ fontSize: ".75rem" }}>
                      {m.timestamp ? new Date(m.timestamp).toLocaleDateString() : m.mediaType}
                    </span>
                  </label>
                  <input placeholder={t("productName")} value={c?.name ?? ""}
                         onChange={(e) => setChosen((s) => ({ ...s, [m.id]: { ...s[m.id], name: e.target.value } }))}
                         style={{ marginTop: 6 }} />
                  <input className="mono" inputMode="numeric" placeholder={t("price")} value={c?.price ?? ""}
                         onChange={(e) => setChosen((s) => ({ ...s, [m.id]: { ...s[m.id], price: e.target.value } }))}
                         style={{ marginTop: 6 }} />
                </span>
              </div>
            );
          })}

          <button className="btn pri sm" style={{ marginTop: 10 }}
                  disabled={busy || !categoryId || picked.length === 0}
                  onClick={() => run(async () => {
                    const r = await api.instagramImport(categoryId, picked.map((m) => ({
                      imageUrl: m.imageUrl,
                      nameAr: chosen[m.id].name.trim(),
                      basePrice: Number(chosen[m.id].price) || 0,
                      permalink: m.permalink ?? undefined,
                    })));
                    if (r.failed.length) toast(`${t("igSomeFailed")}: ${r.failed.length}`);
                    setMedia(null); setToken("");
                    return r;
                  }, t("saved"))}>
            {t("igImportN").replace("{n}", String(picked.length))}
          </button>
          <p className="note">{t("igDraftHint")}</p>
        </>
      )}
    </div>
  );
}

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
  const { t } = useApp();
  const [c, setC] = useState("");
  const [p, setP] = useState({ sku: "", nameAr: "", categoryId: "", basePrice: "", baseLeadDays: "14" });

  return (
    <>
      <InstagramImport cats={cats} busy={busy} run={run} />

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
