import { type Capability, CapabilityError, hasRole } from "./capabilities"
import { type AdminActionContext, getAdminContext, requireCapability } from "./platform-admin"
import { logAdminAction } from "@/lib/admin/activity-log"

export type { AdminActionContext }

// Every admin action shares this failure shape, so the wrapper can return it on a capability
// denial regardless of the action's specific success shape (message / url / orgId / ...).
type Denial = { ok: false; error: string }

/**
 * Wrap a server action so its capability gate can't be forgotten. Runs requireCapability
 * BEFORE the body and passes the resolved admin context (user + role + ids) as the first arg.
 *
 * On ANY capability denial — the pre-gate OR an in-body requireSuperAdmin elevation — returns
 * { ok:false, error } (the shared failure shape) instead of throwing, so the existing client
 * feedback UI surfaces it cleanly. Every other error propagates unchanged. CapabilityError is
 * a dedicated type only our gates throw, so catching it anywhere in the action is safe and
 * intended. (No redirect()s run inside this path, so NEXT_REDIRECT is never swallowed.)
 *
 * 6b (audit) and 6e (rate-limit) will extend this single wrapper, so every wrapped action
 * picks them up automatically.
 */
export function withAdminAction<TArgs extends unknown[], TResult>(
  capability: Capability,
  fn: (ctx: AdminActionContext, ...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult | Denial> {
  return async (...args: TArgs): Promise<TResult | Denial> => {
    try {
      const ctx = await requireCapability(capability)
      return await fn(ctx, ...args)
    } catch (e) {
      if (e instanceof CapabilityError) {
        // Best-effort: record a denied attempt by a known admin (a privilege-escalation
        // signal — e.g. an 'admin' trying a super_admin-only action). Never let a logging
        // failure change the denial response. Non-admins resolve to null and aren't logged.
        try {
          const actor = await getAdminContext()
          if (actor) {
            await logAdminAction({
              adminId: actor.adminId,
              adminEmail: actor.adminEmail,
              action: "capability.denied",
              targetType: "capability",
              targetId: capability,
              details: { capability, role: actor.role, message: e.message },
            })
          }
        } catch {
          // ignore — the denial result below is what matters
        }
        return { ok: false, error: e.message }
      }
      throw e
    }
  }
}

/**
 * In-body privilege elevation for actions whose required role depends on the TARGET (e.g. an
 * admin may delete a demo org, but a Customer org needs super_admin). Throws CapabilityError
 * — which withAdminAction converts to { ok:false, error } — when ctx.role is below super_admin.
 * Call AFTER loading the target so the decision can read its org_kind/mode.
 */
export function requireSuperAdmin(ctx: AdminActionContext, message: string): void {
  if (!hasRole(ctx.role, "super_admin")) {
    throw new CapabilityError(message, null, ctx.role)
  }
}
