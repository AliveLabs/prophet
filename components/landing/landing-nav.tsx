"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import ThemeToggle from "@/components/ui/theme-toggle"
import { TicketLogo } from "@/components/brand/ticket-logo"

const NAV_LINKS = [
  { label: "What we watch", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Pricing", href: "#pricing" },
]

export function LandingNav() {
  const [mobileOpen, setMobileOpen] = useState(false)

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-row">
        <Link href="/" className="lp-brand" aria-label="Ticket home">
          <span className="lp-brand-mark" aria-hidden="true">
            <TicketLogo size={17} className="text-white" />
          </span>
          <span className="lp-brand-word">Ticket</span>
        </Link>

        <nav className="lp-nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="lp-nav-link">
              {link.label}
            </a>
          ))}
          <Link href="/login" className="lp-nav-link">
            Sign in
          </Link>
        </nav>

        <div className="lp-nav-right">
          <ThemeToggle className="lp-theme-btn" />
          <a href="#waitlist" className="lp-cta lp-cta-primary lp-nav-cta">
            Request access
          </a>
          <button
            type="button"
            className="lp-burger"
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="lp-mobile-menu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="lp-mobile-inner">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="lp-mobile-link"
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              <Link
                href="/login"
                className="lp-mobile-link"
                onClick={() => setMobileOpen(false)}
              >
                Sign in
              </Link>
              <a
                href="#waitlist"
                className="lp-cta lp-cta-primary"
                style={{ marginTop: 8 }}
                onClick={() => setMobileOpen(false)}
              >
                Request access
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
