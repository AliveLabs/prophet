interface StatsCardsProps {
  stats: {
    total: number
    pending: number
    approved: number
    declined: number
  }
}

export function WaitlistStatsCards({ stats }: StatsCardsProps) {
  const cards = [
    {
      label: "Total Signups",
      value: stats.total,
      color: "text-foreground",
      bg: "bg-secondary/50",
    },
    {
      label: "Pending Review",
      value: stats.pending,
      color: "text-signal-gold",
      bg: "bg-signal-gold/10",
    },
    {
      label: "Approved",
      value: stats.approved,
      color: "text-precision-teal",
      bg: "bg-precision-teal/10",
    },
    {
      label: "Declined",
      value: stats.declined,
      color: "text-destructive",
      bg: "bg-destructive/10",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-xl border border-border ${card.bg} p-5`}
        >
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {card.label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${card.color}`}>
            {card.value}
          </p>
        </div>
      ))}
    </div>
  )
}
