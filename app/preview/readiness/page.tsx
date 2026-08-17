// Preview harness for the gated-surface panel (ALT-629), alongside the other /preview routes.
// Pure props, no auth, no reads: it renders the panel the way a first-run operator meets it so
// the copy and the layout can be reviewed without standing up a whole first run.

import SurfaceNotReady from "@/components/first-run/surface-not-ready"
import { surfaceReadiness } from "@/lib/onboarding/surface-readiness"

const MID_FIRST_RUN = [
  { pipeline: "content", status: "queued" },
  { pipeline: "weather", status: "running" },
  { pipeline: "busy_times", status: "queued" },
]

export default function ReadinessPreviewPage() {
  // No `.ticket-app` wrapper: the preview shell already provides one, and nesting a second grid
  // root drops this into the sidebar column.
  return (
    <div>
      <div className="tk-kit">
        <SurfaceNotReady readiness={surfaceReadiness("weather", MID_FIRST_RUN)} title="Weather, events & demand" />
        <SurfaceNotReady readiness={surfaceReadiness("competitors", MID_FIRST_RUN)} title="Your competitive set" />
      </div>
    </div>
  )
}
