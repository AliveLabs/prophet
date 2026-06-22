import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { ClearTestData } from "./components/clear-test-data"

export default async function MaintenancePage() {
  await requirePlatformAdmin()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Maintenance
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Destructive housekeeping for non-customer data. Every action previews
          before it deletes.
        </p>
      </div>

      <section>
        <h2 className="mb-4 text-base font-semibold text-foreground">
          Clear test data
        </h2>
        <ClearTestData />
      </section>
    </div>
  )
}
