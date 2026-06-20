// ---------------------------------------------------------------------------
// Slack incoming-webhook poster for internal OPS alerts.
//
// Best-effort and env-gated, mirroring the Resend pattern: if SLACK_ALERT_WEBHOOK_URL
// is unset it silently no-ops (returns {ok:false, skipped:true}) so a missing webhook
// never throws inside a cron. Set the env var to a Slack incoming webhook pointed at the
// #ticket channel and alerts light up — no code change needed.
// ---------------------------------------------------------------------------

export type SlackPostResult =
  | { ok: true }
  | { ok: false; skipped: true }
  | { ok: false; error: string }

/** Post a plain (mrkdwn) message to the ops Slack channel via incoming webhook. */
export async function postSlackAlert(text: string): Promise<SlackPostResult> {
  const url = process.env.SLACK_ALERT_WEBHOOK_URL
  if (!url) {
    console.warn("[slack] SLACK_ALERT_WEBHOOK_URL not set, skipping Slack alert")
    return { ok: false, skipped: true }
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.error(`[slack] webhook error ${res.status}: ${body}`)
      return { ok: false, error: `slack ${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    console.error("[slack] webhook exception:", err)
    return { ok: false, error: err instanceof Error ? err.message : "slack post failed" }
  }
}
