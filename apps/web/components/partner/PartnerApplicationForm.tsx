"use client";

import { partnerTypes } from "@medlink/partner";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PartnerApplicationForm({ email }: { email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(formData: FormData) {
    setPending(true); setError("");
    const response = await fetch("/api/v1/partner/applications", {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        legalName: formData.get("legalName"), tradingName: formData.get("tradingName") || undefined,
        partnerType: formData.get("partnerType"), countryCode: String(formData.get("countryCode")).toUpperCase(),
        website: formData.get("website") || undefined, summary: formData.get("summary"),
        contact: { name: formData.get("contactName"), email, phone: formData.get("phone") || undefined, title: formData.get("title") || undefined },
        identity: { scheme: formData.get("identityScheme"), value: formData.get("identityValue") },
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) { const problem = await response.json(); setError(problem.detail ?? "Application could not be created"); setPending(false); return; }
    const payload = await response.json();
    router.push(`/partner/portal/${payload.application.id}`); router.refresh();
  }

  return <form className="partner-form" action={submit}>
    <div className="partner-grid">
      <label>Legal organization name<input name="legalName" minLength={2} maxLength={200} required /></label>
      <label>Trading name<input name="tradingName" maxLength={200} /></label>
      <label>Partner type<select name="partnerType" required>{partnerTypes.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>
      <label>Country code<input name="countryCode" pattern="[A-Za-z]{2}" maxLength={2} defaultValue="NG" required /></label>
      <label>Primary contact name<input name="contactName" minLength={2} maxLength={160} required /></label>
      <label>Primary contact email<input value={email} readOnly /></label>
      <label>Phone<input name="phone" maxLength={40} /></label>
      <label>Role / title<input name="title" maxLength={120} /></label>
      <label>Identity scheme<input name="identityScheme" placeholder="CAC, NPI, NAFDAC…" minLength={2} maxLength={80} required /></label>
      <label>Registration / license number<input name="identityValue" minLength={2} maxLength={160} required /></label>
      <label className="partner-span">Website<input name="website" type="url" placeholder="https://" /></label>
      <label className="partner-span">How will you work with MedLink?<textarea name="summary" minLength={20} maxLength={2000} rows={5} required /></label>
    </div>
    {error && <p className="partner-error" role="alert">{error}</p>}
    <button className="button" disabled={pending} type="submit">{pending ? "Creating application…" : "Start application"}</button>
  </form>;
}
