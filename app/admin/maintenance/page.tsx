import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { RevealOnView, TkSectionHead } from "@/components/ticket"
import { ClearTestData } from "./components/clear-test-data"
import "@/components/ticket/pass.css"
import "./maintenance.css"

// Destructive housekeeping for non-customer data. PRESENTATION rebuilt to "The Pass":
// this admin route is outside the dashboard shell, so the page self-hosts its own
// `.ticket-chrome` Pass surface + imports the kit CSS + mounts the atmospheric canvas.
// The flow (preview → typed-count + reason confirm → server action) is unchanged.
export default async function MaintenancePage() {
  await requirePlatformAdmin()

  return (
    <div className="ticket-chrome tk-kit">
      <div className="bg-atmos" aria-hidden />
      <div className="mt-surface">
        <RevealOnView as="header" className="mt-head">
          <span className="mt-eyebrow">
            {wrenchIcon}
            Platform maintenance
          </span>
          <h1>Maintenance</h1>
          <p className="mt-lede">
            Destructive housekeeping for non-customer data. Every action previews exactly
            what it will touch before it deletes — nothing is removed without a typed
            confirmation and a logged reason.
          </p>
        </RevealOnView>

        <TkSectionHead
          title="Clear test data"
          sub="Test & demo orgs only · never customer data"
        />
        <ClearTestData />
      </div>
    </div>
  )
}

const wrenchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15.5 4.5a4 4 0 0 0-5.3 5.3L4 16l4 4 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.6-.7-.7-2.6 2.6-2.6z" />
  </svg>
)
