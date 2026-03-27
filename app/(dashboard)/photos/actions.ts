"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"

export async function refreshPhotosAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  updateTag("photos-data")
  updateTag("home-data")
  redirect(`/photos${locationId ? `?location_id=${locationId}` : ""}`)
}
