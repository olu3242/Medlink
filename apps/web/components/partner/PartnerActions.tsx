"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnerActions({ applicationId, version, status, reviewer, identityId, agreementId }: {
  applicationId: string; version: number; status: string; reviewer?: boolean; identityId?: string; agreementId?: string;
}) {
  const router = useRouter(); const [message,setMessage]=useState(""); const [pending,setPending]=useState(false);
  async function act(action:string, body:Record<string,unknown>) {
    setPending(true); setMessage("");
    const response=await fetch(`/api/v1/partner/applications/${applicationId}/${action}`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify(body)});
    const payload=await response.json();
    if(!response.ok){setMessage(payload.detail ?? "Operation rejected");setPending(false);return;}
    setMessage("Saved");setPending(false);router.refresh();
  }
  if(reviewer) return <div className="partner-actions">
    <button disabled={pending || status!=="under_review"} onClick={()=>act("verification",{subjectType:"identity",subjectId:identityId,status:"verified",notes:"Identity evidence reviewed against authoritative registration reference"})}>Verify identity</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("verification",{subjectType:"compliance",status:"verified",notes:"Compliance evidence reviewed by the independent MedLink reviewer"})}>Verify compliance</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("decision",{decision:"approve",reason:"Identity and submitted qualification evidence satisfy the governed reviewer checks",expectedVersion:version,idempotencyKey:crypto.randomUUID()})}>Approve relationship</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("decision",{decision:"request_information",reason:"Additional authoritative qualification evidence is required before a decision",expectedVersion:version,idempotencyKey:crypto.randomUUID()})}>Request information</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("agreement",{agreementType:"partner_terms",version:"mvp-2026-08",documentReference:"governed://partner-terms/mvp-2026-08",documentDigest:"5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"})}>Issue agreement</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("integration",{providerKind:"manual",capabilities:["identity","status","health","inventory"],status:"certified"})}>Certify integration</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("activate",{expectedVersion:version,reason:"All derived activation prerequisites have been independently satisfied"})}>Activate partner</button>
    {message&&<p role="status">{message}</p>}
  </div>;
  return <div className="partner-actions">
    {status==="applicant"||status==="needs_information"?<button disabled={pending} onClick={()=>act("submit",{expectedVersion:version,reason:""})}>Submit for review</button>:null}
    {agreementId&&status==="approved"?<button disabled={pending} onClick={()=>act("accept-agreement",{agreementId})}>Accept current agreement</button>:null}
    <button disabled={pending} onClick={()=>act("readiness",{})}>Recheck readiness</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}
