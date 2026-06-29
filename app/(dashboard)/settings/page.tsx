// Settings — account, brief tuning, voice, data refresh, social coverage, competitors,
// and communications. REBUILT to The Pass: the page-title chrome (.pv-page/.pv-page-head)
// stays on-system, but the BODY is re-authored into the kit — soft panels, section heads,
// field rows, kit-styled slider/toggle islands. All data fetching, the brand-tolerance +
// category-priors slider behavior, voice/comms persistence, and the durable refresh queue
// are UNCHANGED (the page-local islands call the same wired server actions).

import Link from "next/link"
import { loadOperatorContext, tierLabel } from "../operator-data"
import { requireUser } from "@/lib/auth/server"
import type { CategoryPriors } from "@/lib/skills/category-priors"
import { asSubscriptionTier, TIER_LIMITS } from "@/lib/billing/tiers"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import {
  RevealOnView,
  TkSectionHead,
  TkSoftPanel,
} from "@/components/ticket"
import { getFullRefreshStatus } from "../refresh-actions"
import SettingsBriefTuning from "./settings-brief-tuning"
import SettingsCategoryPriors from "./settings-category-priors"
import SettingsRefreshPass from "./settings-refresh-pass"
import {
  VoiceSelectPass,
  OwnNetworkSelectPass,
  CommsPrefsPass,
} from "./settings-controls-pass"
import { ICON_ARROW } from "./settings-icons"
import "./settings-pass.css"

