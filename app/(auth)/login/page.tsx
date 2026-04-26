import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "./actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { FadeIn } from "@/components/motion/fade-in"
import { HashTokenHandler } from "@/components/auth/hash-token-handler"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import ThemeToggle from "@/components/ui/theme-toggle"
import { TicketLogo } from "@/components/brand/ticket-logo"

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string
    sent?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
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
        <Link href="/" className="flex items-center gap-2.5" aria-label="Ticket home">
          <TicketLogo size={26} className="text-foreground" />
          <span className="text-wordmark text-xl font-semibold tracking-tight text-foreground">Ticket</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/signup">
            <Button variant="secondary" size="sm">
              Create account
            </Button>
          </Link>
        </div>
      </div>

      {/* Content */}
      <section className="relative z-10 mx-auto grid w-full max-w-6xl gap-12 px-8 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <FadeIn className="space-y-8">
          <div className="h-[2px] w-12 bg-accent" />
          <h1 className="font-display text-tight text-4xl text-foreground sm:text-5xl lg:text-6xl">
            <em className="italic">Welcome back.</em>
          </h1>
          <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
            Sign in to your Ticket feed and see what&apos;s shifting around you.
          </p>
          <div className="glass-panel rounded-xl p-6 text-sm text-muted-foreground">
            <p className="font-bold text-foreground">Why Magic Link?</p>
            <p className="mt-2 leading-relaxed">
              Passwordless access keeps your team secure while reducing friction.
              No passwords to remember, rotate, or leak.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="bg-card text-foreground editorial-shadow">
            <h2 className="text-xl font-bold">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll email you a secure magic link.
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
              <input type="hidden" name="redirect_to" value="/login" />
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
              New to Ticket?{" "}
              <Link href="/signup" className="font-semibold text-vatic-indigo hover:text-vatic-indigo/80">
                Create an account
              </Link>
              .
            </p>
          </Card>
        </FadeIn>
      </section>
    </div>
  )
}
