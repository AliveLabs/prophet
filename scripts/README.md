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

Examples:

```bash
# 7-day window (default)
npm run insight -- "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080"

# 30-day window with organization
npm run insight -- --org "Joe's Brands" "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080" --time 30d

# 1-day window
npm run insight -- "Local Bistro" "restaurant" "123 Main St, Dallas, TX" --time 1d
```

**Save full JSON report**

Set `OUTPUT_JSON_PATH` to write the full insight response to a file:

```bash
OUTPUT_JSON_PATH=./report.json npm run insight -- "Joe's Cafe" "coffee shop" "300 W Campbell Rd, Richardson, TX 75080"
```