export default async function SettingsPage() {
  const user = await requireUser()
  const ctx = await loadOperatorContext()
  const email = user.email ?? "you"
  const sb = await createServerSupabaseClient()
  const { data: locRow } = await sb
    .from("locations")
    .select("settings")
    .eq("id", ctx.locationId)
    .maybeSingle()
  const locSettings = (locRow?.settings as Record<string, unknown> | null) ?? {}
  const comms = (locSettings.communications ?? null) as Record<string, boolean> | null
  const refreshStatus = await getFullRefreshStatus(ctx.locationId)

  // Own-network-of-choice (paid Tier 1 only collects ONE own network). Other
  // verified own handles render as the honest "tracked on Tier 2+" seam.
  const orgTier = asSubscriptionTier(ctx.tier)
  const singleOwnNetwork = TIER_LIMITS[orgTier].ownSocialNetworkLimit === 1
  const chosenNetwork =
    typeof locSettings.ownSocialNetwork === "string" ? locSettings.ownSocialNetwork : "instagram"
  let otherOwnNetworks: string[] = []
  if (singleOwnNetwork) {
    const { data: ownProfiles } = await sb
      .from("social_profiles")
      .select("platform, is_verified")
      .eq("entity_id", ctx.locationId)
    otherOwnNetworks = [
      ...new Set(
        (ownProfiles ?? [])
          .filter((p) => p.platform !== chosenNetwork)
          .map((p) => p.platform as string)
      ),
    ]
  }

  return (
    <div className="pv-page">
      <div className="pv-page-head">
        <span className="pv-kicker">Account</span>
        <h1 className="pv-h1">Settings</h1>
        <p className="pv-sub">Your account, how your briefs are tuned, and the data behind them.</p>
      </div>

      <div className="tk-kit tk-set">
        {/* ── ACCOUNT ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Account" sub="Who you are & where you sit" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Restaurant</div>
                <div className="tk-set-fval">
                  <span className="tk-set-fval-strong">{ctx.locationName}</span>
                  {ctx.city ? <span className="tk-set-hint">{ctx.city}</span> : null}
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Plan</div>
                <div className="tk-set-fval">
                  <div className="tk-set-row-actions">
                    <span className="tk-set-fval-strong">{tierLabel(ctx.tier)}</span>
                    <Link className="tk-set-linkbtn" href="/settings/billing">View billing {ICON_ARROW}</Link>
                  </div>
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Operator</div>
                <div className="tk-set-fval">
                  <span className="tk-set-fval-strong">{ctx.userName}</span>
                  <span className="tk-set-hint">{email}</span>
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Workspace</div>
                <div className="tk-set-fval">
                  <div className="tk-set-row-actions">
                    <Link className="tk-set-linkbtn" href="/settings/organization">Manage organization {ICON_ARROW}</Link>
                    <Link className="tk-set-linkbtn" href="/settings/team">Manage team {ICON_ARROW}</Link>
                  </div>
                </div>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── YOUR BRIEFS ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Your briefs" sub="How broad your recommendations are" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Idea boldness</div>
                <div className="tk-set-fval">
                  <p className="tk-set-desc">
                    Sets how broad or narrow your recommendation thresholds are. Your 👍 / 👎 on the brief
                    refine it over time.
                  </p>
                  <SettingsBriefTuning initial={ctx.brandTolerance} locationId={ctx.locationId} />
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">What to prioritize</div>
                <div className="tk-set-fval">
                  <p className="tk-set-desc">
                    Boost the kinds of moves you care about most at this location. A modest reweight, not a
                    filter — applies to your next brief. Hover any category for what it boosts.
                  </p>
                  <SettingsCategoryPriors
                    initial={(locSettings.categoryPriors as CategoryPriors | undefined) ?? null}
                    locationId={ctx.locationId}
                  />
                </div>
              </div>
              <div className="tk-set-field">
                <div className="tk-set-flbl">Your voice</div>
                <div className="tk-set-fval">
                  <p className="tk-set-desc">Used when we draft customer-facing copy in your name.</p>
                  <VoiceSelectPass initial={ctx.voiceTone} locationId={ctx.locationId} />
                </div>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── YOUR DATA ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Your data" sub="Refresh on demand" />
          <TkSoftPanel>
            <SettingsRefreshPass
              locationId={ctx.locationId}
              canRunFull={refreshStatus.canRun}
              fullAvailableAt={refreshStatus.availableAt}
            />
          </TkSoftPanel>
        </RevealOnView>

        {/* ── SOCIAL COVERAGE ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Social coverage" sub="The accounts we read for you" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Your account</div>
                <div className="tk-set-fval">
                  {singleOwnNetwork ? (
                    <>
                      <OwnNetworkSelectPass initial={chosenNetwork} locationId={ctx.locationId} />
                      <p className="tk-set-hint">
                        Your plan tracks one of your own networks — your choice. Competitor accounts are
                        covered on all three networks regardless.
                      </p>
                      {otherOwnNetworks.length > 0 ? (
                        <>
                          <p className="tk-set-hint">
                            We also found you on{" "}
                            {otherOwnNetworks.map((n) => n.charAt(0).toUpperCase() + n.slice(1)).join(" and ")}
                            {" — tracked on Tier 2 and up."}
                          </p>
                          <div className="tk-set-row-actions">
                            <Link className="tk-set-linkbtn" href="/settings/billing">Upgrade plan {ICON_ARROW}</Link>
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="tk-set-fval-strong">Instagram, Facebook, and TikTok</span>
                      <p className="tk-set-hint">
                        Your plan covers all three networks for your account and your competitors.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── COMPETITORS ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Competitors" sub="Your watched set" />
          <TkSoftPanel>
            <div className="tk-set-fields">
              <div className="tk-set-field">
                <div className="tk-set-flbl">Watched set</div>
                <div className="tk-set-fval">
                  <span className="tk-set-fval-strong">
                    Watching {ctx.competitors.length} {ctx.competitors.length === 1 ? "competitor" : "competitors"}
                  </span>
                  <p className="tk-set-hint">Add, change, or remove who you track from the Competitors page.</p>
                  <div className="tk-set-row-actions">
                    <Link className="tk-set-linkbtn" href="/competitors">Manage competitors {ICON_ARROW}</Link>
                  </div>
                </div>
              </div>
            </div>
          </TkSoftPanel>
        </RevealOnView>

        {/* ── COMMUNICATIONS ── */}
        <RevealOnView className="tk-set-block">
          <TkSectionHead title="Communications" sub="What lands in your inbox" />
          <TkSoftPanel>
            <CommsPrefsPass email={email} locationId={ctx.locationId} initial={comms} />
          </TkSoftPanel>
        </RevealOnView>
      </div>
    </div>
  )
}
