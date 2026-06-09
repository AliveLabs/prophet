"use client"

// Step-through onboarding (Phase 5 polish + Phase 9 real data). The "find your
// restaurant" step is REAL Google Places autocomplete; picking a place prefills the
// confirm step from the live listing and discovers real nearby competitors (each with
// why it was picked). Calls server routes (/api/preview/places/*) so the key stays
// private. Manual entry still works if you don't pick a suggestion. Processing/status +
// notifications at the end are still scaffolded (Phase 9 next).

import { useState, useEffect } from "react"
import Link from "next/link"

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
  { id: "covers", title: "Fill slow nights", sub: "More covers when you're quiet." },
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

  return (
    <div className="ob">
      <div className="ob-top">
        <span className="ob-brand">TICKET</span>
        <span className="ob-steplabel">{step < TOTAL - 1 ? `Step ${step + 1} of ${TOTAL - 1}` : "All set"}</span>
      </div>
      <div className="ob-progress">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <i key={i} className={i < step ? "done" : i === step ? "current" : ""} />
        ))}
      </div>

      <div className="ob-card">
        {step === 0 ? (
          <>
            <span className="ob-kicker">Welcome to Ticket</span>
            <h1 className="ob-h">Let&apos;s find your restaurant.</h1>
            <p className="ob-sub">Search for your place and we&apos;ll pull everything we can from your public listing, so you barely have to type.</p>
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
              <p className="ob-hint">We use your Google listing to get your address, cuisine, price, and the competitors near you, automatically.</p>
              {loadingPlace ? <p className="ob-hint">Pulling your listing…</p> : null}
              {placeError ? <div className="ob-soon">{placeError}</div> : null}
            </div>
            <div className="ob-nav"><button className="ob-btn" onClick={next} disabled={!restaurantName || loadingPlace}>Continue</button></div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <span className="ob-kicker">Step 2 · mostly done for you</span>
            <h1 className="ob-h">Does this look right?</h1>
            <p className="ob-sub">{place ? <>We pulled this from your listing<span className="ob-derived">✓ auto-filled</span>. Fix anything that&apos;s off.</> : "Enter your details below."}</p>
            <div className="ob-grid">
              <div className="full"><label className="ob-label">Restaurant</label><input className="ob-input" defaultValue={restaurantName} /></div>
              <div className="full"><label className="ob-label">Address</label><input className="ob-input" defaultValue={place?.address ?? ""} placeholder="Street, city, state" /></div>
              <div><label className="ob-label">Cuisine</label><input className="ob-input" defaultValue={place?.cuisine ?? ""} placeholder="e.g. Steakhouse" /></div>
              <div>
                <label className="ob-label" htmlFor="ob-price">Price</label>
                <select id="ob-price" className="ob-input ob-select" defaultValue={place?.price || "$$$"}>
                  <option value="$">$ · Budget</option>
                  <option value="$$">$$ · Moderate</option>
                  <option value="$$$">$$$ · Upscale</option>
                  <option value="$$$$">$$$$ · Fine dining</option>
                </select>
              </div>
              <div className="full"><label className="ob-label">Website</label><input className="ob-input" defaultValue={place?.website ?? ""} placeholder="yourrestaurant.com" /></div>
              <div className="full">
                <label className="ob-label">Hours</label>
                <HoursEditor />
              </div>
            </div>
            <div className="ob-nav"><button className="ob-btn--ghost ob-btn" onClick={back}>Back</button><button className="ob-btn" onClick={next}>Looks good</button></div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <span className="ob-kicker">Step 3 · found for you</span>
            <h1 className="ob-h">Here&apos;s who we&apos;d watch.</h1>
            <p className="ob-sub">{comps.length ? <>We found these nearby, similar spots automatically — each with why we picked it. Remove any that aren&apos;t real competitors, or add your own. Keep at least one and we&apos;ll start tracking them.</> : "Add the competitors you want us to watch. Keep at least one."}</p>
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
                  <button className="ob-btn ob-btn--sm" onClick={addComp} disabled={!newComp.trim()}>Add</button>
                  <button className="ob-btn--ghost ob-btn ob-btn--sm" onClick={() => { setAdding(false); setNewComp("") }}>Cancel</button>
                </div>
              ) : (
                <button className="ob-add" onClick={() => setAdding(true)}>+ Add a competitor</button>
              )}
            </div>
            <div className="ob-nav"><button className="ob-btn--ghost ob-btn" onClick={back}>Back</button><button className="ob-btn" onClick={next} disabled={comps.length < 1}>Track these {comps.length}</button></div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <span className="ob-kicker">Optional · pick any that apply</span>
            <h1 className="ob-h">Anything you&apos;re focused on?</h1>
            <p className="ob-sub">Choose as many as you like — it just helps us rank what we surface first. You can change these anytime in Settings, or skip for now.</p>
            <div className="ob-goals">
              {GOALS.map((g) => {
                const on = !!goals[g.id]
                return (
                  <button key={g.id} className={`ob-goal${on ? " is-on" : ""}`} onClick={() => toggleGoal(g.id)} aria-pressed={on}>
                    <span className="ob-goal__check" aria-hidden>{on ? "✓" : ""}</span>
                    <span className="ob-goal__text"><b>{g.title}</b><span>{g.sub}</span></span>
                  </button>
                )
              })}
            </div>
            <div className="ob-nav">
              <button className="ob-btn--ghost ob-btn" onClick={back}>Back</button>
              <button className="ob-btn" onClick={next}>Continue</button>
              <button className="ob-skip" onClick={next}>Skip</button>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <span className="ob-kicker">You&apos;re set</span>
            <h1 className="ob-h">We&apos;re building your first brief.</h1>
            <p className="ob-sub">We&apos;re gathering {restaurantName ? <b>{restaurantName}</b> : "your"} competitor, demand, and review signals now. Head in and watch it come together — the essentials are ready in a few minutes, and your full first brief is ready within the hour.</p>
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
            <div className="ob-nav"><Link className="ob-btn" href="/preview/today">Go to your brief →</Link></div>
          </>
        ) : null}
      </div>
    </div>
  )
}
