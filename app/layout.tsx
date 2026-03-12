import type { Metadata } from "next"
import { Cormorant_Garamond, Inter, Geist_Mono } from "next/font/google"
import "./globals.css"

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
})

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    <html lang="en">
      <body className={`${cormorant.variable} ${inter.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  )
}
