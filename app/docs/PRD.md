# Prophet — Competitive Intelligence Platform for Local Businesses
**Merged Master Product Requirements Document (AI IDE / Cursor Optimized)**  
**Version:** 1.0 (Merged)  
**Date:** January 27, 2026  
**Primary stack:** Next.js 16+ (App Router) • Supabase (Postgres + Auth + RLS + Edge Functions) • Shadcn UI • Tailwind

---

## 0. Purpose, audience, and “single source of truth”
This is the **one PRD** to build Prophet MVP → V1.

**Audience:** internal engineering + AI IDEs (Cursor, etc.).  
**Rule:** If other docs disagree, follow **this** PRD.

### 0.1 AI IDE global constraints (apply everywhere)
- **Server-first**: default to Server Components; use Client Components only for interactive UI.
- Use **Supabase SSR** helpers for all server-side data access; do not use raw client in server code.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.
- **RLS on all tables**; assume multi-tenant from day one.
- Background work must be **idempotent** and **retry-safe**.

### 0.2 Standard mutation return shape
All server actions/handlers should return:
```ts
type ActionResult<T> = {
  ok: boolean;
  data?: T;
  message?: string;
  errors?: unknown;
}
```

---

## 1. Decision log (P0 — locked for the merged PRD)
1. **Tenant term:** **Organization** (older docs: “workspace”).  
2. **Scheduling & background work:** **Supabase `pg_cron` → `pgmq` queue → Edge Function workers**.  
3. **Snapshot storage:** **Hybrid** — stable top-level columns + `raw_data JSONB` + `diff_hash`.  
4. **Insight generation:** **Deterministic diff + rules** produce structured insight facts and confidence; LLMs only add narrative/recommendations.

---

## 2. Executive summary
### 2.1 Product vision
Prophet is a competitive intelligence platform for local businesses (starting with restaurants) that delivers:
- Automated competitor discovery
- Daily competitor snapshots
- Actionable insights and recommendations

### 2.2 Scope philosophy: awareness over attribution
Prophet reports observable changes and patterns without claiming causality.

---

## 3. Goals, non-goals, success metrics
### 3.1 Goals (MVP → V1)
- Multi-tenant SaaS (RLS) with teams and roles
- “Set and forget” daily monitoring for 1–few locations
- Competitor discovery that feels smart (relevance scoring + explainability)
- Insight feed with confidence tags and recommended actions
- Subscription billing + tier-based limits

### 3.2 Non-goals (MVP/V1)
- Real-time monitoring
- Grey-hat scraping or attempting access to protected ad accounts
- Full BI suite (MVP prioritizes insight feed over complex dashboards)

### 3.3 Success metrics
- Activation: orgs that add 1 location + approve ≥5 competitors within 24h
- Reliability: daily snapshot completion rate; job failure and retry rates
- Engagement: insights viewed per week; “useful” feedback
- Revenue: upgrades Free→Starter→Pro

---

## 4. Personas & key jobs-to-be-done
- **Owner/Operator:** “What changed nearby and what should I do today?”
- **Marketing Manager:** “Track competitor reputation and changes; plan responses.”
- **Multi-location SMB/Agency:** “Scale monitoring and apply repeatable playbooks.”

---

## 5. Scope: MVP and V1
### 5.1 MVP (must ship)
**Account & tenant**
- Auth (email/password and/or OAuth)
- Organization create + invite team members
- Roles: owner/admin/member

**Location setup**
- Add a location (name, address, geo lat/lng, timezone)
- Optional: link “your business place id” if provider supports

**Competitor discovery & management**
- Auto-discover competitors near location
- Approve/ignore competitors
- Manual add competitor by place id / URL / name+address search

**Daily monitoring**
- Daily snapshots per competitor
- Normalization + diffing
- Deterministic insight generation

**Insight feed UI**
- List, filter, mark read/dismiss
- Confidence + severity badges
- Evidence section (“what changed”)

**Billing**
- Stripe subscription (free + paid tiers)
- Tier limits (locations, competitors, retention)

**Ops**
- Job tracking, retries, rate-limit handling
- Basic monitoring and logs

### 5.2 V1 (next)
- “Ask Prophet” natural language chat grounded in stored data
- Email alerts / digests
- Improved discovery scoring
- Additional providers behind adapters (Yelp/Serp features)
- Trend insights (T-7 comparisons), weekly summaries

---

