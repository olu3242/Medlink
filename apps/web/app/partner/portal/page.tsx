import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function PartnerPortalPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/auth/sign-in?next=/partner/portal");
  const { data: applications } = await supabase.from("partner_applications")
    .select("id,public_reference,legal_name,partner_type,relationship_status,onboarding_stage,integration_status,updated_at")
    .is("deleted_at", null).order("updated_at", { ascending: false });
  return <main className="partner-shell"><nav className="partner-nav"><Link className="brand" href="/"><span>M</span>MedLink</Link><Link href="/partner">New application</Link></nav>
    <header className="partner-hero partner-hero--compact"><p className="eyebrow">Partner portal</p><h1>Your relationship with MedLink</h1><p>Track evidence, review requests, agreement, integration, and activation readiness.</p></header>
    <section className="partner-section">{applications?.length ? <div className="partner-list">{applications.map((application) => <Link className="partner-application" key={application.id} href={`/partner/portal/${application.id}`}><div><small>{application.public_reference}</small><h2>{application.legal_name}</h2><p>{application.partner_type.replaceAll("_", " ")}</p></div><div className="partner-status"><span>{application.relationship_status.replaceAll("_", " ")}</span><small>{application.onboarding_stage} · {application.integration_status}</small></div></Link>)}</div> : <div className="partner-card"><h2>No applications yet</h2><p>Start with your legal organization identity and primary contact.</p><Link className="button" href="/partner">Start an application</Link></div>}</section>
  </main>;
}
