import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PartnerActions } from "../../../../components/partner/PartnerActions";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export default async function PartnerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase=await createSupabaseServerClient(); const {data:auth}=await supabase.auth.getUser();
  if(!auth.user) redirect("/auth/sign-in?next=/partner/portal");
  const {id}=await params;
  const {data:application}=await supabase.from("partner_applications").select("*,partner_identity_claims(*),partner_requirements(*),partner_agreements(*),partner_integration_profiles(*),partner_readiness_assessments(*)").eq("id",id).single();
  if(!application) notFound();
  const agreements=(application.partner_agreements ?? []) as Array<{id:string;version:string;accepted_at:string|null}>;
  const currentAgreement=agreements.find((item)=>!item.accepted_at) ?? agreements.at(-1);
  const assessments=(application.partner_readiness_assessments ?? []) as Array<{ready:boolean;blockers:string[];created_at:string}>;
  const assessment=assessments.sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  const agreementProps=currentAgreement ? { agreementId: currentAgreement.id } : {};
  return <main className="partner-shell"><nav className="partner-nav"><Link className="brand" href="/"><span>M</span>MedLink</Link><Link href="/partner/portal">All applications</Link></nav>
    <header className="partner-hero partner-hero--compact"><p className="eyebrow">{application.public_reference}</p><h1>{application.legal_name}</h1><p>{application.summary}</p><div className="partner-badges"><span>{application.relationship_status}</span><span>{application.onboarding_stage}</span><span>{application.integration_status}</span></div></header>
    <section className="partner-section partner-detail-grid"><article className="partner-card"><h2>Readiness</h2>{assessment?<><strong className={assessment.ready?"ready":"blocked"}>{assessment.ready?"Ready for activation":"Blocked"}</strong><ul>{assessment.blockers.map((blocker)=><li key={blocker}>{blocker.replaceAll("_"," ")}</li>)}</ul></>:<p>No readiness assessment has been recorded.</p>}<PartnerActions applicationId={application.id} version={application.version} status={application.relationship_status} {...agreementProps}/></article>
    <article className="partner-card"><h2>Requirements</h2><ul className="partner-checklist">{(application.partner_requirements as Array<{id:string;title:string;status:string}>).map((requirement)=><li key={requirement.id}><span>{requirement.status==="satisfied"?"✓":"○"}</span><div>{requirement.title}<small>{requirement.status}</small></div></li>)}</ul></article>
    <article className="partner-card"><h2>Canonical handoff</h2>{application.organization_id?<><p>Your approved relationship is linked to one MedLink organization.</p><code>{application.organization_id}</code>{["pharmacy","pharmacy_chain"].includes(application.partner_type)&&<a className="button" href={process.env.MEDLINK_PHARMACY_URL ?? "http://localhost:3002"}>Continue pharmacy onboarding</a>}</>:<p>An organization is linked only after a reviewer resolves the submitted identity.</p>}</article></section>
  </main>;
}
