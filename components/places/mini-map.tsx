type MiniMapProps = {
  lat?: number | null
  lng?: number | null
  className?: string
  title?: string | null
  mapsUri?: string | null
  placeId?: string | null
  address?: string | null
}

export default function MiniMap({
  lat,
  lng,
  className,
  title,
  mapsUri,
  placeId,
  address,
}: MiniMapProps) {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null
  }

  const key = process.env.GOOGLE_MAPS_API_KEY
  if (!key) {
    return null
  }

  const query = address ?? `${lat},${lng}`
  const embedQuery = placeId ? `place_id:${placeId}` : query
  const mapUrl = `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(
    key
  )}&q=${encodeURIComponent(embedQuery)}&zoom=14`
  const mapsLink =
    mapsUri ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${
      placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""
    }`

  return (
    <div className={className}>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <iframe
          title={title ?? "Map"}
          src={mapUrl}
          className="h-32 w-full"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
      <a
        href={mapsLink}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex items-center justify-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white"
      >
        Open in Google Maps
      </a>
    </div>
  )
}