## 6. Core user journeys
### 6.1 First-time setup
1) Sign up → create organization  
2) Add location (geo + timezone)  
3) Competitor discovery returns list → user approves competitors  
4) System runs baseline snapshot  
5) Next day: insights appear in feed

### 6.2 Ongoing usage
- Open insight feed → view “what changed” → take action → optionally ask Prophet for suggestions.

---

## 7. Architecture (authoritative)
### 7.1 High-level components
- **Next.js 16+ App Router**: UI, server actions, SSR auth/session checks
- **Supabase Postgres**: source of truth + RLS
- **Supabase Auth**: users and sessions
- **Supabase Edge Functions**: background workers and provider adapters
- **pg_cron**: schedule orchestrator
- **pgmq**: queue for fan-out + retries + controlled concurrency
- **LLM Gateway (optional in MVP)**: LiteLLM recommended for model routing

### 7.2 Background jobs (pg_cron → pgmq → worker)
**Daily schedule (per location):**
- `orchestrator_daily`:
  - enqueue `fetch_snapshot` jobs for each active competitor
  - enqueue `generate_insights` jobs after snapshot completion
  - optionally enqueue `discover_competitors` refresh weekly (configurable)

**Idempotency rules**
- A job must be safe to run twice without duplicating rows.
- Snapshots are unique on `(competitor_id, date_key)`.
- Insights are unique on `(location_id, competitor_id, date_key, insight_type)`.

### 7.3 Provider Abstraction Layer (PAL)
All external data ingestion goes through adapters.

**Provider interface**
- discover competitors near a geo point
- fetch snapshot for a competitor entity id
- normalize to internal snapshot payload schema
- optional health checks and rate-limit awareness

---

## 8. Data sources & compliance
### 8.1 MVP provider
- **DataForSEO** for GBP/local pack/review signals.

### 8.2 V1+ providers
- SerpApi (Yelp discovery)
- Additional SERP/places providers as needed

### 8.3 Compliance & guardrails
- Use official APIs/licensed providers.
- Do not attempt access to protected ad accounts.
- Avoid storing sensitive personal data; store only business listing signals.

---

## 9. Data model (canonical)
### 9.1 Core tables
**Tenancy**
- `organizations`
- `profiles`
- `organization_members`

**Domain**
- `locations`
- `competitors`
- `snapshots`
- `insights`

**Ops**
- `job_runs` (recommended)
- Optionally: `usage_events` for limit enforcement

### 9.2 Canonical SQL schema (baseline)
> Modify only here + migrations.

```sql
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  subscription_tier text not null default 'free' check (subscription_tier in ('free','starter','pro','agency')),
  stripe_customer_id text,
  stripe_subscription_id text,
  billing_email text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  current_organization_id uuid references organizations(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text default 'US',
  geo_lat double precision,
  geo_lng double precision,
  timezone text not null default 'America/New_York',
  primary_place_id text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_org on locations(organization_id);

create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  provider text not null default 'dataforseo',
  provider_entity_id text not null,
  name text,
  category text,
  address text,
  phone text,
  website text,
  relevance_score numeric,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_entity_id, location_id)
);

create index if not exists idx_competitors_location on competitors(location_id);
create index if not exists idx_competitors_active on competitors(is_active);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  captured_at timestamptz not null,
  date_key date not null,
  provider text not null,
  raw_data jsonb not null,
  diff_hash text not null,
  created_at timestamptz not null default now(),
  unique (competitor_id, date_key)
);

create index if not exists idx_snapshots_competitor_date on snapshots(competitor_id, date_key);

create table if not exists insights (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references locations(id) on delete cascade,
  competitor_id uuid references competitors(id) on delete set null,
  date_key date not null,
  insight_type text not null,
  title text not null,
  summary text not null,
  confidence text not null check (confidence in ('high','medium','low')),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  evidence jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (status in ('new','read','dismissed')),
  created_at timestamptz not null default now(),
  unique (location_id, competitor_id, date_key, insight_type)
);

create index if not exists idx_insights_location_date on insights(location_id, date_key);
```

### 9.3 Snapshot payload schema (internal, versioned)
Store normalized payloads with an internal schema that supports diffing:
- include `version`
- include `timestamp`
- group by domains (profile, reviews, attributes, etc.)
- keep provider raw as `raw` or `source_raw` only if needed

---

## 10. RLS strategy (canonical)
### 10.1 Core rule
A user can access rows if they are a member of the owning organization.

### 10.2 Policy patterns
- `organizations`: members can read
- `locations`: members can read; owner/admin can mutate
- `competitors`, `snapshots`, `insights`: join through `locations` → org

