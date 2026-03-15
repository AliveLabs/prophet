import Link from "next/link"
import { redirect } from "next/navigation"
import { sendMagicLinkAction, signInWithGoogleAction } from "./actions"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { FadeIn } from "@/components/motion/fade-in"
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
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Vatic">
            <path d="M10 14 L40 66 L70 14" stroke="#5A3FFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="40" cy="66" r="6" fill="#F2A11E"/>
          </svg>
          <span className="font-display text-lg font-medium text-foreground">Vatic</span>
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
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr]">
        <FadeIn className="space-y-6">
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            Start monitoring in minutes.
          </h1>
          <p className="text-muted-foreground">
            Create an account to discover competitors and receive daily intelligence
            for each location.
          </p>
          <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
            <p className="font-semibold text-foreground">Included in every plan</p>
            <ul className="mt-3 space-y-2">
              <li>Continuous competitor monitoring</li>
              <li>Confidence and severity scoring</li>
              <li>Team-based access controls</li>
            </ul>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="bg-card text-foreground">
            <h2 className="text-xl font-semibold">Create account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use a magic link or Google to get started.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {decodeURIComponent(error)}
              </p>
            ) : null}
            {sent ? (
              <p className="mt-4 rounded-xl border border-precision-teal/30 bg-precision-teal-light px-4 py-3 text-sm text-precision-teal">
                Magic link sent. Check your email to continue.
              </p>
            ) : null}
            <form action={sendMagicLinkAction} className="mt-6 grid gap-4">
              <input type="hidden" name="redirect_to" value="/signup" />
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input name="email" type="email" required placeholder="you@company.com" />
              </div>
              <Button type="submit">Send magic link</Button>
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
              <Link href="/login" className="font-semibold text-primary hover:text-primary/80">
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
