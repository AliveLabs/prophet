-- Out-of-order Stripe webhook guard (see app/api/stripe/webhook/route.ts).
--
-- Stripe does not guarantee delivery order, and retries can land minutes after
-- the original. Before this column, a redelivered/late subscription event could
-- overwrite newer billing state with stale data (e.g. re-activate a canceled
-- org). We stamp every applied subscription event's `event.created` here and
-- make the org UPDATE conditional on it: a write only lands if its event is at
-- least as new as the last one applied. The conditional UPDATE is atomic, so
-- two concurrent deliveries for the same org serialize on the row lock and the
-- stale one no-ops (last-write-wins by event.created).

ALTER TABLE public.organizations
    ADD COLUMN stripe_event_created bigint;

COMMENT ON COLUMN public.organizations.stripe_event_created IS
    'Stripe event.created (unix seconds) of the last subscription webhook applied to this org. Guard for out-of-order/concurrent webhook deliveries: applySubscriptionToOrg only writes when its event.created >= this value. NULL until the first guarded webhook write; direct API sync paths (checkout-complete, cancel, change-plan) do not touch it.'
