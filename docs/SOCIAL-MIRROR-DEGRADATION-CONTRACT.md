# Social image mirror: the degradation contract

ALT-666, item 4. Written 2026-08-19.

Post images do not come from the platform CDN at read time: CDN URLs expire within hours, so the
pipeline downloads each image once and mirrors it into the `social-media` Supabase Storage bucket
(`lib/social/storage.ts`). Everything downstream reads the mirrored copy.

That means there are two independent ways to lose images, and they need different answers:

| Failure | What it looks like | Who notices |
| --- | --- | --- |
| A few images fail | 403 on an expired URL, one bad content-type | Nobody, correctly |
| The mirror collapses | Every attempt in a run fails | The health verdict, same day |

The reason this document exists is that we previously had no answer to either. On 2026-07-24 the
storage public-URL host changed to `auth.getticket.ai` and six `includes("supabase")` predicates
stopped recognising a correctly mirrored image. Every layer degraded politely and independently, so
the product simply looked like it had nothing to say, for three and a half weeks.

## What each surface does when an image is missing

This is current, verified behaviour, not an aspiration.

**Competitors / proof surfaces** (`app/(dashboard)/proof-data.ts`). A post whose image is not
mirrored renders with `imageUrl: null`. The post itself still appears: text, engagement counts, and
timestamp are real data and are shown. We never render a broken `<img>`, and we never point at the
raw CDN URL as a fallback: it would 403 within hours and would leak the provider's hostname to the
operator, which our own standing rule forbids.

**The vision read** (`lib/social/visual-analysis.ts`). Only mirrored posts are analysed, and a post
that was skipped is not marked as analysed, so the next run retries it. This is a **retry, not a
permanent skip**: nothing writes a negative result, so an image mirrored on a later day gets its
read then. That is the right shape and no change is needed.

**Briefs.** A post with no visual analysis contributes no visual claim. The engagement signal still
counts. We do not infer content from the caption alone and present it as a read of the image.

**The operator.** Nothing is said. This is the gap, and it is the one genuinely open question below.

## The rules

1. **Honest absence, never a fabricated read.** If we could not see the image, we do not describe
   it. This already holds everywhere and must not be relaxed for coverage.
2. **Never fall back to the raw CDN URL.** It expires, and it names the provider.
3. **A metric may not be derived from the same predicate as the behaviour it measures.** This is the
   rule the 2026-07 outage was created by. Mirror outcomes are counted at the mirror
   (`persistPostImages` returns a `MirrorTally`) and are never recomputed by inspecting a URL.
   `isMirroredMediaUrl` decides *behaviour* and is correct for that; it must never again be the
   basis of a *count*.
4. **Page on collapse, not on images.** `mirrorCollapsedRuns >= 2` escalates the pipeline verdict to
   degraded. A run counts as collapsed when it attempted at least 8 images and mirrored none. Both
   numbers are sized against prod: a snapshot carries a median of 25 media-bearing posts, and there
   are ~9 social runs per 26h window, so a real fleet-wide break clears the bar immediately while
   one location with an unreachable CDN does not.
5. **"Not measured" is not "healthy."** A run with no tally is excluded from the rate rather than
   scored as zero. The `/admin/health` tile shows `—  not measured yet` rather than a reassuring
   100%.

## Open, needs a product decision

**Do we ever tell the operator that a signal is temporarily unavailable, rather than empty?**

Today an empty images grid is indistinguishable from "this competitor posts no photos". Bryan's
standing rule cuts both ways here: an empty state that implies there was nothing to find is
dishonest, but a caveat banner on a surface that is usually fine is noise and reads as a product
apologising for itself.

The cheap version, if we want it: the health verdict already knows when the mirror has collapsed, so
a surface could say "photos are temporarily unavailable" only during a known collapse, and say
nothing the rest of the time. That is a real product decision about tone, not a bug fix, so it is
left to Bryan and noted on ALT-666 rather than guessed at here.
