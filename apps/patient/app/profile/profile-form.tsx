"use client";

import type { PatientProfile, PatientProfileInput } from "@medlink/patients";
import { useEffect, useState, type FormEvent } from "react";

function optional(value: FormDataEntryValue | null): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized || undefined;
}

export function ProfileForm() {
  const [profile, setProfile] = useState<PatientProfile | null>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/patients/me", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ data: PatientProfile | null }>;
      })
      .then(({ data }) => { if (active) setProfile(data); })
      .catch(() => {
        if (active) {
          setProfile(null);
          setMessage("Your profile could not be loaded. You can retry shortly.");
        }
      });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const input: PatientProfileInput = {
      phone: String(form.get("phone")),
      ...(optional(form.get("whatsappPhone"))
        ? { whatsappPhone: optional(form.get("whatsappPhone")) }
        : {}),
      ...(optional(form.get("dateOfBirth"))
        ? { dateOfBirth: optional(form.get("dateOfBirth")) }
        : {}),
      address: {
        line1: String(form.get("line1")),
        ...(optional(form.get("line2"))
          ? { line2: optional(form.get("line2")) }
          : {}),
        city: String(form.get("city")),
        state: "Lagos",
        ...(optional(form.get("postalCode"))
          ? { postalCode: optional(form.get("postalCode")) }
          : {}),
        countryCode: "NG",
      },
      preferences: {
        preferredLanguage: String(form.get("preferredLanguage")) as
          PatientProfileInput["preferences"]["preferredLanguage"],
        whatsappOptIn: form.get("whatsappOptIn") === "on",
        emailOptIn: form.get("emailOptIn") === "on",
      },
    };

    try {
      const response = await fetch("/api/v1/patients/me", {
        method: profile ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error();
      const { data } = await response.json() as { data: PatientProfile };
      setProfile(data);
      setMessage("Your profile has been saved.");
    } catch {
      setMessage("Your profile could not be saved. Check the details and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Remove your patient profile from this pilot organization?")) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/v1/patients/me", {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!response.ok) throw new Error();
      setProfile(null);
      setMessage("Your patient profile has been removed.");
    } catch {
      setMessage("Your profile could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  if (profile === undefined) {
    return <p className="muted" role="status">Loading your profile…</p>;
  }

  return (
    <form className="card" onSubmit={save} key={profile?.updatedAt ?? "new"}>
      <h2>{profile ? "Contact details" : "Create your patient profile"}</h2>
      <p className="muted">
        Use international phone format, for example +2348012345678.
      </p>
      <div className="grid">
        <div className="field">
          <label htmlFor="phone">Phone number</label>
          <input id="phone" name="phone" type="tel" required
            pattern="\+[1-9][0-9]{7,14}" defaultValue={profile?.phone} />
        </div>
        <div className="field">
          <label htmlFor="whatsappPhone">WhatsApp number</label>
          <input id="whatsappPhone" name="whatsappPhone" type="tel"
            pattern="\+[1-9][0-9]{7,14}"
            defaultValue={profile?.whatsappPhone} />
        </div>
        <div className="field">
          <label htmlFor="dateOfBirth">Date of birth</label>
          <input id="dateOfBirth" name="dateOfBirth" type="date"
            defaultValue={profile?.dateOfBirth} />
        </div>
        <div className="field">
          <label htmlFor="preferredLanguage">Preferred language</label>
          <select id="preferredLanguage" name="preferredLanguage"
            defaultValue={profile?.preferences.preferredLanguage ?? "en"}>
            <option value="en">English</option>
            <option value="yo">Yorùbá</option>
            <option value="ig">Igbo</option>
            <option value="ha">Hausa</option>
          </select>
        </div>
      </div>
      <h2>Address</h2>
      <div className="grid">
        <div className="field">
          <label htmlFor="line1">Address line 1</label>
          <input id="line1" name="line1" required minLength={3}
            defaultValue={profile?.address.line1} />
        </div>
        <div className="field">
          <label htmlFor="line2">Address line 2</label>
          <input id="line2" name="line2"
            defaultValue={profile?.address.line2} />
        </div>
        <div className="field">
          <label htmlFor="city">City or LGA</label>
          <input id="city" name="city" required
            defaultValue={profile?.address.city ?? "Ikeja"} />
        </div>
        <div className="field">
          <label htmlFor="state">State</label>
          <input id="state" name="state" value="Lagos" disabled />
        </div>
        <div className="field">
          <label htmlFor="postalCode">Postal code</label>
          <input id="postalCode" name="postalCode"
            defaultValue={profile?.address.postalCode} />
        </div>
      </div>
      <fieldset className="field">
        <legend>Communication preferences</legend>
        <label>
          <input name="whatsappOptIn" type="checkbox"
            defaultChecked={profile?.preferences.whatsappOptIn} />
          Receive fulfillment updates on WhatsApp
        </label>
        <label>
          <input name="emailOptIn" type="checkbox"
            defaultChecked={profile?.preferences.emailOptIn} />
          Receive fulfillment updates by email
        </label>
      </fieldset>
      <div className="actions">
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
        {profile ? (
          <button type="button" disabled={busy} onClick={remove}>
            Remove profile
          </button>
        ) : null}
        <span aria-live="polite">{message}</span>
      </div>
    </form>
  );
}
