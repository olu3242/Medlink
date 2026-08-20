"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnerActions({ applicationId, version, status, reviewer, identityId, agreementId, partnerType, locationId }: {
  applicationId: string; version: number; status: string; reviewer?: boolean; identityId?: string; agreementId?: string; partnerType?: string; locationId?: string;
}) {
  const router = useRouter(); const [message,setMessage]=useState(""); const [pending,setPending]=useState(false);
  async function act(action:string, body:Record<string,unknown>) {
    setPending(true); setMessage("Saving canonical partner state…");
    try {
      const response=await fetch(`/api/v1/partner/applications/${applicationId}/${action}`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":crypto.randomUUID()},body:JSON.stringify(body)});
      if(!response.ok){
        setMessage(response.status===401||response.status===403
          ? "You are not authorized to perform this partner action. Sign in with the required role or contact MedLink support."
          : response.status===409
            ? "This application changed before the action completed. Refresh the application and try again."
            : "The partner action was not saved. Review the required evidence and try again.");
        return;
      }
      setMessage(`Saved — ${action.replaceAll("-", " ")} is reflected in the application timeline.`);router.refresh();
    } catch {
      setMessage("The network request failed. No success was assumed; check your connection and retry.");
    } finally { setPending(false); }
  }
  async function submitLocation(formData:FormData) {
    await act("location",{name:formData.get("name"),licenseNumber:formData.get("licenseNumber"),addressLine1:formData.get("addressLine1"),locality:formData.get("locality"),countryCode:formData.get("countryCode"),latitude:Number(formData.get("latitude")),longitude:Number(formData.get("longitude"))});
  }
  async function certifyLocation(formData:FormData) {
    const now=new Date().toISOString();
    await act("location-capability",{locationId:formData.get("locationId"),credentialStatus:"verified",inventoryIntegrationStatus:"healthy",inventoryFreshnessStatus:"current",medicationMappingStatus:"eligible",paymentCapabilityStatus:"ready",fulfillmentCapabilityStatus:"ready",freshnessPolicyReference:"governed://inventory-freshness/mvp",sourceUpdatedAt:now,lastSuccessfulSync:now,evidenceReference:formData.get("evidenceReference")});
  }
  async function assignPharmacist(formData:FormData) {
    await act("pharmacist",{email:formData.get("email"),licenseNumber:formData.get("licenseNumber"),issuingAuthority:formData.get("issuingAuthority"),licenseExpiresOn:formData.get("licenseExpiresOn"),reason:formData.get("reason")});
  }
  if(reviewer) return <div className="partner-actions">
    <button disabled={pending || status!=="under_review"} onClick={()=>act("verification",{subjectType:"identity",subjectId:identityId,status:"verified",notes:"Identity evidence reviewed against authoritative registration reference"})}>Verify identity</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("verification",{subjectType:"compliance",status:"verified",notes:"Compliance evidence reviewed by the independent MedLink reviewer"})}>Verify compliance</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("decision",{decision:"approve",reason:"Identity and submitted qualification evidence satisfy the governed reviewer checks",expectedVersion:version,idempotencyKey:crypto.randomUUID()})}>Approve relationship</button>
    <button disabled={pending || status!=="under_review"} onClick={()=>act("decision",{decision:"request_information",reason:"Additional authoritative qualification evidence is required before a decision",expectedVersion:version,idempotencyKey:crypto.randomUUID()})}>Request information</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("agreement",{agreementType:"partner_terms",version:"mvp-2026-08",documentReference:"governed://partner-terms/mvp-2026-08",documentDigest:"5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"})}>Issue agreement</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("integration",{providerKind:"manual",capabilities:["identity","status","health","inventory"],status:"certified"})}>Certify integration</button>
    <button disabled={pending || status!=="approved"} onClick={()=>act("activate",{expectedVersion:version,reason:"All derived activation prerequisites have been independently satisfied"})}>Activate partner</button>
    {status==="approved"?<form action={certifyLocation} className="partner-inline-form"><label>Pharmacy location ID<input name="locationId" defaultValue={locationId} required /></label><label>Capability evidence reference<input name="evidenceReference" defaultValue="governed://partner-review/location" required /></label><button disabled={pending} type="submit">Verify location capability</button></form>:null}
    {status==="active"?<form action={assignPharmacist} className="partner-inline-form"><label>Verified pharmacist email<input name="email" type="email" required /></label><label>License number<input name="licenseNumber" minLength={3} required /></label><label>Issuing authority<input name="issuingAuthority" defaultValue="PCN" minLength={2} required /></label><label>License expiry<input name="licenseExpiresOn" type="date" required /></label><label>Assignment reason<input name="reason" minLength={10} defaultValue="Verified license and approved organization assignment" required /></label><button disabled={pending} type="submit">Assign verified pharmacist</button></form>:null}
    {message&&<p aria-live="polite" role="status">{message}</p>}
  </div>;
  return <div className="partner-actions">
    {status==="applicant"||status==="needs_information"?<button disabled={pending} onClick={()=>act("submit",{expectedVersion:version,reason:""})}>{pending?"Submitting application…":"Submit pharmacy application"}</button>:null}
    {agreementId&&status==="approved"?<button disabled={pending} onClick={()=>act("accept-agreement",{agreementId})}>Accept current agreement</button>:null}
    {status==="approved"&&["pharmacy","pharmacy_chain"].includes(partnerType ?? "")&&!locationId?<form action={submitLocation} className="partner-inline-form"><label>Location name<input name="name" minLength={2} required /></label><label>Pharmacy license number<input name="licenseNumber" minLength={3} required /></label><label>Street address<input name="addressLine1" minLength={3} required /></label><label>City / locality<input name="locality" minLength={2} required /></label><label>Country code<input name="countryCode" defaultValue="NG" pattern="[A-Za-z]{2}" required /></label><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" required /></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" required /></label><button disabled={pending} type="submit">Add licensed pharmacy location</button></form>:null}
    {locationId?<p>Pharmacy location <code>{locationId}</code> is linked to this application.</p>:null}
    <button disabled={pending} onClick={()=>act("readiness",{})}>Recheck readiness</button>
    {message&&<p aria-live="polite" role="status">{message}</p>}
  </div>;
}
