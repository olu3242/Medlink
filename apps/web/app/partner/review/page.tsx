import Link from "next/link";
import { redirect } from "next/navigation";
import { PartnerActions } from "../../../components/partner/PartnerActions";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export default async function PartnerReviewPage() {
  const supabase=await createSupabaseServerClient(); const {data:auth}=await supabase.auth.getUser();
  if(!auth.user) redirect("/auth/sign-in?next=/partner/review");
  const {data:membership}=await supabase.from("organization_memberships").select("id").eq("user_id",auth.user.id).eq("role","platform_admin").is("deleted_at",null).limit(1);
  if(!membership?.length) redirect("/partner/portal");
  const {data:applications}=await supabase.from("partner_applications").select("*,partner_identity_claims(id,scheme,country_code,raw_value,verification_status),partner_requirements(id,title,status)").is("deleted_at",null).order("updated_at",{ascending:true});
  return <main className="partner-shell"><nav className="partner-nav"><Link className="brand" href="/"><span>M</span>MedLink</Link><Link href="/partner/portal">Applicant view</Link></nav><header className="partner-hero partner-hero--compact"><p className="eyebrow">MedLink operations</p><h1>Partner review workbench</h1><p>Identity resolution, evidence review, agreement, integration, and activation remain separately governed.</p></header>
    <section className="partner-section partner-list">{applications?.map((application)=>{const identity=(application.partner_identity_claims as Array<{id:string}>)[0];return <article className="partner-application partner-review-card" key={application.id}><div><small>{application.public_reference}</small><h2>{application.legal_name}</h2><p>{application.partner_type} · {application.relationship_status} · v{application.version}</p><code>{application.organization_id ?? "Organization unresolved"}</code></div><PartnerActions reviewer applicationId={application.id} version={application.version} status={application.relationship_status} partnerType={application.partner_type} {...(identity?{identityId:identity.id}:{})}/></article>})}</section>
  </main>;
}
