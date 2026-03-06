"use server"

import { redirect } from "next/navigation"
import { revalidateTag } from "next/cache"

export async function refreshPhotosAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  revalidateTag("photos-data", { expire: 0 })
  revalidateTag("home-data", { expire: 0 })
  redirect(`/photos${locationId ? `?location_id=${locationId}` : ""}`)
}
