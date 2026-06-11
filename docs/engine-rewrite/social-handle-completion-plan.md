# Social-Handle Completion Plan (2026-06-11)

Bryan: drive completion of social profiles — ours and competitors' — so insights and
recommendations stop running on a partial market picture. Born from day-1 findings:
website-scrape discovery alone found ZERO competitor handles for Bush's Forney (chain
branch sites carry no local links), and the original crisis was the opposite failure
(wrong/dead handles locked in: bushscknforney dark 4.4yr, gyukaku wrong city).

**The funnel: more candidate sources → evidence scoring → human confirmation →
continuous re-verification.** Nothing middle-confidence ever flows into collection
unconfirmed; Data365 credits only start after verification.

**Hard budgets (Bryan's constraints):**
- Onboarding own-handle guess adds ≤ ~10s perceived latency, $0 Data365 pre-confirmation
  (SERP ≈ $0.002/query + the Firecrawl scrape we already run). If the guess isn't ready
  in its slot, DEFER — never block onboarding.
- Rich previews (avatar + recent posts) only where data already exists (post-pull) or
  the user explicitly opens a candidate (one profile-info call ≈ 9 credits ≈ half a cent).

---

### Batch 1 — Discovery breadth (the "more candidates" layer)
- ☐ **SERP discovery via DataForSEO** (provider already integrated): `site:instagram.com
  "<name>" <city>` (+ facebook, tiktok) → candidate profile URLs. New
  `lib/social/discover-serp.ts`; feeds the same candidate pool as `discoverFromWebsite`.
  ~$0.002/query, seconds, no new vendor.
- ☐ **Cross-platform bio expansion**: when ONE handle is verified, scrape its bio/links
  (incl. linktree) for sibling platforms — one verified seed completes the set. Extend
  `lib/social/enrich.ts`.
- ☐ **Async Data365 search, rehabilitated as fallback**: the 5-min POST-poll-GET pattern
  was rejected for the INLINE pipeline; run it as a queued `social_discovery` job
  (durable queue handles slow) for entities still candidate-less after scrape+SERP.
  Candidates only — never auto-locks.
- ☐ **Aggregator link scrape** (Yelp/TripAdvisor business pages via Firecrawl) — cheap
  extra candidate source; behind the same scoring gate. (Optional; skip if Batch 1's
  first two close the gap.)

### Batch 2 — Evidence scoring (the trust gate; prevents gyukaku II)
- ☐ **Score model** in `lib/social/verify.ts`: bidirectional link proof (candidate bio →
  business domain = near-certain), bio geography vs address, name similarity, category,
  LIVENESS (newest-post age via existing freshness contract — dormant scores down).
- ☐ **Three bands**: auto-verify (lock + start cadence) / needs-human (queue for Batch 3/4
  UX) / reject. Thresholds in one place, unit-tested.
- ☐ **Additive migration**: `social_profiles.verification` jsonb (score, evidence,
  verified_by: auto|operator, verified_at) + `candidate` state alongside is_verified.
  Provenance surfaces later in the "What we checked" drill.

### Batch 3 — Own handles at onboarding (cheap guess + inline confirm)
- ☐ **Early kick**: the moment the restaurant is confirmed (step 1 → 2 transition,
  org/location just created), fire own-website `discoverFromWebsite` + 2-3 SERP queries
  in the background (server action, results cached on the location). They have ~30-60s
  of competitor-picking ahead — the guess races that, not the user.
- ☐ **Inline confirm UI** (goals step or processing step, whichever the results reach
  first): lightweight text list — "We think this is you: @handle on Instagram —
  Confirm / Not me / Add my handle" + platform link-out for eyeballing. NO Data365
  render. Confirmed → is_verified + verification.verified_by='operator'; corrected →
  manual entry field (paste a URL or type a handle).
- ☐ **The ≤10s rule**: if the guess isn't back when its slot renders, the step shows
  nothing (no spinner, no wait) and the ask rolls into the Batch 4 wizard. Never a
  long round trip at onboarding.

### Batch 4 — "Day-1 questions" wizard (post-first-pull; Bryan's primary surface)
- ☐ **Trigger**: first_run insights job completes → in-app notice (reuse the new-brief
  toast seam + a rail chip): "Your first brief is ready — a few quick questions to
  sharpen it." Also shown on first /home visit while unanswered.
- ☐ **Wizard contents, in order**: (1) own handles still unconfirmed — now RICH cards
  free of charge (avatar + recent post thumbnails from social_snapshots already pulled),
  incl. the honest dormancy line ("@bushscknforney has been quiet since 2022 — is this
  you?"); (2) middle-band competitor candidates — "Is this them?" cards (thumbnails from
  candidate pull if collected, else link-out + one profile-info call on tap, ≈9 credits);
  (3) competitors with zero candidates — paste-a-link (the `manual` discovery_method
  finally gets UI).
- ☐ **On confirm**: write verification, enqueue adhoc social for newly verified handles
  (existing queue mode), answer reflected in coverage next brief.
- ☐ Wizard is dismissible + resumable from Settings ("Complete your market picture").

### Batch 5 — Corporate accounts for chains (the Raising Cane's question)
- ☐ `account_scope: local | corporate` on social_profiles; chain detection (same-domain
  multi-location heuristics / corporate root domain vs branch page).
- ☐ Insights weighting mirrors the events model: corporate accounts = promo/LTO signal
  ("Cane's launched a national LTO") → marketing-relevant, never "the rival down the
  street posted." Dossier labels them distinctly; eval rule guards against false
  local-activity claims from corporate accounts.

### Batch 6 — Completeness loop (drive-to-done + stay-correct)
- ☐ **Market-coverage meter**: "Market picture 78% complete — 2 profiles need a look" on
  the brief rail/Settings; links into the Batch 4 wizard. Honest explanation of WHY
  insights are thinner when incomplete.
- ☐ **Re-verification triggers**: verified handle dormant >90d → re-discovery sweep
  (newer/rebranded account may exist); profile deleted/renamed → flag + requeue.
- ☐ **Provenance in "What we checked"**: per-handle verified-by/when in the drill
  (transparency seam already built in Batch 1 of complete-picture).

### Order + cost rationale
1→2 first (sources + trust gate are the foundation; everything user-facing sits on the
bands). 3 and 4 next (4 is the primary surface; 3 is the cheap head start). 5 unblocks
chain-heavy markets (QSR like Bush's). 6 closes the loop. Recurring cost is dominated by
Data365 cadence pulls, which only START post-verification — discovery itself is
SERP-cents + Firecrawl already in the pipeline.

### Held / discuss
- Whether competitor "Is this them?" confirmations should also be answerable by US
  (admin console) for white-glove onboarding, not just the operator.
- Data365 search quality per platform (TikTok search was the weakest historically) —
  measure before relying on it as the fallback.
