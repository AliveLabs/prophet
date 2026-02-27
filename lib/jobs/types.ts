// ---------------------------------------------------------------------------
// Shared types for the real-time job pipeline system
// ---------------------------------------------------------------------------

export type JobType = "content" | "visibility" | "events" | "insights" | "photos" | "busy_times" | "weather" | "refresh_all"

export type JobStatus = "running" | "completed" | "failed"

export type StepStatus = "queued" | "running" | "complete" | "failed" | "skipped"

export type JobStep = {
  name: string
  label: string
  status: StepStatus
  preview?: Record<string, unknown>
  error?: string
  startedAt?: string
  completedAt?: string
}

export type JobRecord = {
  id: string
  organization_id: string
  location_id: string
  job_type: JobType
  status: JobStatus
  total_steps: number
  current_step: number
  steps: JobStep[]
  result: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

// SSE event payloads
export type SSEStepEvent = {
  jobId: string
  stepIndex: number
  step: JobStep
  progress: number
}

export type SSEDoneEvent = {
  jobId: string
  status: "completed" | "failed"
  warnings: string[]
  redirectUrl: string
}

// Pipeline step definition
export type PipelineStepDef<TCtx = unknown> = {
  name: string
  label: string
  run: (ctx: TCtx) => Promise<Record<string, unknown> | null>
}

// Ambient feed card
export type AmbientCard = {
  id: string
  category: "from_your_data" | "industry_tip" | "did_you_know" | "step_result"
  text: string
  icon?: string
}
