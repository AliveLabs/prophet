import { Button } from "@/components/ui/button"

export default function TeamPage() {
  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="text-[12.5px] font-semibold text-foreground">Team</span>
          <Button size="sm">Invite member</Button>
        </div>
        <div className="p-5">
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-border bg-secondary px-4 py-3">
              <div>
                <p className="font-semibold text-foreground">You</p>
                <p className="text-muted-foreground">Owner</p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                Active
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Team management actions will appear here once invites are wired.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
