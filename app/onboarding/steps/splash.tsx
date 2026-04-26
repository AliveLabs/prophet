"use client"

import type { VerticalConfig } from "@/lib/verticals"
import { TicketLogo } from "@/components/brand/ticket-logo"

type SplashStepProps = {
  onContinue: () => void
  verticalConfig?: VerticalConfig
}

export default function SplashStep({ onContinue, verticalConfig }: SplashStepProps) {
  const subtitle = verticalConfig?.onboarding.splash.subtitle ?? "Competitive intelligence for restaurants"
  const ctaLabel = verticalConfig?.onboarding.splash.ctaLabel ?? "Set up my restaurant"
  const brandName = verticalConfig?.brand.displayName ?? "Ticket"

  return (
    <section className="flex min-h-dvh flex-col items-center justify-center pb-12 text-center">
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-precision-teal mb-8">
        {subtitle}
      </div>

      {brandName === "Ticket" && (
        <TicketLogo size={64} className="mb-5 text-foreground" />
      )}

      <div className="font-display text-[58px] font-semibold leading-none tracking-wide text-foreground mb-3 max-[540px]:text-5xl max-[360px]:text-[42px] text-wordmark">
        {brandName}
      </div>

      <h1 className="font-display text-[34px] font-normal leading-[1.22] text-foreground max-w-[380px] mx-auto mb-5 max-[540px]:text-[28px] max-[360px]:text-2xl">
        Know what&apos;s happening{" "}
        <br />
        <em className="text-vatic-indigo-soft italic">around your block.</em>
      </h1>

      <p className="text-sm text-muted-foreground leading-relaxed max-w-[360px] mx-auto mb-10">
        {brandName} watches your competitors&apos; pricing, menus, and promotions — so
        you always know what&apos;s coming before it hits your bottom line.
      </p>

      <button
        type="button"
        onClick={onContinue}
        className="inline-flex items-center gap-2 rounded-[14px] bg-primary px-10 py-4 text-[15px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-deep-indigo hover:-translate-y-px hover:shadow-glow-indigo-sm"
      >
        {ctaLabel}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 8h10M9 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 mt-8">
        {["No credit card required", "Setup in under 2 minutes", "Cancel any time"].map(
          (text) => (
            <div key={text} className="flex items-center gap-[7px] text-xs text-muted-foreground">
              <div className="h-1 w-1 rounded-full bg-precision-teal opacity-55 shrink-0" />
              {text}
            </div>
          )
        )}
      </div>
    </section>
  )
}
