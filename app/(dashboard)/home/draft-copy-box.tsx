"use client"

// The drafted customer-facing copy block, with a copy-to-clipboard control.
//
// Extracted from pass-play-card.tsx so the unified insight card's side sheet can offer the
// same thing. Copying the drafted line is the single most concretely useful affordance on a
// play — it is the difference between reading advice and doing the work — so it could not be
// left behind on the old card.

import { useState } from "react"
import { useTkToast } from "@/components/ticket"
import { COPY_ICON, CHECK_ICON } from "./pass-icons"

export function DraftCopyBox({ label, text }: { label: string; text: string }) {
  const toast = useTkToast()
  const [copied, setCopied] = useState(false)
  function copy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
    setCopied(true)
    toast("Copied to clipboard.")
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="tk-draft-box">
      <div className="tk-db-head">
        {label}
        {/* Two-overlapping-squares copy glyph (Claude-desktop style), top-right (ALT-168c). */}
        <button
          type="button"
          className={`tk-copy-btn${copied ? " tk-copied" : ""}`}
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
        >
          {copied ? CHECK_ICON : COPY_ICON}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="tk-db-body">{text}</div>
    </div>
  )
}
