"use client"

// Organization settings form, rebuilt to The Pass. Same wired behavior as
// org-settings-form.tsx — it posts the SAME server action `updateOrganizationAction`
// with the same hidden org_id + name + billing_email fields. Presentation only:
// kit tk-set-* inputs + a TkButton submit with pending state.

import { useFormStatus } from "react-dom"
import { updateOrganizationAction } from "./actions"
import { TkButton } from "@/components/ticket"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <TkButton type="submit" variant="act" disabled={pending}>
      {pending ? "Saving…" : "Save changes"}
    </TkButton>
  )
}

export function OrgFormPass({
  orgId,
  name,
  billingEmail,
}: {
  orgId: string
  name: string
  billingEmail: string | null
}) {
  return (
    <form action={updateOrganizationAction} className="tk-set-form">
      <input type="hidden" name="org_id" value={orgId} />

      <div className="tk-set-ifield">
        <label htmlFor="org-name" className="tk-set-ilabel">Organization name</label>
        <input
          id="org-name"
          name="name"
          type="text"
          defaultValue={name}
          required
          className="tk-set-input"
        />
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
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  )
}