### 10.3 Example policies (starter)
```sql
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table locations enable row level security;
alter table competitors enable row level security;
alter table snapshots enable row level security;
alter table insights enable row level security;

create policy "org members can read org"
on organizations for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = organizations.id and m.user_id = auth.uid()
  )
);

create policy "org members can read locations"
on locations for select
using (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id and m.user_id = auth.uid()
  )
);

create policy "org admins can insert locations"
on locations for insert
with check (
  exists (
    select 1 from organization_members m
    where m.organization_id = locations.organization_id
      and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);
```

---

## 11. Competitor discovery
### 11.1 Inputs
- Location geo lat/lng + radius (default 3–5 miles; configurable)
- Optional category filters (restaurant type, etc.)
- Optional query seed (“pizza”, “thai”, “coffee”)

### 11.2 Output
A list of candidates with:
- provider_entity_id (place id)
- name, category, distance
- relevance_score
- explanation (top factors)

### 11.3 MVP scoring heuristic (explainable)
Start with a deterministic score:
- distance weight (closer = higher)
- category similarity (same primary category = higher)
- rating + review_count (bounded; avoid dominance)
- “open now” / business hours overlap (optional)
Expose explanation as a simple array of factors.

---

## 12. Snapshots, diffing, and insight engine (deterministic)
### 12.1 Snapshot frequency
- MVP: daily only
- V1: daily + weekly trend comparisons

### 12.2 Normalization rules
- canonicalize numbers, hours formats, review text whitespace
- remove provider noise and ordering differences
- compute `diff_hash` from critical fields only

### 12.3 Diff algorithm
Compare current snapshot to:
- `T-1` for daily changes
- `T-7` for weekly trend insights (V1)

Noise thresholds (example)
- rating delta < 0.05 → ignore (configurable)
- review_count delta < 2 → ignore (configurable)

### 12.4 Confidence modeling (deterministic)
- High: direct structured change (rating, hours, review count)
- Medium: derived or partially ambiguous
- Low: weak signals or incomplete snapshots

### 12.5 MVP insight types
- Rating drop/spike
- Review velocity spike (count delta)
- Hours changed
- New review theme (LLM-assisted; evidence must include review ids/text snippets)

---

## 13. LLM features (V1)
### 13.1 Ask Prophet chat
Ground answers only in:
- insights
- snapshot structured fields
- recent reviews stored in snapshots (if stored)

Guardrails:
- cite evidence fields, never invent facts
- avoid causal claims

---

## 14. API surface
### 14.1 Next.js routes (UI-facing)
- `POST /api/stripe/webhook` — Stripe events
- `POST /api/ai/chat` (V1) — natural language queries

### 14.2 Server Actions (recommended for app CRUD)
- create org, invite members
- create location, approve competitor, dismiss insight

### 14.3 Edge Functions (workers)
- `orchestrator_daily` — invoked by pg_cron
- `job_worker` — consumes pgmq; handlers:
  - `discover_competitors`
  - `fetch_snapshot`
  - `generate_insights`

### 14.4 Queue message schema (pgmq)
```json
{
  "job_type": "fetch_snapshot",
  "organization_id": "uuid",
  "location_id": "uuid",
  "competitor_id": "uuid",
  "date_key": "YYYY-MM-DD",
  "attempt": 1,
  "trace_id": "uuid"
}
```

---

## 15. UI/UX requirements (MVP)
### 15.1 Routes
- `(auth)/login`, `(auth)/signup`
- `/onboarding`
- `(dashboard)/home`
- `(dashboard)/insights`
- `(dashboard)/competitors`
- `(dashboard)/settings` (billing, team)

### 15.2 Insight feed UI requirements
- Filters: date range (last 7/30), confidence, severity, competitor
- Insight card includes:
  - title + summary
  - confidence badge
  - evidence accordion (before/after deltas)
  - recommended actions list
  - buttons: mark read / dismiss

---

## 16. Billing (Stripe) — MVP
### 16.1 Plans
- Free / Starter / Pro / Agency

### 16.2 Stored fields
Store on `organizations`:
- `subscription_tier`
- `stripe_customer_id`
- `stripe_subscription_id`

### 16.3 Webhook requirements
Handle at minimum:
- subscription created/updated/canceled
- invoice paid/failed

### 16.4 Enforcement
Enforce on create actions:
- max locations
- max competitors per location
- retention window

---

