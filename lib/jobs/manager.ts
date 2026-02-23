// ---------------------------------------------------------------------------
// Job Manager – CRUD operations for refresh_jobs table
// Uses admin client to bypass RLS for pipeline progress writes
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js"
import type { JobType, JobStatus, JobStep, JobRecord, StepStatus } from "./types"

// Use an untyped Supabase client for `refresh_jobs` (not yet in generated types)
function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

export async function createJob(
  organizationId: string,
  locationId: string,
  jobType: JobType,
  stepDefs: { name: string; label: string }[]
): Promise<string> {
  const steps: JobStep[] = stepDefs.map((s) => ({
    name: s.name,
    label: s.label,
    status: "queued" as const,
  }))

  const { data, error } = await admin()
    .from("refresh_jobs")
    .insert({
      organization_id: organizationId,
      location_id: locationId,
      job_type: jobType,
      status: "running" as JobStatus,
      total_steps: steps.length,
      current_step: 0,
      steps: steps as unknown as Record<string, unknown>,
    })
    .select("id")
    .single()

  if (error || !data) {
    throw new Error(`Failed to create job: ${error?.message ?? "unknown"}`)
  }
  return data.id
}

export async function updateJobStep(
  jobId: string,
  stepIndex: number,
  status: StepStatus,
  preview?: Record<string, unknown>,
  error?: string
): Promise<void> {
  const { data: job } = await admin()
    .from("refresh_jobs")
    .select("steps")
    .eq("id", jobId)
    .single()

  if (!job) return

  const steps = (job.steps ?? []) as unknown as JobStep[]
  if (stepIndex < steps.length) {
    steps[stepIndex] = {
      ...steps[stepIndex],
      status,
      ...(preview && { preview }),
      ...(error && { error }),
      ...(status === "running" && { startedAt: new Date().toISOString() }),
      ...(["complete", "failed", "skipped"].includes(status) && {
        completedAt: new Date().toISOString(),
      }),
    }
  }

  const currentStep =
    status === "complete" || status === "failed" || status === "skipped"
      ? stepIndex + 1
      : stepIndex

  await admin()
    .from("refresh_jobs")
    .update({
      steps: steps as unknown as Record<string, unknown>,
      current_step: Math.min(currentStep, steps.length),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
}

export async function completeJob(
  jobId: string,
  result?: Record<string, unknown>
): Promise<void> {
  await admin()
    .from("refresh_jobs")
    .update({
      status: "completed" as JobStatus,
      result: result ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
}

export async function failJob(
  jobId: string,
  errorMsg: string
): Promise<void> {
  await admin()
    .from("refresh_jobs")
    .update({
      status: "failed" as JobStatus,
      result: { error: errorMsg },
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const { data } = await admin()
    .from("refresh_jobs")
    .select("*")
    .eq("id", jobId)
    .single()

  if (!data) return null
  return {
    ...data,
    steps: (data.steps ?? []) as unknown as JobStep[],
    result: data.result as Record<string, unknown> | null,
  } as JobRecord
}

export async function getActiveJobs(
  organizationId: string
): Promise<JobRecord[]> {
  const { data } = await admin()
    .from("refresh_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(10)

  if (!data) return []
  return data.map((d) => ({
    ...d,
    steps: (d.steps ?? []) as unknown as JobStep[],
    result: d.result as Record<string, unknown> | null,
  })) as JobRecord[]
}

export async function getRecentJobs(
  organizationId: string,
  withinSeconds = 120
): Promise<JobRecord[]> {
  const cutoff = new Date(Date.now() - withinSeconds * 1000).toISOString()
  const { data } = await admin()
    .from("refresh_jobs")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["running", "completed", "failed"])
    .gte("updated_at", cutoff)
    .order("updated_at", { ascending: false })
    .limit(10)

  if (!data) return []
  return data.map((d) => ({
    ...d,
    steps: (d.steps ?? []) as unknown as JobStep[],
    result: d.result as Record<string, unknown> | null,
  })) as JobRecord[]
}
