#!/usr/bin/env node
// RSC server/client boundary guard — fails CI on the bug class that `tsc` + `next build`
// CANNOT see (they're type-clean and build-clean; they only throw at request time, tripping
// app/error.tsx — the "didn't go through" screen). Two patterns, both regressed in the
// "the-pass" Concept-A rebuild (fixed in 046c460: Weather + Admin):
//
//   PATTERN 1 — a Server Component imports + CALLS a plain helper (function/value) that is
//     exported from a "use client" module. React throws "Attempted to call X() from the
//     server but X is on the client." Fix: move pure helpers/types into a server-safe
//     (non-"use client") sibling module, e.g. weather-shared.ts.
//
//   PATTERN 2 — a Server Component passes a FUNCTION prop (format={(n)=>…}, onX handlers,
//     render/compare props) to a Client Component. React throws "Functions cannot be passed
//     directly to Client Components." Fix: use a serializable prop instead (e.g. the
//     `localize` boolean on TkNumBig/AnimatedNumber), or move the call site into a client island.
//
// This guard is static, dependency-free, and ~instant. Run: `npm run lint:rsc-boundary`.
//
// Server Actions (bare `action={someAction}` / `onSave={someActionFn}` identifiers) are
// serializable references and are intentionally NOT flagged — only INLINE functions and
// known function-typed props are. Rendering a client component as JSX (`<Foo/>`) is also
// never flagged — that's the whole point of "use client".
//
// COVERAGE — Pattern 1 is usage-based and covers named, default, and namespace imports
// (it flags a CALL of any client export from a server module, and references to named client
// helpers). KNOWN LIMITS (a static line-scanner can't see everything; these are why the
// authed route-render smoke test ticket exists as the real safety net, and why kit components
// should keep props serializable so `tsc` catches Pattern 2 on its own):
//   - Pattern 2 detects INLINE arrow props + a known list of function-prop names; it does NOT
//     catch a function passed by reference (`onX={fn}`), nested in an object/array prop, or via
//     spread — distinguishing those from a Server Action by static text is unreliable.
//   - Namespace member references that are not direct calls are not flagged.
//   - Barrel re-export chains are resolved up to 8 hops.
// The primary defenses remain: (a) kit components take serializable props only (compile-time),
// (b) this guard for the two import/call shapes, (c) a route-render smoke test for everything else.

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.argv[2] || process.cwd()
const ROOTS = ["app", "components"]

/* ── file discovery ─────────────────────────────────────────────────── */
function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(join(ROOT, dir), { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (["node_modules", ".next", ".git", "dist"].includes(e.name)) continue
      walk(rel, out)
    } else if (/\.(tsx|ts)$/.test(e.name)) {
      out.push(rel)
    }
  }
  return out
}
const allFiles = ROOTS.flatMap((r) => walk(r))
const read = (f) => readFileSync(join(ROOT, f), "utf8")
const isClient = (src) => /^\s*["']use client["']/m.test(src.split("\n").slice(0, 3).join("\n"))

const srcOf = new Map(allFiles.map((f) => [f, read(f)]))
const clientSet = new Set(allFiles.filter((f) => isClient(srcOf.get(f))))

/* ── export classification ──────────────────────────────────────────── */
// component: PascalCase, no underscores, not SCREAMING.  hook: useX.  else: helper (incl. consts).
function classify(name) {
  if (/^use[A-Z]/.test(name)) return "hook"
  if (/^[A-Z]/.test(name) && !/_/.test(name) && !/^[A-Z0-9_]+$/.test(name)) return "component"
  return "helper"
}

// Resolve an import spec (relative or "@/…") to an actual scanned file.
function resolveModule(fromFile, spec) {
  let base
  if (spec.startsWith("@/")) base = spec.slice(2)
  else if (spec.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1).join("/")
    base = normalize(`${dir}/${spec}`)
  } else return null // bare package
  for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (srcOf.has(c)) return c
  }
  return null
}
function normalize(p) {
  const parts = []
  for (const seg of p.split("/")) {
    if (seg === "." || seg === "") continue
    if (seg === "..") parts.pop()
    else parts.push(seg)
  }
  return parts.join("/")
}

