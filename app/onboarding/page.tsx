import { redirect } from "next/navigation"
import { createOrganizationAction } from "./actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { requireUser } from "@/lib/auth/server"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FadeIn } from "@/components/motion/fade-in"
import LocationSearch from "@/components/places/location-search"

type OnboardingPageProps = {
  searchParams?: Promise<{
    error?: string
  }>
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_organization_id")
    .eq("id", user.id)
    .maybeSingle()

  if (profile?.current_organization_id) {
    redirect("/home")
  }

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <FadeIn>
          <Card className="bg-white text-slate-900">
            <h1 className="text-2xl font-semibold">Add your first location</h1>
            <p className="mt-1 text-sm text-slate-600">
              Search for your business and we’ll auto-populate the details.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {decodeURIComponent(error)}
              </p>
            ) : null}
            <div className="mt-6 grid gap-6">
              <form action={createOrganizationAction} className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Organization name</Label>
                  <Input name="organization_name" required />
                </div>
                <div className="grid gap-2">
                  <Label>Organization slug (optional)</Label>
                  <Input name="organization_slug" placeholder="prophet-co" />
                </div>
                <div className="grid gap-2">
                  <Label>Business search</Label>
                  <LocationSearch />
                </div>
                <Button type="submit" size="lg">
                  Continue
                </Button>
              </form>
            </div>
          </Card>
        </FadeIn>
      </section>
    </div>
  )
}
