import Link from "next/link";
import { PartnerApplicationForm } from "../../components/partner/PartnerApplicationForm";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export const metadata = { title: "Partner with MedLink" };

export default async function PartnerPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return <main className="partner-shell">
    <nav className="partner-nav"><Link className="brand" href="/"><span>M</span>MedLink</Link><Link href="/partner/portal">Partner portal</Link></nav>
    <header className="partner-hero"><p className="eyebrow">MedLink Partner Network</p><h1>Bring trusted medicine access closer to every patient.</h1><p>Apply once, prove your identity and capabilities, and connect your organization to MedLink’s governed pharmacy and medication-access network.</p></header>
    <section className="partner-section">
      <div className="partner-steps"><article><b>01</b><h2>Apply</h2><p>Tell us who you are and provide a verifiable organization identity.</p></article><article><b>02</b><h2>Qualify</h2><p>A MedLink reviewer verifies credentials, compliance, and the governed agreement.</p></article><article><b>03</b><h2>Activate</h2><p>Connect real locations and integrations. Network readiness is derived—not switched on manually.</p></article></div>
    </section>
    <section className="partner-section partner-card"><p className="eyebrow">Start a governed application</p><h2>Become a MedLink partner</h2>
      {data.user ? <PartnerApplicationForm email={data.user.email ?? ""} /> : <><p>Sign in with a secure email link before entering organization details. Your draft stays tied to your verified account.</p><Link className="button" href="/auth/sign-in?next=/partner">Sign in to apply</Link></>}
    </section>
  </main>;
}
