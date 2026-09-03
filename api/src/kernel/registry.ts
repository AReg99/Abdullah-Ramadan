import type { FastifyInstance } from "fastify";
import type { ManifestList } from "./modules.js";
import { MODULES } from "./modules.js";
import * as SCOPES from "../auth/scopes.js";
import { db } from "../db.js";

/**
 * Loading the apps, in an order that makes sense, having first checked that the
 * set actually holds together.
 */

export type Installed = Set<string>;

/** Every scope constant, by the roles it contains, for the boot check below. */
function namedScopes() {
  const out = new Map<string, string>();
  for (const [name, value] of Object.entries(SCOPES)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out.set([...value].sort().join(","), name);
    }
  }
  return out;
}

/**
 * Faults that must stop the server rather than surface later as a mystery.
 *
 * Every one of these has a failure mode that is expensive precisely because it
 * is quiet: a dependency that is missing only breaks the screen that needed it,
 * a duplicated path silently shadows one module with another, and a menu whose
 * roles are not a named scope is the drift that has already been fixed six
 * times in this codebase.
 */
export function checkManifests(list: ManifestList = MODULES) {
  const problems: string[] = [];
  const keys = new Set(list.map((m) => m.key));
  const scopes = namedScopes();
  const seenPath = new Map<string, string>();

  for (const m of list) {
    for (const d of m.depends) {
      if (!keys.has(d)) problems.push(`${m.key} depends on "${d}", which is not a module`);
      if (d === m.key) problems.push(`${m.key} depends on itself`);
    }
    for (const e of m.menu ?? []) {
      const owner = seenPath.get(e.path);
      if (owner) problems.push(`${m.key} and ${owner} both put a menu at ${e.path}`);
      seenPath.set(e.path, m.key);

      const key = [...e.scope].sort().join(",");
      if (!scopes.has(key)) {
        problems.push(
          `${m.key} menu ${e.path} uses a role list that is not a named scope ` +
          `in scopes.ts — write one there rather than a list here`);
      }
    }
  }

  // A cycle would loop forever in the ordering below, so name it here instead.
  const state = new Map<string, 0 | 1 | 2>();
  const byKey = new Map(list.map((m) => [m.key, m]));
  const walk = (k: string, trail: string[]) => {
    if (state.get(k) === 2) return;
    if (state.get(k) === 1) { problems.push(`circular dependency: ${[...trail, k].join(" → ")}`); return; }
    state.set(k, 1);
    for (const d of byKey.get(k)?.depends ?? []) if (byKey.has(d)) walk(d, [...trail, k]);
    state.set(k, 2);
  };
  for (const m of list) walk(m.key, []);

  return problems;
}

/**
 * Installed modules in dependency order, so a module is always registered after
 * everything it builds on.
 *
 * A module whose dependency is not installed is dropped, and the caller is told
 * which — silently registering half of an app is worse than not registering it,
 * because the half that works makes the half that does not look like a bug.
 */
export function resolve(installed: Installed, list: ManifestList = MODULES) {
  const byKey = new Map(list.map((m) => [m.key, m]));
  const candidates = list.filter((m) => m.required || installed.has(m.key));

  // A module is usable once every module it depends on is usable. Grow the set
  // until it stops growing: dropping one module can strand another that needed
  // it, and that one can strand a third.
  const usable = new Set<string>();
  for (;;) {
    const before = usable.size;
    for (const m of candidates) {
      if (usable.has(m.key)) continue;
      if (m.depends.every((d) => usable.has(d))) usable.add(m.key);
    }
    if (usable.size === before) break;
  }

  const stranded = candidates.filter((m) => !usable.has(m.key)).map((m) => m.key);

  const order: ManifestList = [];
  const done = new Set<string>();
  const emit = (k: string) => {
    if (done.has(k) || !usable.has(k)) return;
    done.add(k);
    for (const d of byKey.get(k)!.depends) emit(d);
    order.push(byKey.get(k)!);
  };
  for (const m of candidates) emit(m.key);

  return { order, stranded };
}

/**
 * What this database has switched on.
 *
 * A module with no row has never been seen by this deployment, and counts as
 * installed: an upgrade that adds an app to the code must not leave an existing
 * business without something it has been using all along. Switching an app off
 * is a decision somebody makes, and it leaves a row saying so.
 */
export async function installedSet(list: ManifestList = MODULES): Promise<Installed> {
  const rows = await db.module.findMany();
  const known = new Map(rows.map((r) => [r.key, r.installed]));
  return new Set(list.filter((m) => known.get(m.key) !== false).map((m) => m.key));
}

/** Seed a row per module, so the Apps screen has something to show. */
export async function ensureModuleRows(list: ManifestList = MODULES) {
  for (const m of list) {
    const existing = await db.module.findUnique({ where: { key: m.key } });
    if (!existing) {
      await db.module.create({
        data: { key: m.key, installed: true, installedAt: new Date() },
      });
    }
  }
}

export async function loadModules(app: FastifyInstance, list: ManifestList = MODULES) {
  const problems = checkManifests(list);
  if (problems.length) {
    throw new Error("the app registry does not hold together:\n  - " + problems.join("\n  - "));
  }
  const installed = await installedSet(list);
  const { order, stranded } = resolve(installed, list);
  for (const m of order) for (const r of m.routes) await app.register(r);
  if (stranded.length) {
    app.log.warn(
      { stranded },
      "apps switched on but missing a dependency, so not loaded");
  }
  return { loaded: order.map((m) => m.key), stranded };
}
