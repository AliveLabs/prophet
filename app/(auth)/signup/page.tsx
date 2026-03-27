import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "../login/actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { FadeIn } from "@/components/motion/fade-in"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import ThemeToggle from "@/components/ui/theme-toggle"

type SignupPageProps = {
  searchParams?: Promise<{
    error?: string
    sent?: string
  }>
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const supabase = await createServerSupabaseClient()
  const { data } = await supabase.auth.getUser()
  if (data.user) {
    redirect("/home")
  }

  const resolvedSearchParams = await Promise.resolve(searchParams)
  const error = resolvedSearchParams?.error
  const sent = resolvedSearchParams?.sent

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <HashTokenHandler />

      {/* Ambient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-[400px] w-[400px] rounded-full bg-vatic-indigo/[0.06] blur-[100px] dark:bg-vatic-indigo/[0.12]" />
        <div className="absolute -bottom-32 right-1/4 h-[300px] w-[300px] rounded-full bg-signal-gold/[0.04] blur-[80px] dark:bg-signal-gold/[0.08]" />
      </div>

      {/* Top bar */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-8 py-6">
        <Link href="/" className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Vatic">
            <path d="M10 14 L40 66 L70 14" stroke="var(--vatic-indigo)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="40" cy="66" r="6" fill="var(--signal-gold)" />
          </svg>
          <span className="font-display text-xl italic tracking-tight text-signal-gold">Vatic</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/login">
            <Button variant="secondary" size="sm">
              Log in
            </Button>
          </Link>
        </div>
      </div>

      {/* Content */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl gap-12 px-8 py-12 lg:grid-cols-[1.05fr_0.95fr]">
        <FadeIn className="space-y-8">
          <div className="h-[2px] w-12 bg-signal-gold" />
          <h1 className="font-display text-tight text-4xl italic text-foreground sm:text-5xl lg:text-6xl">
            Start monitoring in minutes.
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
            Create an account to discover competitors and receive daily intelligence
            for each location.
          </p>
          <div className="glass-panel rounded-xl p-6 text-sm text-muted-foreground">
            <p className="font-bold text-foreground">Included in every plan</p>
            <ul className="mt-3 space-y-2">
              <li className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-vatic-indigo">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Continuous competitor monitoring
              </li>
              <li className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-vatic-indigo">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Confidence and severity scoring
              </li>
              <li className="flex items-start gap-2">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0 text-vatic-indigo">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Team-based access controls
              </li>
            </ul>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="bg-card text-foreground editorial-shadow">
            <h2 className="text-xl font-bold">Create account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a magic link or Google to get started.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {decodeURIComponent(error)}
              </p>
            ) : null}
            {sent ? (
              <p className="mt-4 rounded-xl border border-precision-teal/30 bg-precision-teal/10 px-4 py-3 text-sm text-precision-teal">
                Magic link sent. Check your email to continue.
              </p>
            ) : null}
            <form action={sendMagicLinkAction} className="mt-6 grid gap-4">
              <input type="hidden" name="redirect_to" value="/signup" />
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input name="email" type="email" required placeholder="you@company.com" />
              </div>
              <Button type="submit" className="vatic-gradient border-0 text-white hover:opacity-90">
                Send magic link
              </Button>
            </form>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              or
              <Separator className="flex-1" />
            </div>
            <form action={signInWithGoogleAction}>
              <Button type="submit" variant="secondary" className="w-full">
                Continue with Google
              </Button>
            </form>
            <p className="mt-6 text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-vatic-indigo hover:text-vatic-indigo/80">
                Sign in
              </Link>
              .
            </p>
          </Card>
        </FadeIn>
      </section>
    </div>
  )
}
