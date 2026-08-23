// ---------------------------------------------------------------------------
// ALT-552 / ALT-553 — reading a spend guard out of the environment, and being LOUD about the one
// state that looks fine and is not.
//
// WHAT HAPPENED. Both caps were sized and decided on 2026-08-03 ($5 per brief, $90 fleet daily,
// with the reasoning written down). The Vercel variables were created on 2026-08-09 and left with
// EMPTY values. Both resolvers treated empty exactly like absent, returned null, and said nothing:
// the `console.warn` only fired for a non-empty value that failed to parse. So for 13 days
// production ran with no per-brief ceiling and no fleet runaway tripwire, and the only evidence was
// two variables that appear perfectly normal in `vercel env ls` (both read "Encrypted").
//
// THE DISTINCTION THIS DRAWS. Absent and empty are different intentions:
//
//   ABSENT  -> deliberately disabled. Silent. This is a documented, supported state: both caps ship
//              default-off precisely so a number nobody has measured cannot cause an outage.
//   EMPTY   -> almost certainly a half-finished change. Somebody created the variable, which means
//              they intended a value. Warn.
//   INVALID -> warn, as before.
//
// A guard that turns itself off must say so unless somebody explicitly asked for it off. "Not
// configured" and "configured to nothing" produce the same behaviour and mean opposite things, and
// only one of them is worth a log line every cold start.
// ---------------------------------------------------------------------------

export type BudgetEnvResult = {
  /** The positive number, or null when the guard is disabled. */
  value: number | null
  /** Why it is disabled, for the caller's log line. `null` when a value parsed. */
  reason: "absent" | "empty" | "invalid" | null
}

/**
 * Parse a positive-number spend guard from a raw env value.
 *
 * Pure and exported so the three cases can be tested without touching `process.env` or the
 * module-load-time IIFEs the callers use.
 */
export function parseBudgetEnv(raw: string | undefined): BudgetEnvResult {
  if (raw === undefined) return { value: null, reason: "absent" }
  if (raw.trim() === "") return { value: null, reason: "empty" }
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return { value: n, reason: null }
  return { value: null, reason: "invalid" }
}

/**
 * Resolve a guard and log the two states that deserve a log line.
 *
 * `absent` stays silent on purpose: default-off is supported, and warning on it every cold start
 * would train everyone to ignore this exact message, which is how the empty case would hide again.
 */
export function resolveBudgetEnv(
  tag: string,
  envName: string,
  raw: string | undefined,
): number | null {
  const { value, reason } = parseBudgetEnv(raw)
  if (reason === "empty") {
    console.warn(
      `[${tag}] ${envName} is SET BUT EMPTY, so the guard is DISABLED. An empty value behaves ` +
        `exactly like an unset one, which is almost certainly not what was intended when the ` +
        `variable was created. Give it a positive number or remove it.`,
    )
  } else if (reason === "invalid") {
    console.warn(
      `[${tag}] ${envName}="${raw}" is not a positive number, so the guard is DISABLED. ` +
        `Spend is unguarded until this is set to a valid value.`,
    )
  }
  return value
}
