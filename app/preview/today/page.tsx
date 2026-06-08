import { connection } from "next/server"
import { loadPreviewContext } from "../preview-data"
import BriefView from "../../(dashboard)/home/brief-view"

export default async function PreviewToday() {
  await connection()
  const ctx = await loadPreviewContext()
  if (!ctx.brief) {
    return (
      <div className="pv-page">
        <div className="pv-page-head">
          <span className="pv-kicker">Your Brief</span>
          <h1 className="pv-h1">Getting your market read.</h1>
        </div>
        <span className="pv-soon">No brief precomputed yet for this location.</span>
      </div>
    )
  }
  return (
    <BriefView
      brief={ctx.brief}
      locationId={ctx.locationId}
      locationName={ctx.locationName}
      competitors={ctx.competitors.map((c) => c.name)}
      readOnly
      detailHrefBase="/preview/today"
    />
  )
}
