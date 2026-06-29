import Link from "next/link"
import { requirePlatformAdmin } from "@/lib/auth/platform-admin"
import { RevealOnView } from "@/components/ticket"
import { CreateOrgForm } from "./components/create-org-form"
import "../orgs.css"

export default async function NewOrgPage() {
  const admin = await requirePlatformAdmin()

  return (
    <div className="ticket-chrome tk-kit ao-page">
      <RevealOnView as="header" className="ao-page-head">
        <nav className="ao-crumbs" aria-label="Breadcrumb">
          <Link href="/admin/organizations">Organizations</Link>
          <span className="ao-sep" aria-hidden="true">/</span>
          <span className="ao-here">New</span>
        </nav>
        <span className="tk-eyebrow">Platform · Accounts</span>
        <h1>Create demo or test org</h1>
        <p>
          Spin up an admin-owned organization for sales demos or QA. Real
          customer orgs are created only through signup and onboarding.
        </p>
      </RevealOnView>

      <RevealOnView>
        <CreateOrgForm adminEmail={admin.email ?? ""} />
      </RevealOnView>
    </div>
  )
}
