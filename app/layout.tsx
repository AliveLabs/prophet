import type { Metadata } from "next"
import {
  Inter,
  Space_Grotesk,
  Space_Mono,
  Barlow_Condensed,
  Instrument_Serif,
  Fraunces,
} from "next/font/google"
import ThemeProvider from "@/components/theme-provider"
import "./globals.css"
import "./ticket-theme.css"
import "./neat-theme.css"

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
})

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
})

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-barlow-condensed",
})

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
})

const SITE_DESCRIPTION =
  "Know what's firing before it hits your P&L. Ticket monitors competitor menus, pricing, reviews, and social — scored by confidence so you move first, not last."

export const metadata: Metadata = {
  title: {
    default: "Ticket — Competitive Intelligence for Restaurants",
    template: "%s · Ticket",
  },
  description: SITE_DESCRIPTION,
  icons: {
    icon: [
      { url: "/ticket/assets/svg/ticket-favicon.svg", type: "image/svg+xml" },
      { url: "/ticket/assets/png/ticket-favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/ticket/assets/png/ticket-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/ticket/assets/png/ticket-favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/ticket/assets/png/ticket-favicon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/ticket/assets/png/ticket-favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/ticket/assets/svg/ticket-apple-touch-icon.svg", type: "image/svg+xml" },
      { url: "/ticket/assets/png/ticket-favicon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    siteName: "Ticket",
    title: "Ticket — Competitive Intelligence for Restaurants",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/ticket/assets/png/ticket-social-og-1200x630.png",
        width: 1200,
        height: 630,
        alt: "Ticket — Competitive Intelligence for Restaurants",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ticket — Competitive Intelligence for Restaurants",
    description: SITE_DESCRIPTION,
    images: ["/ticket/assets/png/ticket-social-og-1200x630.png"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" data-brand="ticket" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable} ${barlowCondensed.variable} ${instrumentSerif.variable} ${fraunces.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
