export type SnapshotFieldChange = {
  field: string
  before: unknown
  after: unknown
}

export type SnapshotDiff = {
  changes: SnapshotFieldChange[]
  ratingDelta?: number
  reviewCountDelta?: number
  hoursChanged?: boolean
}

export type GeneratedInsight = {
  insight_type: string
  title: string
  summary: string
  confidence: "high" | "medium" | "low"
  severity: "info" | "warning" | "critical"
  evidence: Record<string, unknown>
  recommendations: Array<Record<string, unknown>>
}
