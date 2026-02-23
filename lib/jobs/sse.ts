// ---------------------------------------------------------------------------
// SSE (Server-Sent Events) stream utilities
// ---------------------------------------------------------------------------

const encoder = new TextEncoder()

export type SSEController = {
  send: (event: string, data: unknown) => void
  close: () => void
}

export function createSSEStream(): {
  stream: ReadableStream<Uint8Array>
  controller: SSEController
} {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
    cancel() {
      closed = true
    },
  })

  const send = (event: string, data: unknown) => {
    if (closed || !ctrl) return
    try {
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
      ctrl.enqueue(encoder.encode(payload))
    } catch {
      // Stream may have been closed by client
    }
  }

  const close = () => {
    if (closed || !ctrl) return
    closed = true
    try {
      ctrl.close()
    } catch {
      // Already closed
    }
  }

  return { stream, controller: { send, close } }
}

export function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
