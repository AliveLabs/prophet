import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function SettingsPage() {
  return (
    <section className="space-y-6">
      <Card className="bg-card text-foreground">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage billing, team members, and organization preferences.
        </p>
        <div className="mt-4 flex gap-3">
          <Link href="/settings/billing">
            <Button variant="secondary">Billing</Button>
          </Link>
          <Link href="/settings/team">
            <Button variant="secondary">Team</Button>
          </Link>
        </div>
      </Card>
    </section>
  )
}
