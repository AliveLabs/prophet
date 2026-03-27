import { LandingNav } from "@/components/landing/landing-nav"
import { HeroSection } from "@/components/landing/hero-section"
import { ProblemSection } from "@/components/landing/problem-section"
import { HowItWorksSection } from "@/components/landing/how-it-works-section"
import { FeaturesSection } from "@/components/landing/features-section"
import { TrustSection } from "@/components/landing/trust-section"
import { PricingSection } from "@/components/landing/pricing-section"
import { WaitlistSection, LandingFooter } from "@/components/landing/waitlist-section"
import "./landing.css"

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingNav />
      <main>
        <HeroSection />
        <ProblemSection />
        <HowItWorksSection />
        <FeaturesSection />
        <TrustSection />
        <PricingSection />
        <WaitlistSection />
      </main>
      <LandingFooter />
    </div>
  )
}
