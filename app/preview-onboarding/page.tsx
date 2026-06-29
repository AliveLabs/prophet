"use client"

// Step-through onboarding (Phase 5 polish + Phase 9 real data) — DEV/REVIEW
// mirror, "The Pass" rebuild. The "find your restaurant" step is REAL Google
// Places autocomplete; picking a place prefills the confirm step from the live
// listing and discovers real nearby competitors (each with why it was picked).
// Calls server routes (/api/preview/places/*) so the key stays private. Manual
// entry still works if you don't pick a suggestion. Processing/status +
// notifications at the end are still scaffolded (Phase 9 next).
//
// STRUCTURE rebuild into the Dribbble pearlescent SPLIT layout (canvas rail +
// floating panel). Data wiring unchanged.

import { useState, useEffect, type ReactNode } from "react"
import Link from "next/link"
import "./onboarding.css"

type Place = {
  placeId: string
  name: string
  address: string
  cuisine: string
  price: string
  website: string
  lat: number | null
  lng: number | null
}
type Competitor = { name: string; meta: string; why: string }
type Suggestion = { place_id: string; description: string }

const GOALS = [
  { id: "covers", title: "Fill slow nights", sub: "More customers when you're quiet." },
  { id: "compete", title: "Stay ahead of competitors", sub: "Know their moves before they cost you." },
  { id: "reputation", title: "Protect your reputation", sub: "Catch review and sentiment shifts early." },
  { id: "ops", title: "Run service smoother", sub: "Staffing and prep tuned to demand." },
]
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const
type Day = (typeof DAYS)[number]
type DayHours = { closed: boolean; open: string; close: string }
const DEFAULT_HOURS: Record<Day, DayHours> = {
  Mon: { closed: true, open: "17:00", close: "23:00" },
  Tue: { closed: false, open: "17:00", close: "23:00" },
  Wed: { closed: false, open: "17:00", close: "23:00" },
  Thu: { closed: false, open: "17:00", close: "23:00" },
  Fri: { closed: false, open: "17:00", close: "23:00" },
  Sat: { closed: false, open: "17:00", close: "23:00" },
  Sun: { closed: false, open: "17:00", close: "22:00" },
}
const TOTAL = 5
const STEP_NAMES = ["Find", "Confirm", "Competitors", "Focus", "Build"] as const

const RAIL: Array<{ kicker: string; head: ReactNode; sub: string }> = [
  { kicker: "Welcome to Ticket", head: <>Let&apos;s find <em>your restaurant.</em></>, sub: "Search for your place and we'll pull everything we can from your public listing — so you barely have to type." },
  { kicker: "Mostly done for you", head: <>Does this <em>look right?</em></>, sub: "We pulled these details straight from your listing. Fix anything that's off, then keep going." },
  { kicker: "Found for you", head: <>Here&apos;s who <em>we'd watch.</em></>, sub: "We scanned your neighborhood for similar spots and picked the closest competitors — each with the reason why." },
  { kicker: "Optional", head: <>Anything you&apos;re <em>focused on?</em></>, sub: "It just helps us rank what we surface first. Choose as many as you like — or skip for now." },
  { kicker: "You're set", head: <>Building your <em>first brief.</em></>, sub: "We're pulling competitor, demand, and review signals now. Watch them land — or we'll tell you when it's ready." },
]

const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const IconCheck = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const IconSpark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </svg>
)
const IconBrandT = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 6h14M12 6v12" />
  </svg>
)

function HoursEditor() {
  const [hours, setHours] = useState<Record<Day, DayHours>>(DEFAULT_HOURS)
  const set = (day: Day, patch: Partial<DayHours>) => setHours((h) => ({ ...h, [day]: { ...h[day], ...patch } }))
  return (
    <div className="ob-hours">
      {DAYS.map((d) => {
        const h = hours[d]
        return (
          <div className={`ob-hours__row${h.closed ? " is-closed" : ""}`} key={d}>
            <span className="ob-hours__day">{d}</span>
            {h.closed ? (
              <span className="ob-hours__closed">Closed</span>
            ) : (
              <div className="ob-hours__times">
                <input type="time" className="ob-time" value={h.open} aria-label={`${d} opens`} onChange={(e) => set(d, { open: e.target.value })} />
                <span className="ob-hours__dash">to</span>
                <input type="time" className="ob-time" value={h.close} aria-label={`${d} closes`} onChange={(e) => set(d, { close: e.target.value })} />
              </div>
            )}
            <label className="ob-hours__toggle">
              <input type="checkbox" checked={h.closed} onChange={(e) => set(d, { closed: e.target.checked })} />
              Closed
            </label>
          </div>
        )
      })}
    </div>
  )
}

