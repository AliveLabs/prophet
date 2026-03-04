"use server"

import { redirect } from "next/navigation"

export async function refreshTrafficAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  redirect(`/traffic${locationId ? `?location_id=${locationId}` : ""}`)
}
