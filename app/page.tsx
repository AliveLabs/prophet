import Link from "next/link"
import { FadeIn } from "@/components/motion/fade-in"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

export default function Home() {
  return (
    <div className="min-h-screen bg-warm-white text-near-black">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Vatic">
            <path d="M10 14 L40 66 L70 14" stroke="#5A3FFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="40" cy="66" r="6" fill="#F2A11E"/>
          </svg>
          <span className="font-[family-name:var(--font-cormorant)] text-lg font-medium text-near-black">Vatic</span>
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
            <Badge className="border-[#E8E4FF] bg-pale-lavender text-vatic-indigo">
              Competitive intelligence for local businesses
            </Badge>
            <div className="space-y-4">
              <h1 className="font-[family-name:var(--font-cormorant)] text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
                See further.
              </h1>
              <p className="text-lg text-deep-violet">
                Vatic monitors competitors around each location, captures daily
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
            <div className="flex flex-wrap gap-6 text-sm text-deep-violet">
              <div>
                <p className="font-semibold text-near-black">Continuous monitoring</p>
                <p>Automatic competitor intelligence.</p>
              </div>
              <div>
                <p className="font-semibold text-near-black">Explainable insights</p>
                <p>Deterministic diff + rules.</p>
              </div>
              <div>
                <p className="font-semibold text-near-black">Built for teams</p>
                <p>Multi-tenant, role-based access.</p>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.1} className="space-y-6">
            <Card className="border-[#E8E4FF] bg-white text-near-black">
              <CardHeader>
                <CardTitle>What Vatic delivers</CardTitle>
                <CardDescription className="text-deep-violet">
                  A continuous intelligence stream without manual work.
                </CardDescription>
              </CardHeader>
              <div className="space-y-4 text-sm text-deep-violet">
                <p>
                  <span className="font-semibold text-near-black">Discovery:</span>{" "}
                  auto-find nearby listings with relevance scoring.
                </p>
                <p>
                  <span className="font-semibold text-near-black">Change tracking:</span>{" "}
                  ratings, reviews, hours, and profile updates.
                </p>
                <p>
                  <span className="font-semibold text-near-black">Insight feed:</span>{" "}
                  confidence, severity, and evidence in one place.
                </p>
                <p>
                  <span className="font-semibold text-near-black">Compliance-first:</span>{" "}
                  licensed providers and RLS on all data.
                </p>
              </div>
            </Card>
            <Card className="border-[#E8E4FF] bg-white text-near-black">
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

        <section className="border-t border-[#E8E4FF] bg-white">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 lg:grid-cols-3">
            <div>
              <h2 className="font-[family-name:var(--font-cormorant)] text-xl font-medium">How it works</h2>
              <p className="mt-2 text-sm text-deep-violet">
                Add a location, review suggested competitors, then let Vatic
                handle daily monitoring.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-violet">
                Daily workflow
              </h3>
              <Separator className="my-3 border-[#E8E4FF]" />
              <ul className="space-y-2 text-sm text-deep-violet">
                <li>1. Orchestrator schedules snapshots.</li>
                <li>2. Providers normalize data.</li>
                <li>3. Diffs generate insights.</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-violet">
                Guardrails
              </h3>
              <Separator className="my-3 border-[#E8E4FF]" />
              <ul className="space-y-2 text-sm text-deep-violet">
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
