# Demo build + onboard runbook

How to stand up a fully-populated demo of a specific restaurant to show a prospect.
(Shipped 2026-06-23 — the create→setup→show flow. See `SESSION-HANDOFF.md`.)

## ⚠️ Timing — build it AHEAD, not live
The data pipeline takes **~5–15 min for the essentials** and up to **30–60 min for a full first brief**;
social data is a separate fetch on top. **Build the demo the night before** (or at least an hour before),
so the dashboard is populated when the prospect is looking at it.

## Steps

1. **Create the demo org.** Admin → Organizations → New (`/admin/organizations/new`). Choose **Demo**, name
   it (e.g. the prospect's restaurant), pick the industry → **Create Org**. It lands on the org's detail page.
   (Owned by you · 365-day clock · no billing · sends no emails.)

2. **Set it up.** On the org page, the banner reads "Demo not set up yet" → click **Set up demo →**. This
   opens the real onboarding wizard scoped to this demo (you'll see an "Admin setup — <name>" bar):
   - **Find the restaurant** — search the prospect's place on Google, pick it.
   - **Confirm details** — name / address / cuisine / website auto-fill; fix anything → **Looks good**
     (this attaches the location to the demo).
   - **Competitors** — auto-discovered nearby; remove wrong ones, add your own, keep at least one →
     **Track these N**.
   - **Monitoring prefs** — optional toggles → Continue (or Skip).
   - **Processing** — the pipeline runs with live per-signal status. When the essentials land (or after
     ~90s) → **Open demo dashboard →**. You're now inside the demo.

3. **Set up social.** In the demo dashboard, open **Social** (left nav). Add the restaurant's Instagram /
   Facebook / TikTok handles (or use **Discover Handles**), then **Fetch Social Data**. Followers,
   engagement, posts, and social insights populate over a few minutes.

4. **Let it bake.** Come back in ~30–60 min — the morning brief plus competitor / demand / review signals
   fill in. Each section has a refresh button if you want to nudge a pull.

5. **To show it.** You're logged in as admin and you OWN the demo, so just switch into it: the org page's
   **Open demo** button, or the account/location switcher at the top of the dashboard. Walk the brief,
   competitors, social, etc. (No impersonation needed — it's your org.)

## Notes
- The org-page banner is state-aware: **Set up** (no location) → **Resume setup** (location, unfinished) →
  **Open demo** (done).
- Demo orgs never expire mid-demo (365-day clock) and send no customer emails.
- Real customers are NOT affected by any of this — they onboard fresh; there is no demo→real conversion.
- ⚠️ **Dry-run before the real demo.** This flow is build/test/review-verified but has NOT been clicked
  end-to-end on prod yet. Build one throwaway demo all the way through today so any runtime issue surfaces
  now, not in front of the prospect.
