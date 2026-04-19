# Data365 API Investigation & Limitation Analysis

**Date**: March 1, 2026  
**Investigator**: Automated analysis via direct API testing  
**Scope**: Data365 v1.1 REST API — Instagram, Facebook, TikTok endpoints  
**Purpose**: Determine why social media post data is missing or broken for tracked locations and competitors

---

## Executive Summary

**UPDATE (January 31, 2026)**: The root cause of missing post data has been identified and fixed. We were using the wrong API parameter (`load_posts` instead of `load_feed_posts`). Data365 support confirmed this was a parameter naming error on our side, not an API limitation. Trial accounts have no restrictions on post loading. The fix has been applied to both the main client and the Supabase edge function.

**Previous assessment** (now partially invalidated): ~~Data365 is not viable as our primary social media data provider.~~ The 88% failure rate for post data was caused by our incorrect parameter, not by API limitations. Image URL expiration remains a known behavior that requires either immediate download or re-fetching.

---

## Detailed Findings

### 1. Post Data Availability (Critical)

We tested every social profile tracked in Prophet by querying the Data365 posts endpoint directly via `curl`:

| Platform | Handle | Entity | Posts Returned | Profile Data |
|----------|--------|--------|---------------|-------------|
| Instagram | `terillisrestaurant` | Location | **24 posts** | Yes (7,161 followers) |
| Instagram | `starbucks` | Control test | **25 posts** | Yes (17.7M followers) |
| Instagram | `lockwooddistillingco` | Location | **0 posts** | Yes (16,189 followers, 2,138 posts_count) |
| Instagram | `eatdrinknada` | Location | **0 posts** | Yes |
| Instagram | `okuatlanta` | Competitor | **0 posts** | Yes (16,093 followers, 1,337 posts_count) |
| Instagram | `chiroriatlanta` | Competitor | **0 posts** | Yes (9,511 followers, 120 posts_count) |
| Instagram | `gyukakuatlanta` | Competitor | **0 posts** | Yes |
| Instagram | `duecucina` | Competitor | **0 posts** | Yes |
| Instagram | `romasitaliadallas` | Competitor | **0 posts** | Yes |
| Facebook | `TerillisDallas` | Location | **0 posts** | Yes (followers data) |
| Facebook | `lockwooddistillingco` | Location | **0 posts** | Yes (12,000 followers) |
| Facebook | `duecucinaitaliana` | Competitor | **0 posts** | Yes |
| Facebook | `RomasDallas` | Competitor | **0 posts** | Yes |
| Facebook | `chiroriatlanta` | Competitor | **0 posts** | Yes |
| Facebook | `okuatlanta` | Competitor | **0 posts** | Yes |
| Facebook | `gyukakuatlantaga` | Competitor | **0 posts** | Yes |
| TikTok | `duecucina` | Competitor | **0 posts** | Yes |

**Result: 2/17 accounts (12%) return posts. All Facebook accounts return 0 posts. All TikTok accounts return 0 posts.**

### 2. The `load_posts` Parameter — ROOT CAUSE IDENTIFIED (January 31, 2026)

**UPDATE**: Data365 technical support confirmed that we were using the **wrong parameter name**. The correct parameter is `load_feed_posts`, NOT `load_posts`. The API silently ignores unknown parameters, which is why posts were never loaded.

**Root cause**: Our pipeline was sending `load_posts=true` — an invalid parameter — instead of `load_feed_posts=true` in the `POST /{platform}/profile/{handle}/update` request. The API accepted the request without error (HTTP 202) and collected profile metadata successfully, but never triggered post collection because the parameter was unrecognized.

**Fix applied**: Changed `load_posts` to `load_feed_posts` in:
- `lib/providers/data365/client.ts` (central client used by all platform adapters)
- `supabase/functions/job_worker/index.ts` (edge function)

