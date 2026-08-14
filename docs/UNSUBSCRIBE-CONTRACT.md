# Unsubscribe: where it lives

**The marketing automation side owns unsubscribe end to end. This app hosts no part of it.**

Live since 2026-08-12. This page is a pointer, not a spec: the implementation, and the only
documentation that can go stale, live with the automation side (Chris, n8n).

## How it works

- Every marketing and lifecycle template embeds a per-recipient unsubscribe link pointing at an
  n8n-hosted endpoint. The app is not in that URL.
- The token in the link is the contact's UUID, verified by an id-plus-email lookup. There is no
  shared secret, no HMAC, and nothing for either side to hold in an environment variable.
- Opt-outs are recorded in `marketing.suppression`. Every marketing send path filters on that view,
  which is what makes the record mean something.

## What the app does

Nothing. It hosts no unsubscribe page and no one-click endpoint, reads no opt-out state, and writes
no opt-out record. The app-side implementation built on 2026-08-13 (a `/unsubscribe` page, an
RFC 8058 endpoint, HMAC verification, and an `unsubscribed_at` column on `marketing.contacts`) was
retired on 2026-08-14 as a duplicate. Two things to save the next reader a search:

- There is no `UNSUB_SECRET`, on either side.
- There is no `marketing.contacts.unsubscribed_at`. Its migration was cancelled and never applied.

## Scope boundary

The opt-out governs **marketing email only**, on both sides.

Transactional email from the product (sign-in links, password resets, billing and receipts,
security notices) ignores it. That is not a policy setting: the app's transactional send path never
reads opt-out state, and `tests/unit/email/transactional-exemption.test.ts` fails the build if any
file under `lib/email/**` so much as references it. An opted-out contact who resets their password
still gets the link. That test is the only unsubscribe-related artifact left in this repo, and it is
deliberately independent of which system records the opt-out.

The automation side holds the same boundary by construction: an opted-out contact drops out of
nurture, drip, and announcement sends, and stays in anything a customer would be alarmed to miss.
