import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function TeamPage() {
  return (
    <section className="space-y-6">
      <Card className="bg-card text-foreground">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Team</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Invite team members and manage roles.
            </p>
          </div>
          <Button>Invite member</Button>
        </div>
      </Card>
      <Card className="bg-card text-foreground">
        <div className="space-y-3 text-sm text-muted-foreground">
          <div className="flex items-center justify-between rounded-xl border border-border bg-secondary px-4 py-3">
            <div>
              <p className="font-semibold text-foreground">You</p>
              <p>Owner</p>
            </div>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              Active
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Team management actions will appear here once invites are wired.
          </p>
        </div>
      </Card>
    </section>
  )
}
