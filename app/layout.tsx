import type { Metadata } from "next"
import { Inter, Space_Grotesk, Space_Mono } from "next/font/google"
import ThemeProvider from "@/components/theme-provider"
import "./globals.css"

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
        className={`${spaceGrotesk.variable} ${inter.variable} ${spaceMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
