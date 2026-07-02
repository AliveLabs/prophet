"use client"

// The Pass — Traffic page filter bar (client island).
//
// Wraps the SAME wired interactive bit (LocationFilter pushes ?location_id)
// — only the surrounding chrome is rebuilt to the kit's soft-panel look with
// a live pulse + tracked count. Server data flow is untouched: this is
// purely the presentation wrapper. Busy-times data refreshes daily via cron
// (ALT-268 removed the per-surface manual "Fetch busy times" button).

import LocationFilter from "@/components/ui/location-filter"

export default function TrafficControls({
  locations,
  selectedLocationId,
  trackedCount,
}: {
  locations: Array<{ id: string; name: string }>
  selectedLocationId: string
  trackedCount: number
}) {
  return (
    <div className="tk-trf-bar">
      <div className="tk-trf-bar-left">
        <span className="tk-trf-live" aria-hidden="true" />
        <span className="tk-trf-status">
          {trackedCount > 0 ? (
            <>
              Reading <b>{trackedCount}</b> competitor{trackedCount === 1 ? "" : "s"}&apos; busy times
            </>
          ) : (
            "No busy-times data pulled yet"
          )}
        </span>
      </div>
      <div className="tk-trf-bar-right">
        {locations.length > 1 && (
          <LocationFilter locations={locations} selectedLocationId={selectedLocationId} />
        )}
      </div>
    </div>
  )
}
