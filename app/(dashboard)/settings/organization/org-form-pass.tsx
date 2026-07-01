"use client"

// Organization settings form, rebuilt to The Pass. Same wired behavior as
// org-settings-form.tsx — it posts the SAME server action `updateOrganizationAction`
// with the same hidden org_id + name + billing_email fields. Presentation only:
// kit tk-set-* inputs + a TkButton submit with pending state.

import { useFormStatus } from "react-dom"
import { updateOrganizationAction, resendBillingEmailVerificationAction } from "./actions"
import { TkButton } from "@/components/ticket"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <TkButton type="submit" variant="act" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </TkButton>
  )
}

function ResendButton() {
  const { pending } = useFormStatus()
  return (
    <TkButton type="submit" variant="ghost" disabled={pending}>
      {pending ? "Sending…" : "Resend verification"}
    </TkButton>
  )
}

export function OrgFormPass({
  orgId,
  name,
  displayName,
  billingEmail,
  pendingBillingEmail,
}: {
  orgId: string
  /** Legal/account name — immutable here (ALT-226). */
  name: string
  /** Optional editable display name; blank ⇒ falls back to the legal name. */
  displayName: string | null
  billingEmail: string | null
  /** ALT-227: a billing email change awaiting confirmation, if one is in flight. */
  pendingBillingEmail?: string | null
}) {
  return (
  <>
    <form action={updateOrganizationAction} className="tk-set-form">
      <input type="hidden" name="org_id" value={orgId} />

      {/* ALT-226: legal name is immutable — shown locked, not editable here. */}
      <div className="tk-set-ifield">
        <label htmlFor="org-name" className="tk-set-ilabel">Organization name</label>
        <input
          id="org-name"
          type="text"
          value={name}
          disabled
          aria-describedby="org-name-hint"
          className="tk-set-input"
        />
        <span id="org-name-hint" className="tk-set-hint">
          Your legal account name. Contact support to change it.
        </span>
      </div>

      <div className="tk-set-ifield">
        <label htmlFor="org-display-name" className="tk-set-ilabel">Display name</label>
        <input
          id="org-display-name"
          name="display_name"
          type="text"
          defaultValue={displayName ?? ""}
          placeholder={name}
          aria-describedby="org-display-hint"
          className="tk-set-input"
        />
        <span id="org-display-hint" className="tk-set-hint">
          Shown across your dashboard. Leave blank to use your legal name.
        </span>
      </div>

      <div className="tk-set-ifield">
        <label htmlFor="org-billing-email" className="tk-set-ilabel">Billing email</label>
        <input
          id="org-billing-email"
          name="billing_email"
          type="email"
          defaultValue={billingEmail ?? ""}
          placeholder="billing@company.com"
          className="tk-set-input"
        />
        {pendingBillingEmail && (
          <span className="tk-set-hint">
            Verification pending for <strong>{pendingBillingEmail}</strong> — check that
            inbox to confirm. Billing email stays as shown above until then.
          </span>
        )}
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>

    {pendingBillingEmail && (
      <form action={resendBillingEmailVerificationAction} className="tk-set-form" style={{ marginTop: 8 }}>
        <input type="hidden" name="org_id" value={orgId} />
        <ResendButton />
      </form>
    )}
  </>
  )
}
