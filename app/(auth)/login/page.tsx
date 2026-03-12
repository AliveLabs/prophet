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
    <div className="min-h-screen bg-warm-white text-near-black">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Vatic">
            <path d="M10 14 L40 66 L70 14" stroke="#5A3FFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="40" cy="66" r="6" fill="#F2A11E"/>
          </svg>
          <span className="font-[family-name:var(--font-cormorant)] text-lg font-medium text-near-black">Vatic</span>
        </Link>
        <Link href="/signup">
          <Button variant="secondary" size="sm">
            Create account
          </Button>
        </Link>
      </div>
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <FadeIn className="space-y-6">
          <h1 className="font-[family-name:var(--font-cormorant)] text-4xl font-medium tracking-tight sm:text-5xl">
            Welcome back.
          </h1>
          <p className="text-deep-violet">
            Sign in to access your competitive intelligence feed.
          </p>
          <div className="rounded-2xl border border-[#E8E4FF] bg-white p-6 text-sm text-deep-violet shadow-sm">
            <p className="font-semibold text-near-black">Why Magic Link?</p>
            <p className="mt-2">
              Passwordless access keeps your team secure while reducing friction.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="bg-white text-near-black">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-deep-violet">
              We&apos;ll email you a secure magic link.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {decodeURIComponent(error)}
              </p>
            ) : null}
            {sent ? (
              <p className="mt-4 rounded-xl border border-precision-teal/30 bg-precision-teal-light px-4 py-3 text-sm text-precision-teal">
                Magic link sent. Check your email to continue.
              </p>
            ) : null}
            <form action={sendMagicLinkAction} className="mt-6 grid gap-4">
              <input type="hidden" name="redirect_to" value="/login" />
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input name="email" type="email" required placeholder="you@company.com" />
              </div>
              <Button type="submit">Send magic link</Button>
            </form>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-violet">
              <Separator className="flex-1" />
              or
              <Separator className="flex-1" />
            </div>
            <form action={signInWithGoogleAction}>
              <Button type="submit" variant="secondary" className="w-full">
                Continue with Google
              </Button>
            </form>
            <p className="mt-6 text-sm text-deep-violet">
              New to Vatic?{" "}
              <Link href="/signup" className="font-semibold text-vatic-indigo hover:text-deep-indigo">
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
