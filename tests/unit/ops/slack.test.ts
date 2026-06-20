import { describe, it, expect, vi, afterEach } from "vitest"
import { postSlackAlert } from "@/lib/ops/slack"

describe("postSlackAlert", () => {
  const realFetch = global.fetch
  const had = process.env.SLACK_ALERT_WEBHOOK_URL
  afterEach(() => {
    global.fetch = realFetch
    if (had === undefined) delete process.env.SLACK_ALERT_WEBHOOK_URL
    else process.env.SLACK_ALERT_WEBHOOK_URL = had
    vi.restoreAllMocks()
  })

  it("skips (no throw) when the webhook env var is unset", async () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL
    expect(await postSlackAlert("hi")).toEqual({ ok: false, skipped: true })
  })

  it("posts the text to the webhook when configured", async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.slack.test/abc"
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => "" }) as unknown as Response)
    global.fetch = fetchMock as unknown as typeof fetch
    const res = await postSlackAlert("DataForSEO down")
    expect(res).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe("https://hooks.slack.test/abc")
    expect(JSON.parse(init.body)).toEqual({ text: "DataForSEO down" })
  })

  it("returns an error (no throw) on a non-ok webhook response", async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = "https://hooks.slack.test/abc"
    global.fetch = vi.fn(async () => ({ ok: false, status: 404, text: async () => "no_service" }) as unknown as Response) as unknown as typeof fetch
    const res = await postSlackAlert("x")
    expect(res).toEqual({ ok: false, error: "slack 404" })
  })
})
