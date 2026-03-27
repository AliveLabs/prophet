import { redirect } from "next/navigation"
import { requireUser } from "@/lib/auth/server"
import OnboardingWizard from "@/app/onboarding/onboarding-wizard"

export default async function NewOrganizationPage() {
  await requireUser().catch(() => redirect("/login"))

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <OnboardingWizard />
    </div>
  )
}
