# Scripts

## api-playground

Scripts for testing APIs and running the business-insight pipeline (Gemini).

### Setup

1. Go to the api-playground directory:
   ```bash
   cd scripts/api-playground
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your API key:
   ```bash
   GOOGLE_API_KEY=your_key_here
   ```

### Run steps

**Test APIs (quick Gemini call)**

```bash
npm run dev
```

Runs `test-apis.ts` — a simple Gemini generateContent call (e.g. restaurant competitor question).

**Business insight (competitors, events, weather, sentiment)**

```bash
npm run insight -- "<businessName>" "<businessType>" "<address>" [--time 1d|7d|30d]
```

Optional flags:

- `--org "<organizationName>"` — parent company or brand
- `--time 1d|7d|30d` — time window to analyze (default: `7d`)
- `--compact` — use smaller prompt (~2048 token target) for quota testing; same JSON shape, fewer items (up to 5 competitors/events)

Examples:

```bash
# 7-day window (default)
npm run insight -- "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080"

# 30-day window with organization
npm run insight -- --org "Joe's Brands" "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080" --time 30d

# 1-day window
npm run insight -- "Local Bistro" "restaurant" "123 Main St, Dallas, TX" --time 1d

# Compact prompt (~2048 tokens) for quota testing
npm run insight -- --compact "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080"
```

**Save full JSON report**

Set `OUTPUT_JSON_PATH` to write the full insight response to a file:

```bash
OUTPUT_JSON_PATH=./report.json npm run insight -- "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080"
```

### Quota (API limit / “exceeding API key quota”)

The insight script makes **one** Gemini API call per run — there is no loop. Quota errors come from **token volume**: the prompt is large (~1.5–2k input tokens) and the response can be large (default max 4096 output tokens). One run can use ~2k + ~3–4k = ~6k tokens, so free-tier limits (e.g. tokens per minute or per day) can be hit quickly.

To use fewer tokens per request, lower the max output size in `.env`:

```bash
MAX_OUTPUT_TOKENS=2048
```

Then run the insight command as usual. If you still hit limits, wait for the quota window to reset or switch to a paid tier.
