import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { CreateOrgForm } from "./components/create-org-form"

export default async function NewOrgPage() {
  const admin = await requirePlatformAdmin()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Create Demo / Test Org
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spin up an admin-owned organization for sales demos or QA. Real
          customer orgs are created only through signup/onboarding.
        </p>
      </div>

      <CreateOrgForm adminEmail={admin.email ?? ""} />
    </div>
  )
}
