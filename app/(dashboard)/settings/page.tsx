import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function SettingsPage() {
  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">Settings</span>
        </div>
        <div className="space-y-2 p-5">
          <Link href="/settings/organization">
            <Button variant="secondary" className="w-full justify-start">Organization</Button>
          </Link>
          <Link href="/settings/billing">
            <Button variant="secondary" className="w-full justify-start">Billing</Button>
          </Link>
          <Link href="/settings/team">
            <Button variant="secondary" className="w-full justify-start">Team</Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
