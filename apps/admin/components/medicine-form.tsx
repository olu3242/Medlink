"use client";

import { Button } from "@medlink/ui";
import {
  useEffect,
  useState,
  type FormEvent,
} from "react";
import type { MedicineDetail } from "../lib/api";

interface IngredientOption {
  id: string;
  preferredName: string;
}

function optionalText(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

export function MedicineForm({ medicine }: { medicine?: MedicineDetail }) {
  const primary = medicine?.ingredients.find(({ primary }) => primary);
  const registration = medicine?.registrations[0];
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/admin/api/v1/ingredients", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ data: IngredientOption[] }>;
      })
      .then(({ data }) => {
        if (active) setIngredients(data);
      })
      .catch(() => {
        if (active) {
          setMessage(
            "Existing active ingredients could not be loaded. You may create one below.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function resolveIngredient(form: FormData) {
    const selected = optionalText(form, "primaryIngredientId");
    if (selected) return selected;
    const preferredName = optionalText(form, "newIngredientName");
    if (!preferredName) {
      throw new Error("Select or create a primary active ingredient.");
    }
    const response = await fetch("/admin/api/v1/ingredients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ preferredName }),
    });
    if (!response.ok) throw new Error("The active ingredient could not be created.");
    const body = await response.json() as { data: IngredientOption };
    return body.data.id;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    const url = medicine
      ? `/admin/api/v1/medicines/${medicine.id}`
      : "/admin/api/v1/medicines";

    try {
      const primaryIngredientId = await resolveIngredient(form);
      const secondaryIngredientIds = String(
        form.get("secondaryIngredientIds") ?? "",
      ).split(",").map((value) => value.trim()).filter(Boolean);
      const registrationNumber = optionalText(form, "registrationNumber");
      const payload = {
        brandName: String(form.get("brandName") ?? "").trim(),
        genericName: String(form.get("genericName") ?? "").trim(),
        therapeuticClassId:
          optionalText(form, "therapeuticClassId") ?? null,
        dosageForm: String(form.get("dosageForm") ?? "").trim(),
        route: String(form.get("route") ?? "").trim(),
        strength: String(form.get("strength") ?? "").trim(),
        packSize: optionalText(form, "packSize") ?? null,
        manufacturer: optionalText(form, "manufacturer") ?? null,
        controlled: form.get("controlled") === "on",
        status: String(form.get("status") ?? "draft"),
        aliases: String(form.get("aliases") ?? "")
          .split(",").map((value) => value.trim()).filter(Boolean),
        ingredients: [
          {
            ingredientId: primaryIngredientId,
            amount: optionalText(form, "ingredientAmount")
              ? Number(form.get("ingredientAmount"))
              : null,
            unit: optionalText(form, "ingredientUnit") ?? null,
            primary: true,
          },
          ...secondaryIngredientIds.map((ingredientId) => ({
            ingredientId,
            amount: null,
            unit: null,
            primary: false,
          })),
        ],
        registrations: registrationNumber ? [{
          countryCode: String(form.get("countryCode") ?? "NG").trim()
            .toUpperCase(),
          authorityCode: String(form.get("authorityCode") ?? "NAFDAC").trim(),
          registrationNumber,
          validFrom: optionalText(form, "validFrom") ?? null,
          validUntil: optionalText(form, "validUntil") ?? null,
        }] : [],
        ...(medicine ? { expectedVersion: medicine.version } : {}),
      };
      const response = await fetch(url, {
        method: medicine ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? "The medicine could not be saved.");
      }
      const body = await response.json() as {
        data: { brandName: string; version: number };
      };
      setMessage(
        `${body.data.brandName} saved as version ${body.data.version}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The medicine could not be saved. Check the fields and retry.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {medicine ? (
        <p className="muted">
          Catalogue version {medicine.version}. Updates use optimistic
          concurrency and create immutable evidence.
        </p>
      ) : null}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="brandName">Brand name</label>
          <input
            defaultValue={medicine?.brandName}
            id="brandName"
            name="brandName"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="genericName">Generic name</label>
          <input
            defaultValue={medicine?.genericName}
            id="genericName"
            name="genericName"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="strength">Strength</label>
          <input
            defaultValue={medicine?.strength}
            id="strength"
            name="strength"
            placeholder="e.g. 500 mg"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="dosageForm">Dosage form</label>
          <select
            defaultValue={medicine?.dosageForm ?? "tablet"}
            id="dosageForm"
            name="dosageForm"
          >
            {[
              "tablet",
              "capsule",
              "injection",
              "cream",
              "ointment",
              "syrup",
              "solution",
              "suspension",
              "drops",
              "inhaler",
              "suppository",
              "patch",
            ].map((form) => <option key={form}>{form}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="route">Route</label>
          <input
            defaultValue={medicine?.route ?? "oral"}
            id="route"
            name="route"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="packSize">Pack size</label>
          <input defaultValue={medicine?.packSize ?? ""} id="packSize" name="packSize" />
        </div>
        <div className="field">
          <label htmlFor="manufacturer">Manufacturer</label>
          <input
            defaultValue={medicine?.manufacturer ?? ""}
            id="manufacturer"
            name="manufacturer"
          />
        </div>
        <div className="field">
          <label htmlFor="status">Catalogue status</label>
          <select defaultValue={medicine?.status ?? "draft"} id="status" name="status">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="primaryIngredientId">Primary active ingredient</label>
          <select
            defaultValue={primary?.ingredientId ?? ""}
            id="primaryIngredientId"
            name="primaryIngredientId"
          >
            <option value="">Create a new ingredient below</option>
            {ingredients.map((ingredient) => (
              <option key={ingredient.id} value={ingredient.id}>
                {ingredient.preferredName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="newIngredientName">New active ingredient</label>
          <input id="newIngredientName" name="newIngredientName" maxLength={200} />
        </div>
        <div className="field">
          <label htmlFor="ingredientAmount">Ingredient amount</label>
          <input
            defaultValue={primary?.amount ?? ""}
            id="ingredientAmount"
            min="0.000001"
            name="ingredientAmount"
            step="any"
            type="number"
          />
        </div>
        <div className="field">
          <label htmlFor="ingredientUnit">Ingredient unit</label>
          <input
            defaultValue={primary?.unit ?? ""}
            id="ingredientUnit"
            name="ingredientUnit"
          />
        </div>
        <div className="field full">
          <label htmlFor="secondaryIngredientIds">
            Additional ingredient IDs (comma separated)
          </label>
          <input
            defaultValue={medicine?.ingredients
              .filter(({ primary: isPrimary }) => !isPrimary)
              .map(({ ingredientId }) => ingredientId).join(", ")}
            id="secondaryIngredientIds"
            name="secondaryIngredientIds"
          />
        </div>
        <div className="field full">
          <label htmlFor="aliases">Synonyms / aliases (comma separated)</label>
          <input
            defaultValue={medicine?.aliases.map(({ alias }) => alias).join(", ")}
            id="aliases"
            name="aliases"
          />
        </div>
        <div className="field">
          <label htmlFor="authorityCode">Regulatory authority</label>
          <input
            defaultValue={registration?.authorityCode ?? "NAFDAC"}
            id="authorityCode"
            name="authorityCode"
          />
        </div>
        <div className="field">
          <label htmlFor="registrationNumber">Registration number</label>
          <input
            defaultValue={registration?.registrationNumber ?? ""}
            id="registrationNumber"
            name="registrationNumber"
          />
        </div>
        <div className="field">
          <label htmlFor="countryCode">Country code</label>
          <input
            defaultValue={registration?.countryCode ?? "NG"}
            id="countryCode"
            maxLength={2}
            name="countryCode"
          />
        </div>
        <div className="field">
          <label htmlFor="validUntil">Registration valid until</label>
          <input
            defaultValue={registration?.validUntil ?? ""}
            id="validUntil"
            name="validUntil"
            type="date"
          />
        </div>
        <label className="full">
          <input
            defaultChecked={medicine?.controlled}
            name="controlled"
            type="checkbox"
          />{" "}
          Controlled medicine — requires pharmacist review
        </label>
      </div>
      <p className="muted">
        Active medicines require a regulatory registration. Alternatives never
        authorize automatic substitution.
      </p>
      <div aria-live="polite" className="form-actions">
        <Button disabled={saving} type="submit">
          {saving ? "Saving..." : "Save medicine"}
        </Button>
        {message ? <span>{message}</span> : null}
      </div>
    </form>
  );
}
