"use server"

import { redirect } from "next/navigation"

export async function refreshWeatherAction(formData: FormData) {
  const locationId = formData.get("location_id") as string | null
  redirect(`/weather${locationId ? `?location_id=${locationId}` : ""}`)
}
