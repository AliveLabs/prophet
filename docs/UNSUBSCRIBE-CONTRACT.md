# Unsubscribe contract (app side and marketing automation side)

Decision D7, greenlit 2026-08-13. This is the handoff artifact between the two sides of the
unsubscribe fix.

**Split of responsibility**

| Side | Owns |
|---|---|
| Marketing automation (Chris) | Embedding a per-recipient signed link in every marketing and lifecycle email, adding the `List-Unsubscribe` headers, and filtering opted-out contacts out of every send query |
| Product app (this repo) | Hosting `/unsubscribe`, verifying the signature, recording the opt-out, the resubscribe affordance, and the RFC 8058 one-click endpoint |

Nothing else changes hands. The app never sends marketing email; the marketing side never renders
the unsubscribe page.

---

## 1. The shared secret

Environment variable name, identical on both sides: `UNSUB_SECRET`

- Generated once at deploy time: `openssl rand -base64 48`
- Shared out of band. It is not in the repo, not in the schema file, and not in any email.
- Both sides must hold the byte-identical value. The app only ever verifies; the templates only
  ever sign.
- The app fails **closed**: if `UNSUB_SECRET` is unset, every link renders as invalid. That is
  deliberate, so a missing secret is visible immediately rather than silently accepting anything.
- Rotating the secret invalidates the unsubscribe links in every email already delivered. Rotate
  only by agreement, and only for cause.

---

## 2. URL format

Human-facing page (this is the link that goes in the email footer):

```
https://app.getticket.ai/unsubscribe?e=<E>&s=<S>
```

One-click endpoint (this is the URI that goes in the `List-Unsubscribe` header):

```
https://app.getticket.ai/api/unsubscribe?e=<E>&s=<S>
```

Both take the same two params. Nothing else is required, and no additional param is trusted.

| Param | Meaning |
|---|---|
| `e` | base64url of the recipient's normalized email address, no padding |
| `s` | base64url of the HMAC signature, no padding |
| `a` | Optional. `a=resubscribe` on the page reverses the opt-out. The app generates this itself on the confirmation page; templates never set it. The one-click endpoint ignores it. |

`e` is encoded to keep raw addresses out of URLs, server logs, and referrer headers. It is
encoding, not secrecy: `s` is the security boundary.

There is no expiry parameter and no expiry check. An unsubscribe link in a two-year-old email has
to keep working.

---

## 3. HMAC construction

```
email    = lowercase(trim(recipient_address))
message  = "unsub.v1." + email                     # UTF-8, no separators beyond the literal dots
signature = base64url( HMAC-SHA256(key = UNSUB_SECRET, message) )    # no "=" padding
e         = base64url( email )                                        # no "=" padding
```

Details that matter:

- **Algorithm:** HMAC-SHA256. The key is the raw `UNSUB_SECRET` string as-is (no base64 decode of
  the secret, no hashing of it first).
- **Encoding:** base64url, which is standard base64 with `+` to `-`, `/` to `_`, and padding `=`
  stripped. Node's `.digest("base64url")` and `Buffer.toString("base64url")` already do this.
- **Version prefix:** the literal `unsub.v1.` is part of the signed message. It exists so the
  construction can change later without old links silently verifying under new rules.
- **Normalization:** the address is trimmed and lowercased **before** signing. The app normalizes
  the decoded `e` the same way before verifying, so a template that encodes `Owner@Example.com`
  but signs the normalized form still verifies. Signing the un-normalized form does not verify.
- **Comparison:** the app compares in constant time and never reveals which check failed.

