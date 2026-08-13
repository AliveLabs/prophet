// ALT-583 regression net. The bug was never a broken query: it was that a settings
// UPDATE matching ZERO rows came back as `{ error: null }` and every action read that
// as success. RLS lets any org member SELECT a location but only owners/admins UPDATE
// it, so a member-role seat could move a slider, be told "Saved", and lose the value on
// the next page load. These pin the classifier that now stands between the two.

import { describe, it, expect } from "vitest"
import {
  classifyLocationWrite,
  NO_ROW_WRITTEN_ERROR,
} from "@/lib/settings/location-write"

describe("classifyLocationWrite", () => {
  it("treats a written row as success", () => {
    expect(classifyLocationWrite(null, [{ id: "loc_1" }])).toEqual({ ok: true })
  })

  it("FAILS a zero-row update instead of reporting a fake save (the ALT-583 bug)", () => {
    const result = classifyLocationWrite(null, [])
    expect(result.ok).toBe(false)
    expect(result).toEqual({ ok: false, error: NO_ROW_WRITTEN_ERROR })
  })

  it("fails when PostgREST returns no rows at all (null data, no error)", () => {
    const result = classifyLocationWrite(null, null)
    expect(result.ok).toBe(false)
  })

  it("passes a real database error through verbatim", () => {
    const result = classifyLocationWrite({ message: "permission denied" }, null)
    expect(result).toEqual({ ok: false, error: "permission denied" })
  })

  it("prefers the database error over the zero-row message when both are present", () => {
    const result = classifyLocationWrite({ message: "connection reset" }, [])
    expect(result).toEqual({ ok: false, error: "connection reset" })
  })

  it("tells the operator what to do about it rather than just saying it failed", () => {
    // The message is what a member-role seat sees, so it has to name the fix.
    expect(NO_ROW_WRITTEN_ERROR).toMatch(/owner or admin/i)
  })

  it("never reports ok for anything but a real written row", () => {
    const nonWrites: Array<Parameters<typeof classifyLocationWrite>> = [
      [null, []],
      [null, null],
      [{ message: "x" }, []],
      [{ message: "x" }, [{ id: "loc_1" }]],
    ]
    for (const [error, rows] of nonWrites) {
      expect(classifyLocationWrite(error, rows).ok).toBe(false)
    }
  })
})