**Additional clarifications from Data365 support**:
- Trial accounts have NO limitations on post loading — this was never a tier issue
- The `max_posts` parameter (default 10, we use 20) was correct
- Feed posts cost +1 credit per post; reels cost +2; tagged posts cost +2
- Expired media URLs in old cached posts are expected — social platforms rotate CDN URLs frequently
- Fresh POST requests with `load_feed_posts=true` should return valid, active media URLs
- To preserve media, either download immediately after retrieval or use the S3 storage parameter

**Previous (incorrect) conclusion**: ~~The `load_posts` parameter is either not supported, premium-only, or silently ignored.~~ The parameter was simply the wrong name.

### 3. Why Some Accounts Have Posts

The two accounts that DO return posts share a common trait: **Data365 already had their post data in its cache from prior collection**.

- **`starbucks`**: A massive account (17.7M followers) almost certainly tracked by many other Data365 customers. Data365 maintains cached posts for popular accounts.
- **`terillisrestaurant`**: Posts were collected during our earlier testing sessions (Feb 28, 2026). The data dates back to 2019-2022. Data365 retained these from our initial collection.

All other accounts — despite having public profiles with hundreds/thousands of real posts — return zero posts because Data365 has **never collected their post data**.

### 4. Image URL Expiration (Critical)

Instagram and Facebook serve media through CDN URLs with embedded expiration tokens. Data365 passes these through directly without caching:

| Account | Image URL `oe=` Expiration | Status |
|---------|---------------------------|--------|
| `starbucks` (fresh) | `2026-03-05 09:25 UTC` | Valid (~4 days from collection) |
| `terillisrestaurant` (stale) | `2022-06-27 04:57 UTC` | **Expired 3.7 years ago** |

Key details:
- The `oe=` parameter in Instagram CDN URLs is a hex-encoded Unix timestamp
- URLs typically expire **3-7 days** after the Data365 profile update
- Data365 provides an `attached_media_display_url_s3` field for permanent S3-hosted copies, but it returns **`null`** for all posts in our account — likely a premium feature
- There is no way to "refresh" image URLs without re-collecting the entire profile

**Impact**: Even when post data IS available, images will break within days of collection. The screenshots the user sees (broken images with alt text) are caused by this exact issue — the Terilli's post images were collected in mid-2022 and the CDN links expired in June 2022.

### 5. Profile Data Works Correctly

In contrast to posts, **profile-level data works reliably**:
- Follower/following counts: Accurate and up-to-date
- Bio/description: Correct
- Avatar URLs: Working (these use different CDN expiration logic)
- Display name, verification status, business category: All correct
- `posts_count` field: Returns the total post count even though actual posts are inaccessible

This confirms the Data365 API is functional for profile metadata but critically limited for post-level data.

---

## Technical Verification

### Our Code Is Correct

We verified our normalization pipeline by comparing raw API responses against our TypeScript types:

```
Data365 API field        → Our InstagramRawPost type  → Normalized field
───────────────────────────────────────────────────────────────────────
text                     → text                       → text ✓
likes_count              → likes_count                → likesCount ✓
comments_count           → comments_count             → commentsCount ✓
attached_media_display_url → attached_media_display_url → mediaUrl ✓
text_tags                → text_tags                  → hashtags ✓
created_time             → created_time               → createdTime ✓
id                       → id                         → platformPostId ✓
```

When Data365 provides posts (e.g., `terillisrestaurant`), our pipeline correctly normalizes and stores all fields. The issue is entirely on the data provider side.

### Pipeline Flow Verification

```
POST /update (load_posts=true) → Poll until finished → GET /profile (profile data)
                                                      → GET /feed/posts (EMPTY for 88% of accounts)
```

The pipeline completes without errors. Social jobs show `status: "completed"` in the `refresh_jobs` table. Snapshots are created with correct profile data but empty `recentPosts` arrays.

---

## Root Cause Summary

