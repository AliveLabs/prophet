import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  densityClassFromPeoplePerSqMi,
  densityClassToTier,
  DENSITY_BREAKPOINTS,
  fetchCensusDensity,
  ensureCensusDensity,
  __clearCensusDensityCacheForTests,
  type DensityClass,
} from "@/lib/local/census-density"

// ── Deterministic fetch stub: NO live Census call ever leaves the test. ───────
// The Census Geocoder geographies endpoint returns { result: { geographies: { "Census
// Tracts": [{ STATE, COUNTY, TRACT, AREALAND }] } }; the ACS API returns a 2-row matrix
// [[header...],[values...]]. We stub both by URL substring.
type FetchStub = {
  tract?: { STATE: string; COUNTY: string; TRACT: string; AREALAND: number } | null
  population?: string | null
  geocodeThrows?: boolean
}

const M2_PER_SQ_MILE = 2_589_988.110336
/** Land area (m²) such that `pop` people yields exactly `ppsm` people/sq-mi. */
function landAreaForDensity(pop: number, ppsm: number): number {
  return (pop / ppsm) * M2_PER_SQ_MILE
}

function installFetch(stub: FetchStub) {
  let geocodeCalls = 0
  let acsCalls = 0
  const fn = vi.fn(async (url: string) => {
    if (url.includes("geocoding.geo.census.gov")) {
      geocodeCalls++
      if (stub.geocodeThrows) throw new Error("network down")
      const tracts = stub.tract === null ? [] : [stub.tract]
      return {
        ok: true,
        json: async () => ({ result: { geographies: { "Census Tracts": tracts } } }),
      } as unknown as Response
    }
    if (url.includes("api.census.gov")) {
      acsCalls++
      if (stub.population === null) {
        return { ok: true, json: async () => [["B01003_001E", "state", "county", "tract"]] } as unknown as Response
      }
      return {
        ok: true,
        json: async () => [
          ["B01003_001E", "state", "county", "tract"],
          [stub.population, "48", "113", "012345"],
        ],
      } as unknown as Response
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal("fetch", fn)
  return {
    fn,
    get geocodeCalls() {
      return geocodeCalls
    },
    get acsCalls() {
      return acsCalls
    },
  }
}

beforeEach(() => {
  __clearCensusDensityCacheForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CENSUS_API_KEY
})

// ── Pure breakpoint mapping ───────────────────────────────────────────────────
describe("densityClassFromPeoplePerSqMi — documented breakpoints", () => {
  it("below the rural ceiling → rural", () => {
    expect(densityClassFromPeoplePerSqMi(0)).toBe("rural")
    expect(densityClassFromPeoplePerSqMi(DENSITY_BREAKPOINTS.ruralMax - 1)).toBe("rural")
  })
  it("between the breakpoints → suburban (today's default class)", () => {
    expect(densityClassFromPeoplePerSqMi(DENSITY_BREAKPOINTS.ruralMax)).toBe("suburban")
    expect(densityClassFromPeoplePerSqMi(DENSITY_BREAKPOINTS.denseMin - 1)).toBe("suburban")
  })
  it("at/above the dense floor → dense_urban", () => {
    expect(densityClassFromPeoplePerSqMi(DENSITY_BREAKPOINTS.denseMin)).toBe("dense_urban")
    expect(densityClassFromPeoplePerSqMi(50_000)).toBe("dense_urban")
  })
  it("non-finite → rural (fail-safe to the widest, least-aggressive ring is wrong; default safe)", () => {
    expect(densityClassFromPeoplePerSqMi(Number.NaN)).toBe("rural")
  })
})

describe("densityClassToTier — radius class → impact-model tier", () => {
  it("dense_urban ↔ dense_urban, rural ↔ rural, suburban ↔ suburban", () => {
    const cases: Array<[DensityClass, string]> = [
      ["dense_urban", "dense_urban"],
      ["suburban", "suburban"],
      ["rural", "rural"],
    ]
    for (const [cls, tier] of cases) expect(densityClassToTier(cls)).toBe(tier)
  })
})

// ── fetchCensusDensity: the no-op gate + fail-soft ────────────────────────────
describe("fetchCensusDensity — graceful no-op gate", () => {
  it("NO CENSUS_API_KEY → null, and NEVER calls fetch", async () => {
    const stub = installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: 1e6 }, population: "5000" })
    // key absent
    const out = await fetchCensusDensity(32.7, -96.8)
    expect(out).toBeNull()
    expect(stub.fn).not.toHaveBeenCalled()
  })

  it("with a key + a dense tract → people/sq-mi + dense_urban class", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    // 10,000 people over a land area sized for 8,000/sq-mi → dense_urban
    const land = landAreaForDensity(10_000, 8_000)
    installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: land }, population: "10000" })
    const out = await fetchCensusDensity(40.75, -73.99)
    expect(out).not.toBeNull()
    expect(Math.round(out!.peoplePerSqMi)).toBe(8000)
    expect(out!.densityClass).toBe("dense_urban")
    expect(out!.tier).toBe("dense_urban")
    expect(out!.source).toBe("census")
  })

  it("a rural tract → rural class", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    const land = landAreaForDensity(500, 200) // 200/sq-mi
    installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "999999", AREALAND: land }, population: "500" })
    const out = await fetchCensusDensity(44.0, -103.2)
    expect(out!.densityClass).toBe("rural")
  })

  it("a Census geocoder failure/timeout → null (no throw)", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    installFetch({ geocodeThrows: true })
    await expect(fetchCensusDensity(32.7, -96.8)).resolves.toBeNull()
  })

  it("tract not found → null (no throw)", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    installFetch({ tract: null })
    await expect(fetchCensusDensity(0, 0)).resolves.toBeNull()
  })

  it("ACS returns no population row → null", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: 1e6 }, population: null })
    await expect(fetchCensusDensity(32.7, -96.8)).resolves.toBeNull()
  })

  it("missing/non-finite coords → null without fetching", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    const stub = installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "0", AREALAND: 1e6 }, population: "1" })
    expect(await fetchCensusDensity(null, -96.8)).toBeNull()
    expect(await fetchCensusDensity(Number.NaN, -96.8)).toBeNull()
    expect(stub.fn).not.toHaveBeenCalled()
  })

  it("L1 cache: a repeated lookup at the same point does NOT re-fetch", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    const land = landAreaForDensity(10_000, 8_000)
    const stub = installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: land }, population: "10000" })
    const a = await fetchCensusDensity(40.75, -73.99)
    const b = await fetchCensusDensity(40.75, -73.99)
    expect(a).toEqual(b)
    // First call = 1 geocode + 1 ACS; the second is served from L1 (no more fetches).
    expect(stub.geocodeCalls).toBe(1)
    expect(stub.acsCalls).toBe(1)
  })
})

