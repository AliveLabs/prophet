// Shared helper for source-scanning guards: walk the TypeScript AST and yield only the text a
// person can actually read, meaning string literals, template-literal chunks, and JSX text.
//
// Not a .test.ts file on purpose: vitest collects tests/unit/**/*.test.ts, so this is importable
// without being collected as a suite.
//
// Why the AST and not a grep. Two reasons, both learned the hard way in this repo:
//
//   1. Comments are not output. This codebase comments in prose, and a guard that reads comments
//      flags the comment explaining the guard. Worse, the obvious way to strip comments with a
//      regex (`src.replace(/\/\*[\s\S]*?\*\//g, "")`) once ate 40 lines of live code between an
//      unrelated `/*` and a later `*​/`, and the scan then reported "no offenders" for a file whose
//      offending lines it had silently deleted.
//   2. Regex literals are not output either, and some of them must contain the very thing a guard
//      bans (see EM_DASH in lib/eval/voice-rules.ts). A text scan demands deleting the code that
//      enforces the rule. An AST walk never sees it.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import ts from "typescript"

export const REPO_ROOT = resolve(__dirname, "..", "..", "..")

const SKIP = new Set(["node_modules", ".next", ".git", "worktrees", "archive"])

const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

export type Literal = {
  /** Repo-relative path. */
  file: string
  /** 1-indexed line of the literal's start. */
  line: number
  /** The literal's text, whitespace collapsed. */
  text: string
}

/** Every .ts/.tsx file under the given repo-relative directories. */
export function sourceFiles(dirs: readonly string[]): string[] {
  const out: string[] = []
  const walk = (p: string) => {
    const st = statSync(p)
    if (st.isFile()) {
      if (/\.(ts|tsx)$/.test(p)) out.push(p)
      return
    }
    for (const e of readdirSync(p)) {
      if (SKIP.has(e)) continue
      walk(join(p, e))
    }
  }
  for (const d of dirs) walk(join(REPO_ROOT, d))
  return out.sort()
}

/** Readable literals in one file's source text. */
export function literalsIn(fileName: string, src: string): Literal[] {
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: Literal[] = []
  const rel = fileName.startsWith(REPO_ROOT) ? fileName.slice(REPO_ROOT.length + 1) : fileName
  const visit = (node: ts.Node): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      const raw = (node as ts.LiteralLikeNode).text ?? ""
      if (raw.trim()) {
        out.push({
          file: rel,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: raw.replace(/\s+/g, " ").trim(),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** Readable literals across whole directories. */
export function literalsUnder(dirs: readonly string[]): Literal[] {
  const out: Literal[] = []
  for (const file of sourceFiles(dirs)) {
    out.push(...literalsIn(file, readFileSync(file, "utf8")))
  }
  return out
}