// For each module, map exported name -> { kind, isClient } following re-export chains
// (`export { a } from "./x"`, `export * from "./x"`). Depth-limited; cached.
const exportCache = new Map()
function exportsOf(file, depth = 0) {
  if (exportCache.has(file)) return exportCache.get(file)
  const map = new Map()
  exportCache.set(file, map) // set early to break cycles
  if (depth > 8) return map
  const src = srcOf.get(file)
  if (!src) return map
  const fileIsClient = clientSet.has(file)

  // local declarations
  const reDecl = /^export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z0-9_$]+)/gm
  for (const m of src.matchAll(reDecl)) {
    map.set(m[1], { kind: classify(m[1]), isClient: fileIsClient, origin: file })
  }
  // re-export list:  export { a, b as c } from "./x"   |   export { a, b }
  const reList = /^export\s*\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/gm
  for (const m of src.matchAll(reList)) {
    const fromSpec = m[2]
    const srcMod = fromSpec ? resolveModule(file, fromSpec) : null
    const srcExports = srcMod ? exportsOf(srcMod, depth + 1) : null
    for (let part of m[1].split(",")) {
      part = part.trim()
      if (!part || part.startsWith("type ")) continue
      const orig = part.split(/\s+as\s+/)[0].trim()
      const local = part.split(/\s+as\s+/).pop().trim()
      if (srcExports && srcExports.has(orig)) {
        map.set(local, srcExports.get(orig)) // inherit true origin + client-ness + kind
      } else {
        map.set(local, { kind: classify(local), isClient: fileIsClient, origin: file })
      }
    }
  }
  // wildcard re-export:  export * from "./x"
  const reStar = /^export\s*\*\s*from\s*["']([^"']+)["']/gm
  for (const m of src.matchAll(reStar)) {
    const srcMod = resolveModule(file, m[1])
    if (srcMod) for (const [k, v] of exportsOf(srcMod, depth + 1)) if (!map.has(k)) map.set(k, v)
  }
  return map
}

/* ── scan server files ──────────────────────────────────────────────── */
const serverFiles = allFiles.filter((f) => !clientSet.has(f))
const violations = []
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// PATTERN 1 — a Server Component pulls something out of a "use client" module and USES it as
// a value: calls it (`x()`), or references a named helper. Rendering a client component as
// JSX (`<Foo/>`) is the correct RSC pattern and is NEVER flagged. Detection is USAGE-based so
// it covers named, default (`import Foo from`), and namespace (`import * as X from`) imports
// uniformly — the local binding name differs, but the call/render signal is the same.
const reNamed = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g
const reDefault = /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+["']([^"']+)["']/g
const reNamespace = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']/g

