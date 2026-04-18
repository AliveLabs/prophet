"use client"

import { useEffect, useState } from "react"

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
}

const FALLBACKS: Record<string, string> = {
  foreground: "#2b353f",
  primary: "#2b353f",
  precisionTeal: "#34775e",
  signalGold: "#d4880a",
  destructive: "#dc2626",
  mutedForeground: "#726a63",
  carbonLight: "#3d4b58",
  deepIndigo: "#1a2228",
  border: "#f2ece6",
  vaticIndigo: "#2b353f",
  vaticIndigoSoft: "#3d4b58",
}

const VAR_MAP: Record<string, string> = {
  foreground: "--foreground",
  primary: "--primary",
  precisionTeal: "--precision-teal",
  signalGold: "--signal-gold",
  destructive: "--destructive",
  mutedForeground: "--muted-foreground",
  carbonLight: "--carbon-light",
  deepIndigo: "--deep-indigo",
  border: "--border",
  vaticIndigo: "--vatic-indigo",
  vaticIndigoSoft: "--vatic-indigo-soft",
}

export type ChartColors = typeof FALLBACKS

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACKS)

  useEffect(() => {
    const update = () => {
      const next: Record<string, string> = {}
      for (const [key, varName] of Object.entries(VAR_MAP)) {
        const val = getCSSVar(varName)
        next[key] = val || FALLBACKS[key]
      }
      setColors(next as ChartColors)
    }
    update()

    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-brand", "class"],
    })
    return () => observer.disconnect()
  }, [])

  return colors
}
