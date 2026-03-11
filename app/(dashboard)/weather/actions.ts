"use server"

import { redirect } from "next/navigation"
import { revalidateTag } from "next/cache"

export async function refreshWeatherAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  revalidateTag("weather-data", { expire: 0 })
  revalidateTag("home-data", { expire: 0 })
  redirect(`/weather${locationId ? `?location_id=${locationId}` : ""}`)
}
