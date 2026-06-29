import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import OnboardingWizard from "@/app/onboarding/onboarding-wizard-pass"

// A logged-in customer creating an ADDITIONAL, separately-billed location as
// its own org. Renders the same "The Pass" pearlescent wizard; the wizard
// owns its full-bleed .ob surface, so no extra chrome wrapper here.
export default async function NewOrganizationPage() {
  await requireUser().catch(() => redirect("/login"))

  return <OnboardingWizard />
}