export default function PreviewOnboarding() {
  const [step, setStep] = useState(0)

  // step 0 — find restaurant (real Places autocomplete)
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<Place | null>(null)
  const [loadingPlace, setLoadingPlace] = useState(false)
  const [placeError, setPlaceError] = useState<string | null>(null)

  // step 2 — competitors (seeded from real discovery)
  const [comps, setComps] = useState<Competitor[]>([])
  const [adding, setAdding] = useState(false)
  const [newComp, setNewComp] = useState("")

  // step 3 — goals (multi-select)
  const [goals, setGoals] = useState<Record<string, boolean>>({})

  // debounced autocomplete; pauses once a place is chosen
  useEffect(() => {
    const q = query.trim()
    if (place || q.length < 2) {
      setSuggestions([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/preview/places/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setSuggestions(data.suggestions ?? [])
        setOpen(true)
      } catch {
        setSuggestions([])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, place])

  async function pick(s: Suggestion) {
    setQuery(s.description)
    setOpen(false)
    setSuggestions([])
    setLoadingPlace(true)
    setPlaceError(null)
    try {
      const res = await fetch(`/api/preview/places/select?placeId=${encodeURIComponent(s.place_id)}`)
      const data = await res.json()
      if (data.error || !data.place) {
        setPlaceError("Couldn't pull that listing. You can still enter details by hand.")
      } else {
        setPlace(data.place as Place)
        setComps((data.competitors ?? []) as Competitor[])
      }
    } catch {
      setPlaceError("Lookup failed. You can continue and enter details by hand.")
    } finally {
      setLoadingPlace(false)
    }
  }

  function clearPlace() {
    setPlace(null)
    setComps([])
    setQuery("")
    setPlaceError(null)
  }

  const next = () => setStep((s) => Math.min(TOTAL - 1, s + 1))
  const back = () => setStep((s) => Math.max(0, s - 1))
  const removeComp = (n: string) => setComps((cs) => cs.filter((c) => c.name !== n))
  const addComp = () => {
    const n = newComp.trim()
    if (!n) return
    setComps((cs) => (cs.some((c) => c.name === n) ? cs : [...cs, { name: n, meta: "Added by you", why: "You added this competitor" }]))
    setNewComp("")
    setAdding(false)
  }
  const toggleGoal = (id: string) => setGoals((g) => ({ ...g, [id]: !g[id] }))

  const restaurantName = place?.name || query.trim()
  const rail = RAIL[step] ?? RAIL[RAIL.length - 1]

  return (
    <div className="ob">
      <div className="ob-canvas" aria-hidden="true" />

      <header className="ob-topbar">
        <span className="ob-brand">
          <span className="ob-mark"><IconBrandT /></span>
          <span className="ob-wordmark">Ticket</span>
        </span>
        <span className="ob-steplabel">{step < TOTAL - 1 ? `Step ${step + 1} of ${TOTAL - 1}` : "All set"}</span>
      </header>

      <div className="ob-split">
        <aside className="ob-rail">
          <div className="ob-rail-head">
            <span className="ob-brand">
              <span className="ob-mark"><IconBrandT /></span>
              <span className="ob-wordmark">Ticket</span>
            </span>
            <div>
              <span className="ob-kicker">{rail.kicker}</span>
              <h1 className="ob-h">{rail.head}</h1>
              <p className="ob-sub">{rail.sub}</p>
            </div>
            <ol className="ob-stepper" aria-label="Setup progress">
              {STEP_NAMES.map((name, i) => {
                const state = i < step ? "is-done" : i === step ? "is-current" : ""
                return (
                  <li key={name} className={state} aria-current={i === step ? "step" : undefined}>
                    <span className="ob-step-dot">{i < step ? <IconCheck /> : i + 1}</span>
                    <span className="ob-step-name">{name}</span>
                  </li>
                )
              })}
            </ol>
          </div>
          <div className="ob-accent">
            <span className="ob-accent-ic"><IconSpark /></span>
            <div className="ob-accent-body">
              <h5>A daily brief, built for you</h5>
              <p>Competitor moves, demand swings, and reputation shifts — ranked, with the play to make.</p>
            </div>
          </div>
        </aside>

        <main className="ob-stage">
          <section className="ob-panel" key={step} aria-live="polite">
            <div className="ob-mobile-head">
              <span className="ob-kicker">{rail.kicker}</span>
              <h1 className="ob-h">{rail.head}</h1>
              <p className="ob-sub">{rail.sub}</p>
              <div className="ob-progress" aria-hidden="true">
                {Array.from({ length: TOTAL }).map((_, i) => (
                  <i key={i} className={i < step ? "done" : i === step ? "current" : ""} />
                ))}
              </div>
            </div>

            {step === 0 ? (
              <>
                <span className="ob-panel-eyebrow">Find your restaurant</span>
                <h2 className="ob-panel-title">Search for your place</h2>
                <p className="ob-panel-lede">We&apos;ll pull your address, cuisine, price, and the competitors near you from your public listing — automatically.</p>
                <div className="ob-field">
                  <label className="ob-label" htmlFor="ob-rest">Your restaurant</label>
                  {place ? (
                    <div className="ob-selected">
                      <div>
                        <div className="ob-selected__name">{place.name}</div>
                        {place.address ? <div className="ob-selected__addr">{place.address}</div> : null}
                      </div>
                      <button type="button" className="ob-selected__change" onClick={clearPlace}>Change</button>
                    </div>
                  ) : (
                    <div className="ob-ac">
                      <input
                        id="ob-rest"
                        className="ob-input ob-input--lg"
                        value={query}
                        autoComplete="off"
                        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
                        onFocus={() => suggestions.length && setOpen(true)}
                        placeholder="Start typing your restaurant name…"
                      />
                      {open && suggestions.length ? (
                        <ul className="ob-ac__list">
                          {suggestions.map((s) => (
                            <li key={s.place_id}>
                              <button type="button" className="ob-ac__item" onClick={() => pick(s)}>{s.description}</button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  )}
                  {loadingPlace ? <p className="ob-hint">Pulling your listing…</p> : null}
                  {placeError ? <div className="ob-soon">{placeError}</div> : null}
                </div>
                <div className="ob-nav"><button className="ob-btn ob-btn--act" onClick={next} disabled={!restaurantName || loadingPlace}>Continue<IconArrow /></button></div>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <span className="ob-panel-eyebrow">Confirm details</span>
                <h2 className="ob-panel-title">
                  Does this look right?
                  {place ? <span className="ob-derived"><IconCheck /> auto-filled</span> : null}
                </h2>
                <p className="ob-panel-lede">{place ? "We pulled this from your listing. Fix anything that's off." : "Enter your details below."}</p>
                <div className="ob-grid">
                  <div className="full ob-field"><label className="ob-label">Restaurant</label><input className="ob-input" defaultValue={restaurantName} /></div>
                  <div className="full ob-field"><label className="ob-label">Address</label><input className="ob-input" defaultValue={place?.address ?? ""} placeholder="Street, city, state" /></div>
                  <div className="ob-field"><label className="ob-label">Cuisine</label><input className="ob-input" defaultValue={place?.cuisine ?? ""} placeholder="e.g. Steakhouse" /></div>
                  <div className="ob-field">
                    <label className="ob-label" htmlFor="ob-price">Price</label>
                    <select id="ob-price" className="ob-input ob-select" defaultValue={place?.price || "$$$"}>
                      <option value="$">$ · Budget</option>
                      <option value="$$">$$ · Moderate</option>
                      <option value="$$$">$$$ · Upscale</option>
                      <option value="$$$$">$$$$ · Fine dining</option>
                    </select>
                  </div>
                  <div className="full ob-field"><label className="ob-label">Website</label><input className="ob-input" defaultValue={place?.website ?? ""} placeholder="yourrestaurant.com" /></div>
                  <div className="full ob-field">
                    <label className="ob-label">Hours</label>
                    <HoursEditor />
                  </div>
                </div>
                <div className="ob-nav"><button className="ob-btn ob-btn--ghost" onClick={back}>Back</button><button className="ob-btn ob-btn--act" onClick={next}>Looks good<IconArrow /></button></div>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <span className="ob-panel-eyebrow">Competitors</span>
                <h2 className="ob-panel-title">Here&apos;s who we&apos;d watch</h2>
                <p className="ob-panel-lede">{comps.length ? "Remove any that aren't real competitors, or add your own. Keep at least one and we'll start tracking them." : "Add the competitors you want us to watch. Keep at least one."}</p>
                <div className="ob-comps">
                  {comps.map((c) => (
                    <div className="ob-comp" key={c.name}>
                      <div className="ob-comp__body">
                        <div className="ob-comp__name">{c.name}</div>
                        {c.meta ? <div className="ob-comp__meta">{c.meta}</div> : null}
                        <div className="ob-comp__why"><span className="ob-comp__why-label">Why</span>{c.why}</div>
                      </div>
                      <button className="ob-comp__remove" onClick={() => removeComp(c.name)} aria-label={`Remove ${c.name}`}>Remove</button>
                    </div>
                  ))}
                  {adding ? (
                    <div className="ob-comp ob-comp--add">
                      <input className="ob-input" value={newComp} autoFocus placeholder="Restaurant name…" aria-label="Add a competitor" onChange={(e) => setNewComp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addComp() }} />
                      <button className="ob-btn ob-btn--act ob-btn--sm" onClick={addComp} disabled={!newComp.trim()}>Add</button>
                      <button className="ob-btn ob-btn--ghost ob-btn--sm" onClick={() => { setAdding(false); setNewComp("") }}>Cancel</button>
                    </div>
                  ) : (
                    <button className="ob-add" onClick={() => setAdding(true)}>+ Add a competitor</button>
                  )}
                </div>
                <div className="ob-nav"><button className="ob-btn ob-btn--ghost" onClick={back}>Back</button><button className="ob-btn ob-btn--act" onClick={next} disabled={comps.length < 1}>Track these {comps.length}<IconArrow /></button></div>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <span className="ob-panel-eyebrow">Optional · pick any that apply</span>
                <h2 className="ob-panel-title">Anything you&apos;re focused on?</h2>
                <p className="ob-panel-lede">Choose as many as you like — it just helps us rank what we surface first. You can change these anytime in Settings, or skip for now.</p>
                <div className="ob-goals">
                  {GOALS.map((g) => {
                    const on = !!goals[g.id]
                    return (
                      <button key={g.id} className={`ob-goal${on ? " is-on" : ""}`} onClick={() => toggleGoal(g.id)} aria-pressed={on}>
                        <span className="ob-goal__check" aria-hidden>{on ? <IconCheck /> : null}</span>
                        <span className="ob-goal__text"><b>{g.title}</b><span>{g.sub}</span></span>
                      </button>
                    )
                  })}
                </div>
                <div className="ob-nav">
                  <button className="ob-btn ob-btn--ghost" onClick={back}>Back</button>
                  <button className="ob-btn ob-btn--act" onClick={next}>Continue<IconArrow /></button>
                  <button className="ob-skip" onClick={next}>Skip</button>
                </div>
              </>
            ) : null}

            {step === 4 ? (
              <>
                <span className="ob-panel-eyebrow">You&apos;re set</span>
                <h2 className="ob-panel-title">We&apos;re building your first brief.</h2>
                <p className="ob-panel-lede">We&apos;re gathering {restaurantName ? <b>{restaurantName}</b> : "your"} competitor, demand, and review signals now. Head in and watch it come together — the essentials are ready in a few minutes, and your full first brief is ready within the hour.</p>
                <ul className="ob-status">
                  <li className="ob-status__row is-ready"><span className="ob-status__mark" /><span className="ob-status__label">Competitors found and confirmed</span><span className="ob-status__when">Ready now</span></li>
                  <li className="ob-status__row is-doing"><span className="ob-status__mark" /><span className="ob-status__label">Reading local demand — events, weather, foot traffic</span><span className="ob-status__when">A few minutes</span></li>
                  <li className="ob-status__row is-queued"><span className="ob-status__mark" /><span className="ob-status__label">Analyzing reviews and competitor activity</span><span className="ob-status__when">Within the hour</span></li>
                </ul>
                <div className="ob-notify">
                  <div className="ob-label">Tell me when it&apos;s ready</div>
                  <label className="ob-notify__opt"><input type="checkbox" defaultChecked /> <span>Email me when my first brief is ready</span></label>
                  <label className="ob-notify__opt"><input type="checkbox" /> <span>Browser notification</span></label>
                </div>
                <div className="ob-soon">Processing timing + notifications are scaffolded here — they wire up with the production pipeline.</div>
                <div className="ob-nav"><Link className="ob-btn ob-btn--act" href="/preview/today">Go to your brief<IconArrow /></Link></div>
              </>
            ) : null}
          </section>
        </main>
      </div>
    </div>
  )
}
