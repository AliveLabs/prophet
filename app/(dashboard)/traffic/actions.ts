"use server"

import { redirect } from "next/navigation"
import { revalidateTag } from "next/cache"

export async function refreshTrafficAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  revalidateTag("traffic-data", { expire: 0 })
  revalidateTag("home-data", { expire: 0 })
  redirect(`/traffic${locationId ? `?location_id=${locationId}` : ""}`)
}
