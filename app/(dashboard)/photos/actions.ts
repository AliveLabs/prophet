"use server"

import { redirect } from "next/navigation"

export async function refreshPhotosAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  redirect(`/photos${locationId ? `?location_id=${locationId}` : ""}`)
}
