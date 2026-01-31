export type ActionResult<T> = {
  ok: boolean
  data?: T
  message?: string
  errors?: unknown
}
