# Image-analysis brief — is it real, is it generic, keep the model? (2026-06-26)

You asked me to verify the competitive insights that rest on **image analysis of social feeds and menus** —
is it actually happening, are we still getting generic trash, and should we keep the model. Verified against
the code AND live prod data (triodvdspdsuudooyura). Short version: **the social image analysis is real and
genuinely good now — the prior fix landed. The remaining "generic" smell is architectural, in one specific
layer, not the model.**

## 1. Is it actually happening?

| Surface | Vision? | Model | Live evidence |
|---|---|---|---|
| **Competitor + own SOCIAL feeds** | ✅ Yes | `gemini-2.5-flash` | `visualAnalysis` present on ~half of media posts: **596/1240 images, 424/864 reels, 141/279 carousels** analyzed. Platform is correctly set (IG 2182 / FB 578 / TikTok 240 — the "undefined post image" risk is NOT happening). |
| **Google Places photos** | ✅ Yes | `gemini-2.5-flash` | 172 competitor photos analyzed (newest 06-23). |
| **MENUS** | ❌ No image vision | `gemini-2.5-pro` + Google Search (text), + Firecrawl scrape | Menus are read as TEXT (web scrape + grounded search), not by looking at a menu photo. |

So: social-feed image analysis is live and broad. Menu *image* analysis is **not** a thing — menus come from
text scraping + a grounded Gemini search. (Google Places photos tagged `menu_board` are the only place a menu
image is ever OCR'd, and that path doesn't feed the menu comparison.)

## 2. Are we still getting generic trash? — Nuanced: NO at the source, YES in one layer.

**The social vision OUTPUT itself is rich and competitive — NOT generic.** Real samples from prod read
competitor promos verbatim and characterize their content strategy:
- OCR'd deals: *"$5 Boots & Pints of Modelo, keep the glass"*, *"$6 Margaritas, $3 Well Tequila Shots"*.
- `brandSignals` (logo visible, on-brand consistency), `contentCategory`, `foodPresentation` (plating/portion/
  vibrancy), `atmosphereSignals` (energy/crowd/time), `peoplePresent` / `ownerOrStaffPresent` /
  `steamOrMotion` / `trendingSound` (the highest-signal F&B cues).

**This rich data flows WELL into the social-counter SKILL** → the specific competitive plays we see in live
briefs (*"Reels are the only format winning locally — start this week"*, *"Get on Instagram with a crew
Reel"*). That's the system working as intended. The **P12 fix** (a dedicated social-counter skill that reads
per-post anatomy) is what fixed the original genericness — and it held.

**Where "generic" still leaks (the real finding):**
1. **The 12 deterministic visual-insight RULES (`visual-insights.ts`) read only aggregate SCORES**, not the
   rich per-image content. So they emit titles like *"Competitor's photos are significantly higher quality"* —
   true but generic — even though the data to say *what* (e.g. "professional lighting in 7/10 posts, wagyu
   close-ups") is sitting right there, unused. Only ONE of the 12 rules (`competitor_promo_blitz`) actually
   reads the specific content.
2. **The Google Places photo tagger uses a weak, persona-less prompt** (just tags + staging/lighting) → the
   bland `["burger","fries","wooden table","casual atmosphere"]` output. Lower stakes (random Places uploads),
   but it's the one that most reads as "trash."

## 3. Should we keep the model? — YES.

`gemini-2.5-flash` is the right call for the social tagger: structured single-image classification into a
fixed JSON schema is exactly Flash's lane (fast, cheap), and **the output quality proves it's working** — the
rich, accurate samples above are Flash's output. Pro's extra reasoning would be wasted here (and Pro is
already used where it belongs — the grounded menu *search*). **The bottleneck is not the model; it's how the
output is consumed.** No model change recommended.

## 4. Coverage gap (real, fixable)

Only ~48-51% of media posts get analyzed per run, because of (a) an inner cap of **10 posts/profile/run**, and
(b) a gate that skips any post whose image wasn't persisted to Supabase Storage (expired CDN URLs). Videos are
analyzed least (90/516). Not zero — but a competitor with 50 posts has gaps. Raising the cap lifts coverage at
a cost/latency tradeoff (more vision calls per run).

## 5. Recommendations (none shipped tonight — your call; in the backlog)

| # | Fix | Leverage | Risk |
|---|---|---|---|
| 1 | **Surface the specific Gemini content in the visual RULES, not just scores** — have `food_photography_gap`/`visual_quality_gap`/`behind_scenes` cite the actual subcategories, lighting patterns, and the unused `ownerOrStaffPresent`/`steamOrMotion` fields. Kills the generic titles. | **HIGH** — directly fixes the "generic" smell | Low-med (changes insight copy/evidence) |
| 2 | Verify the social-counter knowledge playbook tells the model to weave the visual anatomy into `creativeDirection` (the plays look specific already, so likely fine — confirm). | Med | Low |
| 3 | Raise the 10-post/profile cap and/or harden the Storage-persist gate to lift coverage. | Med | Low code, but a cost/latency lever (your call) |
| 4 | Add real menu-board OCR comparison (Places photos already OCR `menu_board`; feed that into the menu rules). | Med | Med |

**Bottom line for you:** the thing you were worried about — generic image insights — is largely solved at the
source and in the skill that writes the plays. What's left is a deterministic-rules layer that's lazy about
using the good data it already has (Fix 1), and a coverage cap. Both are improvements, not rescues. The model
is right.
