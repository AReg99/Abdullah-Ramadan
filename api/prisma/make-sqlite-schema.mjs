/**
 * Generates the SQLite variant of the schema from the PostgreSQL one.
 *
 * SQLite is the zero-install option for trying Aura on a laptop: no database
 * server, no Homebrew, just a file. Prisma does not support enums or Postgres
 * native types on SQLite, so those are rewritten here rather than maintained by
 * hand — one schema stays the source of truth.
 *
 * PostgreSQL remains the production target; see docs/07-tech-architecture.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "schema.prisma"), "utf8");

// Collect enum names, then drop their blocks.
const enumNames = [...src.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]);
let out = src.replace(/^enum\s+\w+\s*\{[^}]*\}\n?/gms, "");

// Point the datasource at a file.
out = out.replace(
  /datasource db \{[^}]*\}/s,
  'datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}'
);

// Enum-typed fields become String; their defaults become quoted strings.
for (const name of enumNames) {
  out = out.replace(
    new RegExp(`(^\\s+\\w+\\s+)${name}(\\??)(\\s|$)`, "gm"),
    (_m, head, opt, tail) => `${head}String${opt}${tail}`
  );
  out = out.replace(
    new RegExp(`(^\\s+\\w+\\s+)${name}(\\[\\])`, "gm"),
    (_m, head) => `${head}String[]`
  );
}
out = out.replace(/@default\(([A-Z][A-Z0-9_]*)\)/g, '@default("$1")');
out = out.replace(/@default\((ar|en)\)/g, '@default("$1")');

// Postgres native types have no SQLite equivalent.
out = out.replace(/\s+@db\.\w+(\([^)]*\))?/g, "");
// Prisma cannot express a partial index on SQLite.
out = out.replace(/^.*where uploaded_at is null.*$/gm, "");

// SQLite has no literal default for a JSON column — Prisma emits `DEFAULT {}`,
// which is not valid SQL. Drop the defaults; every write supplies the value.
out = out.replace(/(^\s+\w+\s+Json\??)\s+@default\("[^"]*"\)/gm, "$1");

out =
  "// GENERATED — do not edit. Run: node prisma/make-sqlite-schema.mjs\n" +
  "// Source of truth is schema.prisma (PostgreSQL).\n\n" +
  out;

writeFileSync(join(here, "schema.sqlite.prisma"), out);
console.log(`wrote schema.sqlite.prisma (${enumNames.length} enums inlined as String)`);
