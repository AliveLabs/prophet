"use server"

import { redirect } from "next/navigation"
import { updateTag } from "next/cache"

export async function refreshWeatherAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  updateTag("weather-data")
  updateTag("home-data")
  redirect(`/weather${locationId ? `?location_id=${locationId}` : ""}`)
}
