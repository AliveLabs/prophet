// Plain-language question builders for the "Ask Ticket about this" ingress (ALT-259).
// Server-safe (NO "use client"): the /home/[rank] detail page is a Server Component and
// calls these at render time, so they must not live in the client ask-ticket.tsx module
// (RSC Pattern 1). Both play-detail surfaces build the SAME question from these helpers so
// the ingress reads identically wherever it appears. Jargon-free per the lintVoice gate.

export function askStepQuestion(playTitle: string, n: number, audience?: string | null): string {
  return audience
    ? `Walk me through how to do this step of "${playTitle}": ${audience}.`
    : `Walk me through step ${n} of "${playTitle}".`
}

export function askEvidenceQuestion(playTitle: string): string {
  return `What's the evidence behind "${playTitle}", and how much should I trust it?`
}
