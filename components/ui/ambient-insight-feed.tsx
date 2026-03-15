"use client"

import { useState, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { AmbientCard } from "@/lib/jobs/types"

type Props = {
  cards: AmbientCard[]
  autoAdvanceMs?: number
}

const CATEGORY_META: Record<
  AmbientCard["category"],
  { label: string; color: string; icon: string }
> = {
  from_your_data: {
    label: "From your data",
    color: "bg-precision-teal/10 text-precision-teal border-precision-teal/30",
    icon: "📊",
  },
  industry_tip: {
    label: "Industry tip",
    color: "bg-vatic-indigo-soft/10 text-vatic-indigo-soft border-vatic-indigo-soft/30",
    icon: "💡",
  },
  did_you_know: {
    label: "Did you know?",
    color: "bg-signal-gold/10 text-signal-gold border-signal-gold/30",
    icon: "✨",
  },
  step_result: {
    label: "Just completed",
    color: "bg-primary/10 text-primary border-primary/30",
    icon: "✅",
  },
}

export default function AmbientInsightFeed({
  cards,
  autoAdvanceMs = 5000,
}: Props) {
  const [index, setIndex] = useState(0)
  const [seenIds] = useState(() => new Set<string>())

  const uniqueCards = useMemo(() => {
    const result: AmbientCard[] = []
    for (const card of cards) {
      if (!seenIds.has(card.id)) {
        seenIds.add(card.id)
        result.push(card)
      }
    }
    return result.length > 0 ? result : cards
  }, [cards, seenIds])

  useEffect(() => {
    if (uniqueCards.length <= 1) return
    const interval = setInterval(() => {
      setIndex((i) => (i + 1) % uniqueCards.length)
    }, autoAdvanceMs)
    return () => clearInterval(interval)
  }, [uniqueCards.length, autoAdvanceMs])


  if (uniqueCards.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border p-4">
        <p className="text-xs text-muted-foreground">
          Loading insights...
        </p>
      </div>
    )
  }

  const current = uniqueCards[index % uniqueCards.length]
  const meta = CATEGORY_META[current.category]

  return (
    <div className="flex flex-col gap-3">
      {/* Card */}
      <div className="relative min-h-[80px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={current.id + "-" + index}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35 }}
            className={`rounded-xl border px-4 py-3 shadow-sm ${meta.color}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-sm">{meta.icon}</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">
                {meta.label}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed">
              {current.text}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dots indicator */}
      {uniqueCards.length > 1 && (
        <div className="flex items-center justify-center gap-1">
          {uniqueCards.slice(-8).map((card, i) => {
            const actualIndex = uniqueCards.length - 8 + i
            const isActive = actualIndex >= 0 && (index % uniqueCards.length) === (actualIndex < 0 ? i : actualIndex)
            return (
              <button
                key={card.id}
                onClick={() => setIndex(actualIndex < 0 ? i : actualIndex)}
                className={`h-1.5 rounded-full transition-all ${
                  isActive
                    ? "w-4 bg-primary"
                    : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/60"
                }`}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
