// Bug-class audit, class 4: CODE vs SCHEMA PARITY.
//
//   npx tsx scripts/audit/schema-parity.mts            # print the expected objects + verify SQL
//   npx tsx scripts/audit/schema-parity.mts --sql      # SQL only, for piping
//
// WHY THIS EXISTS. Migrations do NOT auto-apply on this project, and a merged-but-unapplied
// migration fails SILENTLY because the dependent code is usually fail-soft. It has happened twice:
//
//   ALT-677  `review_watch_events` sat merged-but-missing for four days
//   2026-08-21  the SAME table was still missing, six days after its migration merged
//
// WHY VERSION NUMBERS CANNOT BE DIFFED, which is what let it hide the second time. Migrations
// applied through the Supabase MCP get their OWN generated timestamp, so prod's
// `supabase_migrations.schema_migrations` holds versions like 20260820175219 while the repo holds
// 20260820170000 for the same change. The two lists never line up and diffing them produces noise
// that hides a real gap. So this checks SCHEMA OBJECTS, which are the thing that actually matters.
//
// FAIL-SOFT IS THE REASON THIS IS INVISIBLE. `loadActiveWatchEvents` returns [] on error, so a
// missing table throws nothing, alerts nothing, and just quietly disables a feature. Absence of an
// error is not evidence the schema is present.

import { readFileSync, readdirSync } from "node:fs"
import { resolve, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations")

type Obj = { schema: string; name: string }
type Col = { schema: string; table: string; column: string }
type Expected = {
  migration: string
  tables: Obj[]
  columns: Col[]
  indexes: Obj[]
}

/** Strip comments so a table name mentioned in prose is not read as a created object. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
}

// SCHEMA-AWARE ON PURPOSE. The first version of this checker hardcoded `public` and reported 26
// false positives out of 28 rows on its first run: this database also has a `marketing` schema
// (Chris's contacts/email_log/events/prospects tables) whose indexes are perfectly present, just not
// in public. A checker with a 93% false-positive rate gets ignored, which is how the June 2026 audit
// in docs/audit/ died. So the declared qualifier is captured and used.
function parse(migration: string, raw: string): Expected {
  const sql = stripComments(raw)
  const tables = new Map<string, Obj>()
  const indexes = new Map<string, Obj>()
  const columns: Col[] = []
  const key = (o: Obj) => `${o.schema}.${o.name}`

  // create table [if not exists] [schema.]name
  for (const m of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?/gi,
  )) {
    const o = { schema: m[1] ?? "public", name: m[2] }
    tables.set(key(o), o)
  }
  // create [unique] index [if not exists] name ON [schema.]table
  // The index name itself is never schema-qualified in Postgres; it inherits the TABLE's schema,
  // which is why the ON clause is what decides where to look for it.
  for (const m of sql.matchAll(
    /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?\s+on\s+(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?[a-z0-9_]+"?/gi,
  )) {
    const o = { schema: m[2] ?? "public", name: m[1] }
    indexes.set(key(o), o)
  }
  // alter table [schema.]t add column [if not exists] c
  for (const m of sql.matchAll(
    /alter\s+table\s+(?:if\s+exists\s+)?(?:"?([a-z0-9_]+)"?\s*\.\s*)?"?([a-z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi,
  )) {
    columns.push({ schema: m[1] ?? "public", table: m[2], column: m[3] })
  }

  // A column added to a table this same migration creates is covered by the table check.
  return {
    migration,
    tables: [...tables.values()],
    indexes: [...indexes.values()],
    columns: columns.filter((c) => !tables.has(`${c.schema}.${c.table}`)),
  }
}

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
const expected = files.map((f) => parse(f, readFileSync(join(MIGRATIONS, f), "utf8")))

const objKey = (o: Obj) => `${o.schema}.${o.name}`
const colKey = (c: Col) => `${c.schema}.${c.table}.${c.column}`
const uniq = <T,>(rows: T[], k: (t: T) => string) =>
  [...new Map(rows.map((r) => [k(r), r])).values()].sort((a, b) => k(a).localeCompare(k(b)))

const allTables = uniq(expected.flatMap((e) => e.tables), objKey)
const allIndexes = uniq(expected.flatMap((e) => e.indexes), objKey)
const uniqueColumns = uniq(expected.flatMap((e) => e.columns), colKey)

// One query. Every row it returns is a MISSING object, so an empty result set is the pass condition
// and there is nothing to eyeball.
const sql = `-- class 4: code vs schema parity. EVERY ROW RETURNED IS A MISSING OBJECT.
-- Generated from ${files.length} migration files by scripts/audit/schema-parity.mts.
with expected_tables(s, name) as (values
${allTables.map((t) => `  ('${t.schema}', '${t.name}')`).join(",\n")}
), expected_indexes(s, name) as (values
${allIndexes.map((i) => `  ('${i.schema}', '${i.name}')`).join(",\n")}
), expected_columns(s, t, c) as (values
${uniqueColumns.map((c) => `  ('${c.schema}', '${c.table}', '${c.column}')`).join(",\n")}
)
select 'MISSING TABLE' as kind, s || '.' || name as object from expected_tables
 where to_regclass(s || '.' || name) is null
union all
select 'MISSING INDEX', s || '.' || name from expected_indexes
 where not exists (select 1 from pg_indexes where schemaname = s and indexname = name)
union all
select 'MISSING COLUMN', s || '.' || t || '.' || c from expected_columns
 where to_regclass(s || '.' || t) is not null
   and not exists (
     select 1 from information_schema.columns
      where table_schema = s and table_name = t and column_name = c
   )
order by kind, object;`

if (process.argv.includes("--sql")) {
  console.log(sql)
  process.exit(0)
}

console.log(`\n=== class 4: code vs schema parity ===`)
console.log(`  ${files.length} migrations parsed`)
console.log(`  ${allTables.length} tables, ${allIndexes.length} indexes, ${uniqueColumns.length} added columns expected\n`)
for (const e of expected) {
  const bits = [
    e.tables.length ? `${e.tables.length} table(s)` : null,
    e.indexes.length ? `${e.indexes.length} index(es)` : null,
    e.columns.length ? `${e.columns.length} column(s)` : null,
  ].filter(Boolean)
  if (bits.length) console.log(`  ${e.migration.padEnd(56)} ${bits.join(", ")}`)
}
console.log(`\n--- run this against prod; every row returned is a missing object ---\n`)
console.log(sql)
console.log("")
