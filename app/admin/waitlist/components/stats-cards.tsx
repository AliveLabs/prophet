interface StatsCardsProps {
  stats: {
    total: number
    pending: number
    approved: number
    declined: number
  }
}

export function WaitlistStatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="ap-stats">
      {/* Pending is the actionable count → the lead gradient tile */}
      <div className="ap-stat ap-stat-lead">
        <span className="ap-stat-lbl">Pending review</span>
        <span className="ap-stat-val">{stats.pending}</span>
      </div>
      <div className="ap-stat">
        <span className="ap-stat-lbl">Total signups</span>
        <span className="ap-stat-val">{stats.total}</span>
      </div>
      <div className="ap-stat ap-stat-teal">
        <span className="ap-stat-rail" aria-hidden="true" />
        <span className="ap-stat-lbl">Approved</span>
        <span className="ap-stat-val">{stats.approved}</span>
      </div>
      <div className="ap-stat ap-stat-alert">
        <span className="ap-stat-rail" aria-hidden="true" />
        <span className="ap-stat-lbl">Declined</span>
        <span className="ap-stat-val">{stats.declined}</span>
      </div>
    </div>
  )
}