## 17. Operational excellence
### 17.1 Rate limits
Queue-based fan-out is the primary mitigation:
- cap worker concurrency
- exponential backoff on provider rate-limit responses

### 17.2 Data retention
- Implement retention cleanup policy (e.g., free tier 30 days)
- Avoid storing unnecessary HTML; store extracted signals only

### 17.3 Monitoring
- Track job starts/ends/errors
- Alert on repeated failures by job_type/provider

---

## 18. Repository structure (AI IDE friendly)
> Baseline (adapt as needed):

```
/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── login/actions.ts
│   │   ├── signup/page.tsx
│   │   └── signup/actions.ts
│   ├── onboarding/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── home/page.tsx
│   │   ├── insights/page.tsx
│   │   ├── competitors/page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── billing/page.tsx
│   │       └── team/page.tsx
│   └── api/
│       ├── stripe/webhook/route.ts
│       └── ai/chat/route.ts
├── components/
│   ├── ui/                 # Shadcn
│   └── insight-card.tsx
├── lib/
│   ├── supabase/
│   │   ├── server.ts
│   │   └── client.ts
│   ├── providers/          # PAL adapters
│   ├── insights/           # diff + rules
│   ├── billing/
│   └── ai/
│       └── prompts/
├── supabase/
│   ├── migrations/
│   └── functions/          # Edge functions (orchestrator, worker)
└── types/
    ├── database.types.ts
    └── prophet.types.ts
```

---

## 19. Implementation plan (phased, AI IDE friendly)
### Phase 1 — Foundation
- Initialize Next.js 16 + TS
- Set up Supabase project + local dev
- Add Shadcn UI + base layout + auth
- Implement organizations + members + profiles migrations + RLS

### Phase 2 — Location management
- location CRUD + onboarding flow
- set current org context in profile/session (server)

### Phase 3 — Competitor discovery
- DataForSEO discovery adapter + relevance scoring
- approve/ignore flows
- manual add

### Phase 4 — Daily snapshots pipeline
- snapshot fetch adapter + normalization + diff_hash
- pg_cron orchestrator + pgmq queue
- edge worker with retries + rate-limit handling

### Phase 5 — Insight engine + feed
- deterministic rules engine
- persist insights + feed UI

### Phase 6 — Billing + gating
- Stripe checkout + webhook
- enforce limits

### Phase 7 — V1 extras
- Ask Prophet chat
- notifications + digests
- trends

---

## 20. Configuration templates (copy/paste)
### 20.1 `.env.local` (minimum)
```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Provider(s)
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
SERPAPI_KEY= # optional

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_STARTER=
STRIPE_PRICE_ID_PRO=
STRIPE_PRICE_ID_AGENCY=

# LLM (optional V1)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
LITELLM_PROXY_URL=
```

---

## 21. Testing strategy
- Unit: normalization + diff engine
- Integration: RLS policy tests (supabase local)
- E2E: Playwright onboarding + insight feed smoke tests
- Snapshot tests for AI prompt builders (string stability)

---

## 22. Open questions (explicit)
- Final competitor scoring formula and weights
- Which menu/price signals are reliable via DataForSEO for the target vertical
- Retention/export requirements for agency users
- Notifications (email only vs SMS) and opt-in UX

---

## Appendix A — Suggested `.cursorrules`
- Enforce Supabase SSR usage only for server
- Default Server Components
- Standard ActionResult return shape
- No secrets in client
- Always add/verify RLS for new tables

---

## Appendix B — Provider interface (TypeScript)
```ts
export type NormalizedSnapshot = {
  version: "1.0";
  timestamp: string; // ISO
  profile?: {
    title?: string;
    rating?: number;
    reviewCount?: number;
    priceLevel?: string;
    address?: string;
    website?: string;
    phone?: string;
  };
  hours?: Record<string, string>;
  recentReviews?: Array<{ id: string; rating: number; text: string; date: string }>;
  attributes?: Record<string, unknown>;
  source_raw?: unknown; // optional, keep minimal
};

export interface Provider {
  name: string;

  fetchCompetitorsNear(input: {
    lat: number; lng: number; radiusMeters: number; query?: string;
  }): Promise<Array<{
    providerEntityId: string;
    name: string;
    category?: string;
    distanceMeters?: number;
    score?: number;
    raw: unknown;
  }>>;

  fetchSnapshot(input: { providerEntityId: string }): Promise<unknown>;
  normalizeSnapshot(raw: unknown): NormalizedSnapshot;
}
```

