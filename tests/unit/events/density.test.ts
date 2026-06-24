import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { densityTierFromCount, ensureLocationDensity } from "@/lib/events/density"
import { __clearCensusDensityCacheForTests } from "@/lib/local/census-density"

describe("densityTierFromCount — Places nearby-restaurant proxy → tier", () => {
  it("a sparse area reads rural", () => {
    expect(densityTierFromCount(0)).toBe("rural")
    expect(densityTierFromCount(2)).toBe("rural")
  })
  it("a moderate strip reads suburban", () => {
    expect(densityTierFromCount(3)).toBe("suburban")
    expect(densityTierFromCount(8)).toBe("suburban")
  })
  it("a busy district reads urban", () => {
    expect(densityTierFromCount(9)).toBe("urban")
    expect(densityTierFromCount(16)).toBe("urban")
  })
  it("a saturated core reads dense_urban", () => {
    expect(densityTierFromCount(17)).toBe("dense_urban")
    expect(densityTierFromCount(20)).toBe("dense_urban")
  })
  it("tiers are monotonic across the range", () => {
    const order = ["rural", "suburban", "urban", "dense_urban"]
    let last = -1
    for (let n = 0; n <= 20; n++) {
      const idx = order.indexOf(densityTierFromCount(n))
      expect(idx).toBeGreaterThanOrEqual(last)
      last = idx
    }
  })
})

// ── R2: ensureLocationDensity prefers TRUE Census density, falls back to the proxy ──
// Stub the Places client so the proxy branch is deterministic + no network.
vi.mock("@/lib/places/google", () => ({
  fetchNearbyPlaces: vi.fn(async () => Array.from({ length: 5 }, (_, i) => ({ placeId: `p${i}` }))),
}))

// Stub the global fetch the Census client uses, so a key-present run is deterministic.
const M2_PER_SQ_MILE = 2_589_988.110336
function landAreaForDensity(pop: number, ppsm: number): number {
  return (pop / ppsm) * M2_PER_SQ_MILE
}
function installCensusFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("geocoding.geo.census.gov")) {
        return {
          ok: true,
          json: async () => ({
            result: {
              geographies: {
                "Census Tracts": [
                  { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: landAreaForDensity(10_000, 8_000) },
                ],
              },
            },
          }),
        } as unknown as Response
      }
      return {
        ok: true,
        json: async () => [
          ["B01003_001E", "state", "county", "tract"],
          ["10000", "48", "113", "012345"],
        ],
      } as unknown as Response
    }),
  )
}

function makeSupabaseStub(row: Record<string, unknown> | null) {
  const upserts: Array<Record<string, unknown>> = []
  const client = {
    from() {
      return this
    },
    select() {
      return this
    },
    eq() {
      return this
    },
    async maybeSingle() {
      return { data: row, error: null }
    },
    async upsert(r: Record<string, unknown>) {
      upserts.push(r)
      return { data: null, error: null }
    },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, upserts }
}

describe("ensureLocationDensity — R2 Census-first with proxy fallback", () => {
  beforeEach(() => {
    __clearCensusDensityCacheForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.CENSUS_API_KEY
  })

  it("NO CENSUS_API_KEY → falls back to the competitor-count proxy (byte-identical to today)", async () => {
    // No key → census returns null → the proxy path samples 5 nearby restaurants → suburban.
    const sb = makeSupabaseStub(null)
    const tier = await ensureLocationDensity(sb.client, "loc-1", 32.7, -96.8)
    expect(tier).toBe(densityTierFromCount(5)) // suburban — same as the pre-R2 behavior
    // The proxy path persists with the legacy source, untouched.
    expect(sb.upserts.at(-1)).toMatchObject({ source: "competitor_proxy", commercial_proxy: 5 })
  })

  it("with a key + a dense tract → TRUE Census tier wins over the proxy", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    installCensusFetch()
    const sb = makeSupabaseStub(null)
    const tier = await ensureLocationDensity(sb.client, "loc-2", 40.75, -73.99)
    // 8,000 people/sq-mi → dense_urban, NOT the suburban the 5-competitor proxy would give.
    expect(tier).toBe("dense_urban")
    expect(sb.upserts.some((u) => u.source === "census")).toBe(true)
  })

  it("a Census failure with a key → still falls back to the proxy (no throw)", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("census down")
      }),
    )
    const sb = makeSupabaseStub(null)
    const tier = await ensureLocationDensity(sb.client, "loc-3", 32.7, -96.8)
    expect(tier).toBe(densityTierFromCount(5)) // proxy fallback, same as no-key path
  })
})
