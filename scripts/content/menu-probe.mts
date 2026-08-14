// Menu-scrape reliability probe.
//
// Runs scrapeMenuPage against real URLs N times each and prints one RESULT line per run, so
// run-to-run VARIANCE on the same page is visible before and after a change. This exists
// because stored weekly reads of one restaurant ranged from 12 to 169 items while the page
// itself never changed; a single run tells you nothing about that, three runs do.
//
// Only needs FIRECRAWL_API_KEY (from .env.local or the environment). No DB, no writes.
//
//   npx tsx scripts/content/menu-probe.mts https://sugarbacon.com/dinner-menu
//   RUNS=3 SAVE_DIR=/tmp/menu-probe npx tsx scripts/content/menu-probe.mts <url> <url>
//
// Env dials:
//   RUNS       runs per URL (default 3)
//   SAVE_DIR   when set, writes <slug>.run<N>.md / .json per run for fixture capture
//
// DYNAMIC import on purpose: package.json has no "type" field, so a .mts entry is ESM while
// the .ts modules compile as CJS; a static named import fails cjs-module-lexer detection.

import { config } from "dotenv"
config({ path: ".env.local" })
import { mkdirSync, writeFileSync } from "fs"

type Cat = { name: string; items?: unknown[] }

function slugify(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-")
}

async function main() {
  const urls = process.argv.slice(2)
  if (urls.length === 0) {
    console.error("usage: npx tsx scripts/content/menu-probe.mts <url> [url...]")
    process.exit(1)
  }

  const runs = Number(process.env.RUNS ?? 3)
  const saveDir = process.env.SAVE_DIR ?? null
  if (saveDir) mkdirSync(saveDir, { recursive: true })

  const { scrapeMenuPage } = await import("../../lib/providers/firecrawl")

  for (const url of urls) {
    const slug = slugify(url)
    const counts: number[] = []

    for (let i = 1; i <= runs; i++) {
      const startedAt = Date.now()
      const res = await scrapeMenuPage(url)
      const ms = Date.now() - startedAt
      const cats: Cat[] = res?.menu?.categories ?? []
      const items = cats.reduce((s, c) => s + (c.items?.length ?? 0), 0)
      const md = res?.markdown ?? ""
      counts.push(items)

      if (saveDir) {
        writeFileSync(`${saveDir}/${slug}.run${i}.md`, md)
        writeFileSync(`${saveDir}/${slug}.run${i}.json`, JSON.stringify(res?.menu ?? null, null, 2))
      }

      console.log(
        `RESULT url=${url} run=${i} ms=${ms} items=${items} cats=${cats.length} mdChars=${md.length} extractor=${res?.extractor ?? "unknown"} cats=[${cats.map((c) => c.name).join(" | ")}]`
      )
    }

    const min = Math.min(...counts)
    const max = Math.max(...counts)
    console.log(`SUMMARY url=${url} runs=${counts.join(",")} min=${min} max=${max} spread=${max - min}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
