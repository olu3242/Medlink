import { AnimatedBackground } from "../components/marketing/AnimatedBackground";
import { CallToAction } from "../components/marketing/CallToAction";
import { FAQ } from "../components/marketing/FAQ";
import { Footer } from "../components/marketing/Footer";
import { Hero } from "../components/marketing/Hero";
import { HospitalJourney } from "../components/marketing/HospitalJourney";
import { HowItWorks } from "../components/marketing/HowItWorks";
import { Navigation } from "../components/marketing/Navigation";
import { PatientJourney } from "../components/marketing/PatientJourney";
import { PharmacistJourney } from "../components/marketing/PharmacistJourney";
import { PharmacyJourney } from "../components/marketing/PharmacyJourney";
import { ProblemStatement } from "../components/marketing/ProblemStatement";
import { SecuritySection } from "../components/marketing/SecuritySection";
import { StakeholderWorkspace } from "../components/marketing/StakeholderWorkspace";
import { TrustBar } from "../components/marketing/TrustBar";

export default function HomePage() {
  return (
    <div className="marketing-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Navigation />
      <main id="main-content">
        <AnimatedBackground />
        <Hero />
        <TrustBar />
        <ProblemStatement />
        <HowItWorks />
        <PatientJourney />
        <PharmacistJourney />
        <PharmacyJourney />
        <HospitalJourney />
        <StakeholderWorkspace />
        <SecuritySection />
        <FAQ />
        <CallToAction />
      </main>
      <Footer />
    </div>
  );
}