for (const f of serverFiles) {
  const src = srcOf.get(f)
  const lineAt = (idx) => src.slice(0, idx).split("\n").length
  const flag = (line, msg) => violations.push({ file: f, line, pattern: 1, msg })
  // `name(` but not `<name(` (JSX) and not `.name(` (method on something else)
  const isCalled = (name) => new RegExp(`(?<![<.\\w$])${esc(name)}\\s*\\(`).test(src)
  const isRendered = (name) => new RegExp(`<${esc(name)}[\\s/>]`).test(src)
  const refCount = (name) => [...src.matchAll(new RegExp(`\\b${esc(name)}\\b`, "g"))].length

  // named imports — kind is resolvable, so we know helper vs component/hook
  for (const m of src.matchAll(reNamed)) {
    if (/import\s+type\s*\{/.test(m[0])) continue // type-only import: erased, safe
    const mod = resolveModule(f, m[2])
    if (!mod) continue
    const exp = exportsOf(mod)
    const line = lineAt(m.index)
    for (let n of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      if (n.startsWith("type ")) continue
      const orig = n.split(/\s+as\s+/)[0].trim()
      const local = n.split(/\s+as\s+/).pop().trim()
      const info = exp.get(orig)
      if (!info || !info.isClient) continue
      if (isRendered(local)) continue // client component rendered from server — correct RSC
      if (info.kind === "helper" && (isCalled(local) || refCount(local) > 1)) {
        flag(line, `imports '${orig}' (a non-component helper from "use client" ${info.origin}) into a Server Component and uses it as a value. Move the helper to a server-safe (non-client) module.`)
      } else if ((info.kind === "component" || info.kind === "hook") && isCalled(local)) {
        flag(line, `CALLS '${orig}()' imported from "use client" ${info.origin} inside a Server Component (a client ${info.kind} can only be rendered as JSX, not called).`)
      }
    }
  }
  // default imports — kind unknown; rendered = safe, called = bug
  for (const m of src.matchAll(reDefault)) {
    if (/^import\s+type\b/.test(m[0])) continue
    const local = m[1]
    const mod = resolveModule(f, m[2])
    if (!mod || !clientSet.has(mod)) continue
    if (isRendered(local)) continue // default-exported client component rendered — the common, correct case
    if (isCalled(local)) flag(lineAt(m.index), `default-imports '${local}' from "use client" ${mod} and CALLS it in a Server Component. Move a helper to a server-safe module; render a component as JSX instead.`)
  }
  // namespace imports — flag a member CALL (X.foo()) on a client-module namespace
  for (const m of src.matchAll(reNamespace)) {
    const local = m[1]
    const mod = resolveModule(f, m[2])
    if (!mod || !clientSet.has(mod)) continue
    if (new RegExp(`(?<!<)\\b${esc(local)}\\s*\\.\\s*[A-Za-z_$][\\w$]*\\s*\\(`).test(src))
      flag(lineAt(m.index), `namespace-imports '* as ${local}' from "use client" ${mod} and calls a member (${local}.x()) in a Server Component. Move called helpers to a server-safe module.`)
  }
}

// PATTERN 2 — server file passes an INLINE function prop or a known function-typed prop.
// Reports EVERY offending prop on a line (not just the first), de-duped by position so a
// named-fn prop whose value is an inline arrow isn't counted twice.
const reInlineFnProp = /\b([A-Za-z_$][\w$]*)=\{\s*(?:async\s+)?(?:\([^(){}]*\)|[A-Za-z_$][\w$]*)\s*=>/g
const reNamedFnProp = /\b(format|render|renderItem|compare|comparator|formatter|sortFn|getLabel|getKey)=\{/g
for (const f of serverFiles) {
  if (!f.endsWith(".tsx")) continue
  srcOf.get(f).split("\n").forEach((ln, i) => {
    const seen = new Set()
    for (const m of ln.matchAll(reInlineFnProp)) {
      seen.add(m.index)
      violations.push({
        file: f,
        line: i + 1,
        pattern: 2,
        msg: `inline function prop '${m[1]}={…=>…}' from a Server Component. Functions can't cross the server→client boundary — use a serializable prop, or move this into a client island. (Server Actions are bare identifiers and are fine.)`,
      })
    }
    for (const m of ln.matchAll(reNamedFnProp)) {
      if (seen.has(m.index)) continue
      violations.push({
        file: f,
        line: i + 1,
        pattern: 2,
        msg: `function-typed prop '${m[1]}={…}' from a Server Component. Replace with a serializable prop (e.g. \`localize\`).`,
      })
    }
  })
}

/* ── report ─────────────────────────────────────────────────────────── */
violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1))
if (violations.length === 0) {
  console.log(
    `✓ RSC boundary clean — ${serverFiles.length} server modules vs ${clientSet.size} "use client" modules, no Pattern 1/2 violations.`
  )
  process.exit(0)
}
console.error(`\n✗ RSC boundary: ${violations.length} violation(s) — build-clean but crash at runtime:\n`)
for (const v of violations) console.error(`  [Pattern ${v.pattern}] ${v.file}:${v.line}\n      ${v.msg}\n`)
console.error(`See scripts/audit/rsc-boundary.mjs header for the fix patterns (ref commit 046c460).\n`)
process.exit(1)