Reference implementation (Node, as used inside n8n's Code node):

```js
const crypto = require('crypto')

function unsubscribeLink(rawEmail) {
  const email = String(rawEmail).trim().toLowerCase()
  const e = Buffer.from(email, 'utf8').toString('base64url')
  const s = crypto
    .createHmac('sha256', process.env.UNSUB_SECRET)
    .update('unsub.v1.' + email, 'utf8')
    .digest('base64url')
  const qs = `e=${encodeURIComponent(e)}&s=${encodeURIComponent(s)}`
  return {
    page: `https://app.getticket.ai/unsubscribe?${qs}`,
    oneClick: `https://app.getticket.ai/api/unsubscribe?${qs}`,
  }
}
```

Verification vector, for confirming both sides agree before the first send:

```
UNSUB_SECRET = test-unsub-secret-value
email        = owner@example.com
message      = unsub.v1.owner@example.com
e            = b3duZXJAZXhhbXBsZS5jb20
s            = AOU3MvNHLW8Cy6rBV3UVBJKa6UcnuP0FAnHYD9V4kjQ
```

Sign that message with the test secret on the marketing side and confirm `s` matches exactly
before the first real send. The same vector is pinned in
`tests/unit/marketing/unsubscribe-token.test.ts` in this repo.

---

## 4. Template usage

Footer link, every marketing and lifecycle email:

```html
<a href="https://app.getticket.ai/unsubscribe?e={{$json.unsubE}}&s={{$json.unsubS}}">
  Unsubscribe
</a>
```

Headers, every marketing and lifecycle email (RFC 8058 one-click):

```
List-Unsubscribe: <https://app.getticket.ai/api/unsubscribe?e={{$json.unsubE}}&s={{$json.unsubS}}>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Both headers must be present together. `List-Unsubscribe-Post` without a `List-Unsubscribe` URI
does nothing, and the URI without the post header falls back to the older mailto or link behaviour
that Gmail and Yahoo bulk-sender rules no longer accept.

The `e` and `s` values are per recipient. Reusing one recipient's pair in a broadcast would let any
recipient unsubscribe a different address.

---

## 5. What the app does with a request

| Request | App behaviour |
|---|---|
| `GET /unsubscribe` with a valid signature | Records the opt-out, renders a plain confirmation naming the address, offers a resubscribe link |
| `GET /unsubscribe` with `a=resubscribe` and a valid signature | Clears the opt-out, renders a confirmation, offers the unsubscribe link back |
| `GET /unsubscribe` with a missing or invalid signature | Renders one neutral "this link is invalid or expired" page. No storage read or write happens. |
| `POST /api/unsubscribe` with a valid signature | Records the opt-out, returns an empty `200`, renders nothing. Always an opt-out; `a` is ignored. |
| `POST /api/unsubscribe` with an invalid signature | Empty `400`, no storage touched |
| `GET /api/unsubscribe` | `303` to `/unsubscribe` with the same params, for clients that open the header URI in a browser |

**Non-enumeration.** A valid signature for an address with no contact row produces exactly the same
response as one with a row: the write is an `UPDATE` keyed on email with no prior lookup and no
row-count check. Nobody can use this endpoint to test whether an address is on the list, and
without the secret nobody can mint a valid link for an address at all.

**The opt-out is recorded on `GET`.** Unsubscribing must be one click with no confirm step. The
resubscribe affordance is what makes that safe against a link-prefetching mail scanner.

---

## 6. Storage

Column: `marketing.contacts.unsubscribed_at timestamptz`

- `NULL` means the contact may receive marketing email.
- Non-null is the instant they opted out.
- The app sets it from `/unsubscribe` and `/api/unsubscribe`, and clears it on resubscribe.

**This column does not exist in `stream1-supabase-schema.sql` v1.3 yet.** The migration is checked
in at `supabase/migrations/20260813090000_marketing_contacts_unsubscribed_at.sql` and is
**deliberately unapplied**: `marketing` is Chris's schema, so the change needs his sign-off, and
his schema file should be bumped to match so the two definitions do not drift.

Until it is applied, the write is rejected and `/unsubscribe` shows its neutral retry state. That
is intentional. A compliance write fails loudly rather than no-oping behind a flag.

**Required on the marketing side:** every marketing and lifecycle send query adds
`AND unsubscribed_at IS NULL`. The app cannot enforce this: it does not run the sends. The column
is the record; the filter is what makes it mean something.

---

## 7. Scope boundary

The opt-out governs **marketing email only**.

Transactional email from the product (sign-in links, password resets, billing and receipts,
security notices) ignores it. That is not a policy setting: the app's transactional send path never
reads the column, and `tests/unit/email/transactional-exemption.test.ts` fails the build if any
file under `lib/email/**` so much as references the opt-out layer. An opted-out contact who resets
their password still gets the link.

Keep the same boundary on the marketing side: an opted-out contact should drop out of nurture,
drip, and announcement sends, and stay in anything a customer would be alarmed to miss.
