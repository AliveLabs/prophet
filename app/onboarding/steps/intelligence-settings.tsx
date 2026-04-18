"use client"

type Preferences = {
  pricing_changes: boolean
  menu_updates: boolean
  promotions: boolean
  review_activity: boolean
  new_openings: boolean
}

const SETTINGS = [
  {
    key: "pricing_changes" as const,
    label: "Pricing Changes",
    desc: "Track when competitors raise or lower their prices",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 1.5v15M5.5 5c0-1.1 1.57-2 3.5-2s3.5.9 3.5 2-1.57 2-3.5 2-3.5.9-3.5 2 1.57 2 3.5 2 3.5.9 3.5 2"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: "menu_updates" as const,
    label: "Menu Updates",
    desc: "Know when menus change, items appear or disappear",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect
          x="3"
          y="2"
          width="12"
          height="14"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M6 6h6M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    key: "promotions" as const,
    label: "Promotions & Events",
    desc: "Spot competitors running deals, happy hours, specials",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M2 9l7-6.5L16 9M4 8v6.5a1 1 0 001 1h8a1 1 0 001-1V8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: "review_activity" as const,
    label: "Review Activity",
    desc: "Monitor review trends, ratings, and common complaints",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M9 1.5l2.47 4.36 4.78.96-3.38 3.55.63 4.88L9 13l-4.5 2.25.63-4.88L1.75 6.82l4.78-.96L9 1.5z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: "new_openings" as const,
    label: "New Openings Nearby",
    desc: "Get alerted when new restaurants open in your area",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9 5.5v7M5.5 9h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
]

type IntelligenceSettingsStepProps = {
  preferences: Preferences
  onChange: (prefs: Preferences) => void
  brandName?: string
}

export default function IntelligenceSettingsStep({
  preferences,
  onChange,
  brandName = "Vatic",
}: IntelligenceSettingsStepProps) {
  const toggle = (key: keyof Preferences) => {
    onChange({ ...preferences, [key]: !preferences[key] })
  }

  return (
    <section className="flex flex-col pt-10 pb-8 max-[540px]:pt-8">
      <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-precision-teal mb-3">
        What to Watch
      </div>
      <h2 className="font-display text-[32px] font-medium leading-[1.15] text-foreground mb-3 max-[540px]:text-[27px]">
        Customize your
        <br />
        <em className="text-vatic-indigo-soft italic">intelligence.</em>
      </h2>
      <p className="text-sm text-muted-foreground leading-relaxed mb-6">
        Choose what {brandName} should monitor. You can always change these later.
      </p>

      <div className="flex flex-col gap-3">
        {SETTINGS.map((s) => {
          const isOn = preferences[s.key]
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-4 rounded-[10px] border p-[13px] text-left transition-all select-none max-[540px]:p-[11px] ${
                isOn
                  ? "bg-vatic-indigo/8 border-vatic-indigo/30"
                  : "bg-card/30 border-border/60 hover:bg-card/50 hover:border-border"
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors max-[540px]:h-9 max-[540px]:w-9 ${
                  isOn
                    ? "bg-vatic-indigo/12 text-vatic-indigo"
                    : "bg-card/50 text-muted-foreground"
                }`}
              >
                {s.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground mb-0.5">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.desc}</div>
              </div>
              <div className="relative shrink-0">
                <div
                  className={`h-[26px] w-[44px] rounded-full transition-all ${
                    isOn ? "bg-vatic-indigo" : "bg-border/80"
                  }`}
                >
                  <div
                    className={`absolute top-[3px] h-[20px] w-[20px] rounded-full bg-white shadow-sm transition-transform ${
                      isOn ? "translate-x-[21px]" : "translate-x-[3px]"
                    }`}
                  />
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
