"use client"

// Step-through onboarding (Phase 5 polish). Design intent: ask the FEW must-haves,
// derive the rest. One real input (find your restaurant via your public listing)
// auto-pulls name/address/cuisine/hours; competitors are auto-discovered and you
// add/remove them (with WHY each was picked); priorities are an optional multi-select
// you can revisit in Settings; the end sets an HONEST processing state (partial
// results now, full brief within the hour) with notify options — no "tomorrow morning".
// Live integrations (Places search, real discovery, real processing/alerts) are noted
// as not-wired; this is the scaffold + the question set.

import { useState } from "react"
import Link from "next/link"

type Competitor = { name: string; meta: string; why: string }

const DISCOVERED: Competitor[] = [
  { name: "Ginya Izakaya", meta: "Japanese · 0.4 mi · ★ 4.5", why: "Same cuisine, closest to you" },
  { name: "O-Ku", meta: "Sushi · 0.8 mi · ★ 4.6", why: "Overlapping menu and price tier" },
  { name: "Bachi Box", meta: "Japanese · 1.2 mi · ★ 4.3", why: "Competes for your search terms" },
  { name: "Gyu-kaku Japanese BBQ", meta: "BBQ · 1.5 mi · ★ 4.4", why: "Same grill-at-table occasion" },
  { name: "Chirori - Omakase & Sushi", meta: "Omakase · 1.1 mi · ★ 4.7", why: "Premium positioning, shared audience" },
]
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
  const [name, setName] = useState("Wagyu House Atlanta")
  const [comps, setComps] = useState<Competitor[]>(DISCOVERED)
  const [adding, setAdding] = useState(false)
  const [newComp, setNewComp] = useState("")
  const [goals, setGoals] = useState<Record<string, boolean>>({})

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
              <input id="ob-rest" className="ob-input ob-input--lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Start typing your restaurant name…" />
              <p className="ob-hint">We use your Google listing to get your address, cuisine, hours, and photos automatically.</p>
            </div>
            <div className="ob-soon">Live place search isn&apos;t wired in this preview — type a name and continue.</div>
            <div className="ob-nav"><button className="ob-btn" onClick={next} disabled={!name.trim()}>Continue</button></div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <span className="ob-kicker">Step 2 · mostly done for you</span>
            <h1 className="ob-h">Does this look right?</h1>
            <p className="ob-sub">We pulled this from your listing<span className="ob-derived">✓ auto-filled</span>. Fix anything that&apos;s off.</p>
            <div className="ob-grid">
              <div className="full"><label className="ob-label">Restaurant</label><input className="ob-input" defaultValue={name} /></div>
              <div className="full"><label className="ob-label">Address</label><input className="ob-input" defaultValue="1100 Howell Mill Rd NW, Atlanta, GA 30318" /></div>
              <div><label className="ob-label">Cuisine</label><input className="ob-input" defaultValue="Steakhouse · Japanese" /></div>
              <div>
                <label className="ob-label" htmlFor="ob-price">Price</label>
                <select id="ob-price" className="ob-input ob-select" defaultValue="$$$">
                  <option value="$">$ · Budget</option>
                  <option value="$$">$$ · Moderate</option>
                  <option value="$$$">$$$ · Upscale</option>
                  <option value="$$$$">$$$$ · Fine dining</option>
                </select>
              </div>
              <div className="full"><label className="ob-label">Website</label><input className="ob-input" defaultValue="wagyuhouseatl.com" /></div>
              <div className="full">
                <label className="ob-label">Hours</label>
                <HoursEditor />
              </div>
            </div>
            <div className="ob-soon">Auto-fill from the live listing isn&apos;t wired — values shown as an example of what we derive.</div>
            <div className="ob-nav"><button className="ob-btn--ghost ob-btn" onClick={back}>Back</button><button className="ob-btn" onClick={next}>Looks good</button></div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <span className="ob-kicker">Step 3 · found for you</span>
            <h1 className="ob-h">Here&apos;s who we&apos;d watch.</h1>
            <p className="ob-sub">We found these nearby, similar spots automatically — each with why we picked it. Remove any that aren&apos;t real competitors, or add your own. Keep at least one and we&apos;ll start tracking them.</p>
            <div className="ob-comps">
              {comps.map((c) => (
                <div className="ob-comp" key={c.name}>
                  <div className="ob-comp__body">
                    <div className="ob-comp__name">{c.name}</div>
                    <div className="ob-comp__meta">{c.meta}</div>
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
            <div className="ob-soon">Live competitor discovery isn&apos;t wired — these are real nearby spots shown as the confirm step.</div>
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
            <p className="ob-sub">We&apos;re gathering your competitor, demand, and review signals now. Head in and watch it come together — the essentials are ready in a few minutes, and your full first brief is ready within the hour.</p>
            <ul className="ob-status">
              <li className="ob-status__row is-ready"><span className="ob-status__mark" /><span className="ob-status__label">Competitors found and confirmed</span><span className="ob-status__when">Ready now</span></li>
              <li className="ob-status__row is-doing"><span className="ob-status__mark" /><span className="ob-status__label">Reading local demand — events, weather, foot traffic</span><span className="ob-status__when">A few minutes</span></li>
              <li className="ob-status__row is-queued"><span className="ob-status__mark" /><span className="ob-status__label">Analyzing reviews and competitor activity</span><span className="ob-status__when">Within the hour</span></li>
            </ul>
            <div className="ob-notify">
              <div className="ob-label">Tell me when it&apos;s ready</div>
              <label className="ob-notify__opt"><input type="checkbox" defaultChecked /> <span>Email me at anand@alivemethod.com</span></label>
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
