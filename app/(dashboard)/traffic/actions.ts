"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"

export async function refreshTrafficAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  updateTag("traffic-data")
  updateTag("home-data")
  redirect(`/traffic${locationId ? `?location_id=${locationId}` : ""}`)
}
