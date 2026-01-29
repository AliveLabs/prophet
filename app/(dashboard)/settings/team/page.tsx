import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function TeamPage() {
  return (
    <section className="space-y-6">
      <Card className="bg-white text-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Team</h1>
            <p className="mt-2 text-sm text-slate-600">
              Invite team members and manage roles.
            </p>
          </div>
          <Button>Invite member</Button>
        </div>
      </Card>
      <Card className="bg-white text-slate-900">
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-900">You</p>
              <p>Owner</p>
            </div>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
              Active
            </span>
          </div>
          <p className="text-sm text-slate-500">
            Team management actions will appear here once invites are wired.
          </p>
        </div>
      </Card>
    </section>
  )
}
