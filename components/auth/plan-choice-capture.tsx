"use client"

// ALT-645: stash the plan the visitor picked on the marketing pricing page, so it survives the
// magic-link round trip to the in-app picker.
//
// Why a client component writing document.cookie rather than the server setting it: /signup is a
// server component, and a server component cannot set cookies. Only Server Actions and Route
// Handlers can. Adding a route handler or an action for a presentational hint would be more moving
// parts than this, and this runs once on mount with no render output.
//
// Same file as HashTokenHandler in spirit: a small mount-time side effect on the signup page.

import { useEffect } from "react"
import {
  PLAN_CHOICE_COOKIE,
  PLAN_CHOICE_MAX_AGE_SECONDS,
  isEmptyPlanChoice,
  parsePlanChoice,
  serialisePlanChoice,
} from "@/lib/billing/plan-choice"

export function PlanChoiceCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const choice = parsePlanChoice({ plan: params.get("plan"), billing: params.get("billing") })
    // No recognised parameters means do nothing at all. Deliberately NOT clearing an existing
    // cookie: someone who lands on /signup a second time without parameters (a bookmark, a retry
    // after a bounced email) has not changed their mind, and wiping their choice on that visit
    // would be a silent downgrade to the default.
    if (isEmptyPlanChoice(choice)) return

    // `Secure` is omitted on localhost because browsers reject Secure cookies over plain http, and
    // dropping it there is the difference between this working in dev and silently not.
    const secure = window.location.protocol === "https:" ? "; Secure" : ""
    document.cookie =
      `${PLAN_CHOICE_COOKIE}=${encodeURIComponent(serialisePlanChoice(choice))}` +
      `; Path=/; Max-Age=${PLAN_CHOICE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`
  }, [])

  return null
}
