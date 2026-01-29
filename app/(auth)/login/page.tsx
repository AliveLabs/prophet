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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="text-lg font-semibold">
          Prophet
        </Link>
        <Link href="/signup">
          <Button variant="secondary" size="sm">
            Create account
          </Button>
        </Link>
      </div>
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr]">
        <FadeIn className="space-y-6">
          <h1 className="text-4xl font-semibold tracking-tight">
            Welcome back.
          </h1>
          <p className="text-slate-600">
            Sign in to access your daily competitor snapshots and insight feed.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">Why Magic Link?</p>
            <p className="mt-2">
              Passwordless access keeps your team secure while reducing friction.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <Card className="bg-white text-slate-900">
            <h2 className="text-xl font-semibold">Sign in</h2>
            <p className="mt-1 text-sm text-slate-600">
              We’ll email you a secure magic link.
            </p>
            {error ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {decodeURIComponent(error)}
              </p>
            ) : null}
            {sent ? (
              <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
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
            <div className="my-6 flex items-center gap-3 text-xs text-slate-400">
              <Separator className="flex-1" />
              or
              <Separator className="flex-1" />
            </div>
            <form action={signInWithGoogleAction}>
              <Button type="submit" variant="secondary" className="w-full">
                Continue with Google
              </Button>
            </form>
            <p className="mt-6 text-sm text-slate-600">
              New to Prophet?{" "}
              <Link href="/signup" className="font-semibold text-slate-900">
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