// ── ensureCensusDensity: cache (L2) + key gate ────────────────────────────────
function makeSupabaseStub(opts: { row?: Record<string, unknown> | null } = {}) {
  const upserts: Array<Record<string, unknown>> = []
  let selectCalls = 0
  const client = {
    from() {
      return this
    },
    select() {
      selectCalls++
      return this
    },
    eq() {
      return this
    },
    async maybeSingle() {
      return { data: opts.row ?? null, error: null }
    },
    async upsert(row: Record<string, unknown>) {
      upserts.push(row)
      return { data: null, error: null }
    },
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: client as any,
    upserts,
    get selectCalls() {
      return selectCalls
    },
  }
}

describe("ensureCensusDensity — cache + no-op gate", () => {
  it("NO key → null and never touches the cache (true no-op)", async () => {
    const sb = makeSupabaseStub()
    const out = await ensureCensusDensity(sb.client, "loc-1", 32.7, -96.8)
    expect(out).toBeNull()
    expect(sb.selectCalls).toBe(0)
  })

  it("a fresh census-sourced L2 row is reused WITHOUT a live fetch", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    const stub = installFetch({ geocodeThrows: true }) // would fail if it tried to fetch
    const sb = makeSupabaseStub({
      row: { residential_density: 8_000, source: "census", refreshed_at: new Date().toISOString() },
    })
    const out = await ensureCensusDensity(sb.client, "loc-1", 40.75, -73.99)
    expect(out!.peoplePerSqMi).toBe(8_000)
    expect(out!.densityClass).toBe("dense_urban")
    expect(stub.fn).not.toHaveBeenCalled() // served from L2
  })

  it("a stale row → live fetch + an upsert into location_density (source=census)", async () => {
    process.env.CENSUS_API_KEY = "test-key"
    const land = landAreaForDensity(10_000, 8_000)
    installFetch({ tract: { STATE: "48", COUNTY: "113", TRACT: "012345", AREALAND: land }, population: "10000" })
    const old = new Date(Date.now() - 400 * 86400_000).toISOString() // > 365d TTL
    const sb = makeSupabaseStub({ row: { residential_density: 1, source: "census", refreshed_at: old } })
    const out = await ensureCensusDensity(sb.client, "loc-1", 40.75, -73.99)
    expect(out!.densityClass).toBe("dense_urban")
    expect(sb.upserts).toHaveLength(1)
    expect(sb.upserts[0]).toMatchObject({ location_id: "loc-1", source: "census", tier: "dense_urban" })
    expect(Math.round(sb.upserts[0].residential_density as number)).toBe(8000)
  })
})
