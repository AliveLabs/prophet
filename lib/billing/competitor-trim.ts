// Downgrading to a plan with a smaller competitor cap: deciding what has to go, and letting the
// customer choose.
//
// Before this, a Standard trial could move to Starter holding 5 competitors against a cap of 3 and
// nothing happened: the roster still showed 5, the nightly brief analysed an arbitrary 3, and the
// customer was never asked. Ordering the nightly query made that deterministic and the over-cap
// notice made it visible, but neither of those is the same as being ASKED. Bryan's call: a deselect
// screen in the change-plan flow.
//
// Pure on purpose. Every rule here is about someone's data and someone's money, and vitest cannot
// reach an API route, so the decisions live where they can be tested.

/** An active competitor, as the trim screen needs to see it. */
export type TrimCompetitor = {
  id: string
  name: string
  /** ISO. Determines the suggested keep set, oldest first. */
  createdAt: string | null
}

export type TrimLocation = {
  locationId: string
  locationName: string
  /** The competitor cap the customer will have AFTER the plan change. */
  cap: number
  /** Active competitors at this location, in any order. */
  competitors: TrimCompetitor[]
}

export type LocationTrim = {
  locationId: string
  locationName: string
  cap: number
  /** All active competitors, sorted oldest first, which is the order the screen shows. */
  competitors: TrimCompetitor[]
  /**
   * Pre-ticked. The oldest `cap`, matching the order the nightly dossier truncates in, so the
   * default selection is exactly what the customer is already getting. Changing nothing and
   * confirming is therefore a no-op rather than a surprise.
   */
  suggestedKeepIds: string[]
  /** How many must stop being watched at this location. */
  mustRemove: number
}

/** Oldest first; rows with no timestamp sort last so a null cannot silently win a keep slot. */
function byOldest(a: TrimCompetitor, b: TrimCompetitor): number {
  if (!a.createdAt && !b.createdAt) return a.id.localeCompare(b.id)
  if (!a.createdAt) return 1
  if (!b.createdAt) return -1
  const d = a.createdAt.localeCompare(b.createdAt)
  return d !== 0 ? d : a.id.localeCompare(b.id)
}

/**
 * Which locations are over the new cap, and what the screen should show for each.
 *
 * Returns ONLY over-cap locations: a location already within the new cap needs no decision, and
 * putting it on the screen would invite a customer to remove something they did not have to.
 */
export function planCompetitorTrim(locations: readonly TrimLocation[]): LocationTrim[] {
  const out: LocationTrim[] = []
  for (const loc of locations) {
    const sorted = [...loc.competitors].sort(byOldest)
    if (sorted.length <= loc.cap) continue
    out.push({
      locationId: loc.locationId,
      locationName: loc.locationName,
      cap: loc.cap,
      competitors: sorted,
      suggestedKeepIds: sorted.slice(0, loc.cap).map((c) => c.id),
      mustRemove: sorted.length - loc.cap,
    })
  }
  return out
}

export type TrimSelectionResult =
  | { ok: true; removeIds: string[] }
  | { ok: false; message: string }

/**
 * Turn "these are the ones I want to keep" into "these are the ones to stop watching", refusing
 * anything that would leave the customer over the cap or touch a competitor that was never on the
 * screen.
 *
 * The keep list is the input rather than the remove list because that is the question the screen
 * asks. It also fails safe: an empty or truncated payload removes MORE than intended rather than
 * silently keeping too many, and a request naming unknown ids is refused outright instead of
 * quietly ignoring them.
 */
export function resolveTrimSelection(
  trims: readonly LocationTrim[],
  keepIds: readonly string[],
): TrimSelectionResult {
  const keep = new Set(keepIds)
  const known = new Set<string>()
  for (const t of trims) for (const c of t.competitors) known.add(c.id)

  for (const id of keep) {
    if (!known.has(id)) {
      return {
        ok: false,
        message: "That selection is out of date. Reload the page and choose again.",
      }
    }
  }

  const removeIds: string[] = []
  for (const t of trims) {
    const keptHere = t.competitors.filter((c) => keep.has(c.id))
    if (keptHere.length > t.cap) {
      return {
        ok: false,
        message: `Choose at most ${t.cap} to keep at ${t.locationName}.`,
      }
    }
    for (const c of t.competitors) {
      if (!keep.has(c.id)) removeIds.push(c.id)
    }
  }

  return { ok: true, removeIds }
}

/** Plain summary for the confirm button, e.g. "Stop watching 2 and switch to Starter". */
export function trimSummary(trims: readonly LocationTrim[], removeCount: number): string {
  if (removeCount === 0) return "Nothing will stop being watched."
  const where =
    trims.length === 1 ? ` at ${trims[0]!.locationName}` : ` across ${trims.length} locations`
  return `${removeCount} competitor${removeCount === 1 ? "" : "s"}${where} will stop being watched.`
}
