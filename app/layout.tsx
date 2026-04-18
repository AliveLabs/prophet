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

export const metadata: Metadata = {
  title: "Vatic — Competitive Intelligence",
  description:
    "AI-powered competitive intelligence for local businesses. See further.",
  icons: {
    icon: [
      { url: "/logos/vatic-favicon.svg", type: "image/svg+xml" },
      { url: "/logos/vatic-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logos/vatic-favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/logos/vatic-app-icon.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable} ${barlowCondensed.variable} ${instrumentSerif.variable} ${fraunces.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
