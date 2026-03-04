"use client"

import { useTransition, useState } from "react"
import HandleManager from "@/components/social/handle-manager"
import {
  saveSocialProfileAction,
  deleteSocialProfileAction,
  verifySocialProfileAction,
  runSocialDiscoveryAction,
} from "./actions"

type SocialHandle = {
  id: string
  entityType: "location" | "competitor"
  entityId: string
  entityName: string
  platform: "instagram" | "facebook" | "tiktok"
  handle: string
  profileUrl: string | null
  discoveryMethod: "auto_scrape" | "data365_search" | "manual"
  isVerified: boolean
}

type Props = {
  locationId: string
  locationName: string
  locationHandles: SocialHandle[]
  competitorHandleGroups: SocialHandle[][]
}

export default function SocialHandleSection({
  locationId,
  locationName,
  locationHandles,
  competitorHandleGroups,
}: Props) {
  const [isDiscovering, startDiscovery] = useTransition()
  const [discoveryResult, setDiscoveryResult] = useState<string | null>(null)

  function handleDiscover() {
    setDiscoveryResult(null)
    startDiscovery(async () => {
      const result = await runSocialDiscoveryAction(locationId)
      if (result.error) {
        setDiscoveryResult(`Error: ${result.error}`)
      } else {
        setDiscoveryResult(`Discovered ${result.discovered} social profile${result.discovered !== 1 ? "s" : ""}`)
      }
    })
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Social Profiles</h2>
          <p className="text-[11px] text-slate-500">
            Manage social media handles for your location and competitors
          </p>
        </div>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={isDiscovering}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {isDiscovering ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Discovering...
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Discover Handles
            </>
          )}
        </button>
      </div>

      {discoveryResult && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-xs font-medium ${
          discoveryResult.startsWith("Error")
            ? "border border-rose-200 bg-rose-50 text-rose-700"
            : "border border-emerald-200 bg-emerald-50 text-emerald-700"
        }`}>
          {discoveryResult}
        </div>
      )}

      <div className="space-y-5">
        <HandleManager
          entityType="location"
          entityId={locationId}
          entityName={locationName}
          handles={locationHandles}
          onSave={saveSocialProfileAction}
          onDelete={deleteSocialProfileAction}
          onVerify={verifySocialProfileAction}
        />

        {competitorHandleGroups.map((handles) => {
          const first = handles[0]
          if (!first) return null
          return (
            <HandleManager
              key={first.entityId}
              entityType="competitor"
              entityId={first.entityId}
              entityName={first.entityName}
              handles={handles}
              onSave={saveSocialProfileAction}
              onDelete={deleteSocialProfileAction}
              onVerify={verifySocialProfileAction}
            />
          )
        })}
      </div>
    </div>
  )
}