| Issue | Root Cause | Fixable? |
|-------|-----------|----------|
| No posts for most accounts | Data365 doesn't collect post data on-demand; relies on pre-existing cached data | **No** — API limitation |
| `load_posts` parameter ignored | Undocumented parameter; possibly premium-only | **No** — API limitation |
| Broken images | Instagram CDN URLs expire in 3-7 days; Data365's S3 mirror (`_s3` field) returns null | **Partially** — would need to download & self-host images |
| Zero Facebook posts | Data365 cannot scrape Facebook page posts for any of our tracked pages | **No** — API limitation |
| Zero TikTok posts | Same as Facebook — no post data available | **No** — API limitation |
| Stale terillisrestaurant data | Snapshot was collected before normalizer fix; now deleted and ready for re-collection | **Yes** — fixed |

---

## Recommendations

### Option A: Replace Data365 for Post Data (Recommended)

Keep Data365 for **profile metrics only** (follower counts, growth tracking) and use a dedicated service for post-level data:

1. **Apify** ([apify.com](https://apify.com)) — Instagram/Facebook/TikTok scrapers with reliable post data, images, and engagement metrics. Pay-per-result pricing. Provides persistent image URLs.
2. **Bright Data** ([brightdata.com](https://brightdata.com)) — Social media datasets with guaranteed freshness. Higher cost but enterprise-grade reliability.
3. **PhantomBuster** ([phantombuster.com](https://phantombuster.com)) — Social media automation with data extraction. Good for Instagram and Facebook.
4. **RapidAPI social endpoints** — Various Instagram/TikTok APIs with post-level data. Variable quality.

### Option B: Supplement with Direct Platform APIs

- **Instagram Graph API** (via Facebook Business) — Requires linked Facebook page and Instagram Business account. Only works for accounts the user owns/manages.
- **TikTok Research API** — Academic/business access with post data. Requires application.
- **Facebook Graph API** — Page posts available with page access token.

**Limitation**: These only work for accounts the user controls, not competitors.

### Option C: Self-Hosted Scraping

Use **Firecrawl** (already integrated) or **Playwright** to scrape public social media pages directly:
- Pros: Full control, real-time data, no API limitations
- Cons: Fragile (HTML changes break scrapers), rate limiting, ToS concerns

### Option D: Image Proxying (Quick Fix for Current Data)

For the immediate image breakage issue, we could:
1. Download images at collection time and store in Supabase Storage
2. Use an image proxy service that handles CDN URL refreshing
3. Show placeholder/fallback when images fail to load

### Recommended Path Forward

1. **Short term**: Add image error handling (fallback placeholders) + keep Data365 for profile metrics
2. **Medium term**: Integrate Apify or Bright Data for Instagram/TikTok/Facebook post data
3. **Long term**: Build a multi-provider architecture where post data comes from the most reliable source per platform

---

## Test Environment

- **Data365 API**: v1.1 (`https://api.data365.co/v1.1`)
- **Access token**: Active (authenticated successfully)
- **Test date**: March 1, 2026, 09:30-10:00 AM CST
- **Test method**: Direct `curl` requests to the REST API (bypassing our application code)
- **Accounts tested**: 17 unique platform/handle combinations across 3 locations and their competitors
- **Locations**: Terilli's Restaurant (Dallas), Lockwood Distilling Company (Richardson), Wagyu House Atlanta

---

## Appendix: Raw Test Commands

```bash
# Profile data (works for all accounts)
curl -s "https://api.data365.co/v1.1/instagram/profile/{handle}?access_token={TOKEN}"

# Posts data (returns empty for most accounts)
curl -s "https://api.data365.co/v1.1/instagram/profile/{handle}/feed/posts?access_token={TOKEN}&max_page=1&page_size=20&order_by=date_desc"

# Trigger profile update with load_posts
curl -s -X POST "https://api.data365.co/v1.1/instagram/profile/{handle}/update?access_token={TOKEN}&load_posts=true&max_posts=20"

# Poll update status
curl -s "https://api.data365.co/v1.1/instagram/profile/{handle}/update?access_token={TOKEN}"
```

All commands were run with the production Data365 access token against the live API.
