"use client"

import { useFormStatus } from "react-dom"
import { updateOrganizationAction } from "./actions"
import { Button } from "@/components/ui/button"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-auto">
      {pending ? "Saving..." : "Save changes"}
    </Button>
  )
}

interface OrgSettingsFormProps {
  orgId: string
  name: string
  billingEmail: string | null
}

export function OrgSettingsForm({ orgId, name, billingEmail }: OrgSettingsFormProps) {
  return (
    <form action={updateOrganizationAction} className="space-y-4">
      <input type="hidden" name="org_id" value={orgId} />

      <div className="space-y-1.5">
        <label htmlFor="org-name" className="text-[12.5px] font-medium text-foreground">
          Organization name
        </label>
        <input
          id="org-name"
          name="name"
          type="text"
          defaultValue={name}
          required
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="org-billing-email" className="text-[12.5px] font-medium text-foreground">
          Billing email
        </label>
        <input
          id="org-billing-email"
          name="billing_email"
          type="email"
          defaultValue={billingEmail ?? ""}
          placeholder="billing@company.com"
          className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <SubmitButton />
    </form>
  )
}
