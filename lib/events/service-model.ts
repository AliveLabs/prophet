// ---------------------------------------------------------------------------
// Service-model + dayparts derivation from Google Places details
//
// The impact model's channel split keys off serviceModel ("quick service /
// drive-thru + dine-in" → lobby↑ + drive-thru↓). Places exposes the reliable
// signals (primaryType/types + dineIn/takeout + serves* flags) — no hours-text
// parsing. Best-effort: drive-thru isn't a first-class Places flag, so we infer it
// from QSR types (conservative — a missed drive-thru just omits the suppression
// channel; it never fabricates one).
// ---------------------------------------------------------------------------

export type PlaceServiceSignals = {
  primaryType?: string
  types?: string[]
  dineIn?: boolean
  takeout?: boolean
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBrunch?: boolean
}

export type DerivedHoursGate = {
  servesBreakfast?: boolean
  servesLunch?: boolean
  servesDinner?: boolean
  servesBrunch?: boolean
}

export function deriveServiceModel(d: PlaceServiceSignals | null | undefined): string | null {
  if (!d) return null
  const pt = (d.primaryType ?? "").toLowerCase()
  const types = (d.types ?? []).map((t) => t.toLowerCase())
  const has = (needle: string) => pt.includes(needle) || types.some((t) => t.includes(needle))

  const isQSR = has("fast_food") || has("hamburger") || has("quick")
  const isBar = has("bar") || has("pub") || has("brewery")
  const isFine = has("fine_dining")
  const isDrive = has("drive")

  const parts: string[] = []
  if (isQSR) parts.push("quick service")
  if (isBar) parts.push("bar")
  if (isFine) parts.push("fine dining")
  if (isDrive) parts.push("drive-thru")
  if (d.dineIn === true) parts.push("dine-in")
  if (d.takeout === true && d.dineIn !== true) parts.push("takeout")

  return parts.length ? parts.join(" / ") : null
}

export function deriveHoursGate(d: PlaceServiceSignals | null | undefined): DerivedHoursGate | undefined {
  if (!d) return undefined
  const gate: DerivedHoursGate = {}
  if (d.servesBreakfast !== undefined) gate.servesBreakfast = d.servesBreakfast
  if (d.servesLunch !== undefined) gate.servesLunch = d.servesLunch
  if (d.servesDinner !== undefined) gate.servesDinner = d.servesDinner
  if (d.servesBrunch !== undefined) gate.servesBrunch = d.servesBrunch
  return Object.keys(gate).length ? gate : undefined
}
