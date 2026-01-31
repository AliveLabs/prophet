import Link from "next/link"
import { FadeIn } from "@/components/motion/fade-in"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-lg font-semibold">
          Prophet
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/login">
            <Button variant="secondary" size="sm">
              Log in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Get started</Button>
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr]">
          <FadeIn className="space-y-8">
            <Badge className="bg-white text-slate-600 border-slate-200">
              Competitive intelligence for local businesses
            </Badge>
            <div className="space-y-4">
              <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Know what changed nearby, every morning.
              </h1>
              <p className="text-lg text-slate-600">
                Prophet monitors competitors around each location, captures daily
                snapshots, and turns changes into actionable insights with clear
                confidence scoring.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup">
                <Button size="lg">Start monitoring</Button>
              </Link>
              <Link href="/login">
                <Button variant="secondary" size="lg">
                  Log in
                </Button>
              </Link>
            </div>
            <div className="flex flex-wrap gap-6 text-sm text-slate-600">
              <div>
                <p className="text-slate-900 font-semibold">Daily snapshots</p>
                <p>Automatic competitor monitoring.</p>
              </div>
              <div>
                <p className="text-slate-900 font-semibold">Explainable insights</p>
                <p>Deterministic diff + rules.</p>
              </div>
              <div>
                <p className="text-slate-900 font-semibold">Built for teams</p>
                <p>Multi-tenant, role-based access.</p>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.1} className="space-y-6">
            <Card className="bg-white text-slate-900">
              <CardHeader>
                <CardTitle>What Prophet delivers</CardTitle>
                <CardDescription className="text-slate-600">
                  A daily signal stream without manual work.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 text-sm text-slate-600">
                <p>
                  <span className="font-semibold text-slate-900">Discovery:</span>{" "}
                  auto-find nearby listings with relevance scoring.
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Change tracking:</span>{" "}
                  ratings, reviews, hours, and profile updates.
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Insight feed:</span>{" "}
                  confidence, severity, and evidence in one place.
                </p>
                <p>
                  <span className="font-semibold text-slate-900">Compliance-first:</span>{" "}
                  licensed providers and RLS on all data.
                </p>
              </div>
            </Card>
            <Card className="bg-white text-slate-900">
              <CardHeader>
                <CardTitle>Example insight</CardTitle>
                <CardDescription>
                  Rating decreased by 0.2 points since yesterday.
                </CardDescription>
              </CardHeader>
              <div className="flex items-center gap-3">
                <Badge variant="warning">Severity: Warning</Badge>
                <Badge variant="success">Confidence: High</Badge>
              </div>
            </Card>
          </FadeIn>
        </section>

        <section className="border-t border-slate-200 bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 lg:grid-cols-3">
            <div>
              <h2 className="text-lg font-semibold">How it works</h2>
              <p className="mt-2 text-sm text-slate-600">
                Add a location, review suggested competitors, then let Prophet
                handle daily monitoring.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Daily workflow
              </h3>
              <Separator className="my-3 border-slate-200" />
              <ul className="space-y-2 text-sm text-slate-600">
                <li>1. Orchestrator schedules snapshots.</li>
                <li>2. Providers normalize data.</li>
                <li>3. Diffs generate insights.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Guardrails
              </h3>
              <Separator className="my-3 border-slate-200" />
              <ul className="space-y-2 text-sm text-slate-600">
                <li>Official APIs only.</li>
                <li>No protected ad accounts.</li>
                <li>Minimal data retention.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
