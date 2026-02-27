/**
 * End-to-end script to fetch Visual Intelligence, Busy Times & Weather data
 * and write it to Supabase.
 *
 * Usage: npx tsx scripts/refresh-signals.ts
 */

import { config } from "dotenv"
config({ path: ".env.local" })
import { createClient } from "@supabase/supabase-js"
import { fetchHistoricalWeather } from "../lib/providers/openweathermap"
import { fetchBusyTimes } from "../lib/providers/outscraper"
import { fetchPhotoReferences, downloadPhoto, analyzePhoto } from "../lib/providers/photos"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

async function main() {
  console.log("=== Prophet Signal Refresh ===\n")

  // 1. Get all locations
  const { data: locations, error: locErr } = await supabase
    .from("locations")
    .select("id, name, geo_lat, geo_lng, primary_place_id")

  if (locErr || !locations?.length) {
    console.error("No locations found:", locErr)
    return
  }
  console.log(`Found ${locations.length} locations\n`)

  // 2. Get all active competitors
  const { data: competitors, error: compErr } = await supabase
    .from("competitors")
    .select("id, name, provider_entity_id, location_id")
    .eq("is_active", true)

  if (compErr || !competitors?.length) {
    console.error("No active competitors found:", compErr)
    return
  }
  console.log(`Found ${competitors.length} active competitors\n`)

  // =========================================================================
  // WEATHER: Fetch for all locations
  // =========================================================================
  console.log("--- WEATHER ---")
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  for (const loc of locations) {
    if (!loc.geo_lat || !loc.geo_lng) {
      console.log(`  [skip] ${loc.name} - no coordinates`)
      continue
    }

    try {
      console.log(`  Fetching weather for ${loc.name} (${loc.geo_lat}, ${loc.geo_lng})...`)
      const weather = await fetchHistoricalWeather(loc.geo_lat, loc.geo_lng, yesterday)
      console.log(`    -> ${weather.weather_condition}, ${weather.temp_high_f}°F / ${weather.temp_low_f}°F`)

      const { error: insertErr } = await supabase
        .from("location_weather")
        .upsert({
          location_id: loc.id,
          date: weather.date,
          temp_high_f: weather.temp_high_f,
          temp_low_f: weather.temp_low_f,
          feels_like_high_f: weather.feels_like_high_f,
          humidity_avg: weather.humidity_avg,
          wind_speed_max_mph: weather.wind_speed_max_mph,
          weather_condition: weather.weather_condition,
          weather_description: weather.weather_description,
          weather_icon: weather.weather_icon,
          precipitation_in: weather.precipitation_in,
          is_severe: weather.is_severe,
        }, { onConflict: "location_id,date" })

      if (insertErr) {
        console.error(`    [error] Insert failed:`, insertErr.message)
      } else {
        console.log(`    [ok] Saved weather for ${loc.name}`)
      }
    } catch (err) {
      console.error(`    [error] Weather fetch failed for ${loc.name}:`, err)
    }
  }

  // =========================================================================
  // BUSY TIMES: Fetch for first 5 competitors (to stay within free tier)
  // =========================================================================
  console.log("\n--- BUSY TIMES ---")
  const busyTimesCompetitors = competitors.slice(0, 5)

  for (const comp of busyTimesCompetitors) {
    if (!comp.provider_entity_id || comp.provider_entity_id.startsWith("unknown:")) {
      console.log(`  [skip] ${comp.name} - no valid place ID`)
      continue
    }

    try {
      console.log(`  Fetching busy times for ${comp.name} (${comp.provider_entity_id})...`)
      const result = await fetchBusyTimes(comp.provider_entity_id, comp.id)

      if (!result || result.days.length === 0) {
        console.log(`    -> No busy times data available`)
        continue
      }

      console.log(`    -> Got ${result.days.length} days of data`)
      if (result.typical_time_spent) {
        console.log(`    -> Typical time spent: ${result.typical_time_spent}`)
      }

      for (const day of result.days) {
        const { error: insertErr } = await supabase
          .from("busy_times")
          .insert({
            competitor_id: comp.id,
            day_of_week: day.day_of_week,
            hourly_scores: day.hourly_scores,
            peak_hour: day.peak_hour,
            peak_score: day.peak_score,
            slow_hours: day.slow_hours,
            typical_time_spent: result.typical_time_spent,
            current_popularity: result.current_popularity,
          })

        if (insertErr) {
          console.error(`    [error] Insert day ${day.day_of_week}:`, insertErr.message)
        }
      }
      console.log(`    [ok] Saved busy times for ${comp.name}`)
    } catch (err) {
      console.error(`    [error] Busy times fetch failed for ${comp.name}:`, err)
    }

    await sleep(500)
  }

  // =========================================================================
  // PHOTOS: Fetch + analyze for first 3 competitors (to control API costs)
  // =========================================================================
  console.log("\n--- PHOTOS ---")
  const photoCompetitors = competitors.slice(0, 3)

  for (const comp of photoCompetitors) {
    if (!comp.provider_entity_id || comp.provider_entity_id.startsWith("unknown:")) {
      console.log(`  [skip] ${comp.name} - no valid place ID`)
      continue
    }

    try {
      console.log(`  Fetching photo refs for ${comp.name}...`)
      const refs = await fetchPhotoReferences(comp.provider_entity_id)
      console.log(`    -> ${refs.length} photo references`)

      const photosToProcess = refs.slice(0, 5)
      let savedCount = 0

      for (const ref of photosToProcess) {
        try {
          await sleep(300)
          console.log(`    Downloading ${ref.name.slice(0, 50)}...`)
          const photo = await downloadPhoto(ref.name)
          photo.reference = ref

          console.log(`    Analyzing with Gemini Vision...`)
          const analysis = await analyzePhoto(photo.buffer, photo.mimeType)
          console.log(`      -> Category: ${analysis.category}, Confidence: ${analysis.confidence}`)
          if (analysis.promotional_content) {
            console.log(`      -> PROMO: ${analysis.promotional_details}`)
          }
          if (analysis.extracted_text) {
            console.log(`      -> OCR: "${analysis.extracted_text.slice(0, 80)}"`)
          }

          // Upload to Supabase Storage
          const storagePath = `${comp.id}/${photo.hash}.jpg`
          const { error: uploadErr } = await supabase.storage
            .from("competitor-photos")
            .upload(storagePath, photo.buffer, {
              contentType: photo.mimeType,
              upsert: true,
            })

          let publicUrl: string | null = null
          if (!uploadErr) {
            const { data: urlData } = supabase.storage
              .from("competitor-photos")
              .getPublicUrl(storagePath)
            publicUrl = urlData.publicUrl
          } else {
            console.warn(`      [warn] Upload failed: ${uploadErr.message}`)
          }

          const { error: insertErr } = await supabase
            .from("competitor_photos")
            .upsert({
              competitor_id: comp.id,
              place_photo_name: ref.name,
              image_hash: photo.hash,
              image_url: publicUrl,
              width_px: ref.widthPx,
              height_px: ref.heightPx,
              author_attribution: ref.authorAttributions,
              analysis_result: analysis as unknown as Record<string, unknown>,
              first_seen_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            }, { onConflict: "id" })

          if (insertErr) {
            console.error(`      [error] DB insert:`, insertErr.message)
          } else {
            savedCount++
          }
        } catch (photoErr) {
          console.error(`      [error] Photo processing:`, photoErr)
        }
      }

      console.log(`    [ok] Saved ${savedCount} photos for ${comp.name}`)
    } catch (err) {
      console.error(`    [error] Photo pipeline failed for ${comp.name}:`, err)
    }
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n=== Summary ===")

  const { count: weatherCount } = await supabase
    .from("location_weather")
    .select("*", { count: "exact", head: true })
  console.log(`Weather records: ${weatherCount}`)

  const { count: busyCount } = await supabase
    .from("busy_times")
    .select("*", { count: "exact", head: true })
  console.log(`Busy times records: ${busyCount}`)

  const { count: photoCount } = await supabase
    .from("competitor_photos")
    .select("*", { count: "exact", head: true })
  console.log(`Photo records: ${photoCount}`)

  console.log("\nDone! Start the dev server and check the Insights page.")
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(console.error)
