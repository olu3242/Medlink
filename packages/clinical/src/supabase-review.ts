import { RuntimeError } from "@medlink/runtime";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  PharmacistReviewDecision,
  PharmacistReviewDetail,
  PharmacistReviewRepository,
  PharmacistReviewSummary,
} from "./review";

interface ValidationRow {
  id: string;
  prescription_id: string;
  status: PharmacistReviewSummary["status"];
  created_at: string;
}

interface PrescriptionRow {
  id: string;
  patient_id: string;
}

interface ItemRow {
  id: string;
  prescription_id: string;
  medicine_id: string | null;
  raw_medicine_text: string;
  strength: string | null;
  dosage: string | null;
  medicine: {
    brand_name: string;
    generic_name: string;
    strength_display: string;
    dosage_form: string;
  } | null;
}

interface FindingRow {
  id: string;
  validation_id: string;
  title: string;
  detail: string;
  severity: string;
  requires_acknowledgement: boolean;
  acknowledged_at: string | null;
}

interface OcrRow {
  prescription_id: string;
  extracted_text: string;
}

interface EvidenceRow {
  validation_id: string;
  content_sha256: string;
}

interface FileRow {
  prescription_id: string;
  storage_bucket: string;
  storage_object_path: string;
  media_type: "image/jpeg" | "image/png" | "application/pdf";
  version: number;
}

interface ClarificationRow {
  id: string;
  prescription_id: string;
  request_text: string;
  response_text: string;
  responded_at: string;
  status: "responded";
}

async function result<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw new RuntimeError(
      "infrastructure",
      "clinical_review_database_failed",
      "The pharmacist review operation could not be completed",
      503,
      true,
      "Retry later.",
      { cause: error },
    );
  }
  return data;
}

function priority(findings: readonly FindingRow[]) {
  if (findings.some((finding) => finding.severity === "critical")) {
    return "critical" as const;
  }
  if (findings.some((finding) =>
    ["high", "moderate"].includes(finding.severity))) {
    return "high" as const;
  }
  return "routine" as const;
}

function patientReference(patientId: string) {
  return `Patient ...${patientId.slice(-8)}`;
}

export class SupabasePharmacistReviewRepository
implements PharmacistReviewRepository {
  constructor(private readonly database: SupabaseClient) {}

  private async records(
    tenantId: string,
    onlyPending: boolean,
    reviewId?: string,
  ) {
    let validationQuery = this.database.from("clinical_validations")
      .select("id,prescription_id,status,created_at")
      .eq("organization_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (onlyPending) validationQuery = validationQuery.eq("status", "pending");
    if (reviewId) validationQuery = validationQuery.eq("id", reviewId).limit(1);
    const validations = (await result(validationQuery)) as ValidationRow[];
    const validationIds = validations.map(({ id }) => id);
    const prescriptionIds = [...new Set(
      validations.map(({ prescription_id }) => prescription_id),
    )];
    if (validations.length === 0) {
      return {
        validations,
        prescriptions: [] as PrescriptionRow[],
        items: [] as ItemRow[],
        findings: [] as FindingRow[],
        ocr: [] as OcrRow[],
        evidence: [] as EvidenceRow[],
        files: [] as FileRow[],
        clarifications: [] as ClarificationRow[],
      };
    }
    const [
      prescriptions,
      items,
      findings,
      ocr,
      evidence,
      files,
      clarifications,
    ] = await Promise.all([
      result(this.database.from("prescriptions").select("id,patient_id")
        .eq("organization_id", tenantId).in("id", prescriptionIds)),
      result(this.database.from("prescription_items")
        .select("id,prescription_id,medicine_id,raw_medicine_text,strength,dosage,medicine:medicines(brand_name,generic_name,strength_display,dosage_form)")
        .in("prescription_id", prescriptionIds).order("line_number")),
      result(this.database.from("clinical_findings")
        .select("id,validation_id,title,detail,severity,requires_acknowledgement,acknowledged_at")
        .in("validation_id", validationIds)),
      result(this.database.from("prescription_ocr_results")
        .select("prescription_id,extracted_text")
        .eq("organization_id", tenantId).in("prescription_id", prescriptionIds)),
      result(this.database.from("clinical_evidence_packages")
        .select("validation_id,content_sha256")
        .eq("organization_id", tenantId).in("validation_id", validationIds)),
      result(this.database.from("prescription_files")
        .select("prescription_id,storage_bucket,storage_object_path,media_type,version")
        .eq("organization_id", tenantId)
        .in("prescription_id", prescriptionIds)
        .order("version", { ascending: false })),
      result(this.database.from("prescription_clarifications")
        .select("id,prescription_id,request_text,response_text,responded_at,status")
        .eq("organization_id", tenantId)
        .in("prescription_id", prescriptionIds)
        .eq("status", "responded")
        .order("responded_at", { ascending: false })),
    ]);
    return {
      validations,
      prescriptions: prescriptions as PrescriptionRow[],
      items: items as unknown as ItemRow[],
      findings: findings as FindingRow[],
      ocr: ocr as OcrRow[],
      evidence: evidence as EvidenceRow[],
      files: files as FileRow[],
      clarifications: clarifications as ClarificationRow[],
    };
  }

  async list(tenantId: string): Promise<readonly PharmacistReviewSummary[]> {
    const records = await this.records(tenantId, true);
    return records.validations.map((validation) => {
      const prescription = records.prescriptions.find(
        ({ id }) => id === validation.prescription_id,
      );
      const items = records.items.filter(
        ({ prescription_id }) =>
          prescription_id === validation.prescription_id,
      );
      const findings = records.findings.filter(
        ({ validation_id }) => validation_id === validation.id,
      );
      return {
        id: validation.id,
        prescriptionId: validation.prescription_id,
        medicineNames: items.map(({ raw_medicine_text }) => raw_medicine_text),
        patientReference: patientReference(prescription?.patient_id ?? ""),
        priority: priority(findings),
        reason: findings[0]?.title ?? "Independent pharmacist review required",
        status: validation.status,
        createdAt: validation.created_at,
      };
    });
  }

  async find(
    tenantId: string,
    reviewId: string,
  ): Promise<PharmacistReviewDetail | null> {
    const records = await this.records(tenantId, false, reviewId);
    const validation = records.validations.find(({ id }) => id === reviewId);
    if (!validation) return null;
    const prescription = records.prescriptions.find(
      ({ id }) => id === validation.prescription_id,
    );
    const items = records.items.filter(
      ({ prescription_id }) => prescription_id === validation.prescription_id,
    );
    const findings = records.findings.filter(
      ({ validation_id }) => validation_id === validation.id,
    );
    const source = records.files.find(
      ({ prescription_id }) => prescription_id === validation.prescription_id,
    );
    let sourceDocument: PharmacistReviewDetail["sourceDocument"] = null;
    if (source) {
      const signed = await this.database.storage.from(source.storage_bucket)
        .createSignedUrl(source.storage_object_path, 300);
      if (signed.error || !signed.data) {
        throw new RuntimeError(
          "infrastructure",
          "clinical_source_document_failed",
          "The prescription source document could not be opened",
          503,
          true,
          "Retry later.",
          { cause: signed.error },
        );
      }
      sourceDocument = {
        signedUrl: signed.data.signedUrl,
        mediaType: source.media_type,
      };
    }
    const clarification = records.clarifications.find(
      ({ prescription_id }) => prescription_id === validation.prescription_id,
    );
    return {
      id: validation.id,
      prescriptionId: validation.prescription_id,
      medicineNames: items.map(({ raw_medicine_text }) => raw_medicine_text),
      patientReference: patientReference(prescription?.patient_id ?? ""),
      priority: priority(findings),
      reason: findings[0]?.title ?? "Independent pharmacist review required",
      status: validation.status,
      createdAt: validation.created_at,
      sourceDocument,
      prescriptionText: records.ocr.find(
        ({ prescription_id }) =>
          prescription_id === validation.prescription_id,
      )?.extracted_text ?? "",
      clinicalFlags: findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        detail: finding.detail,
        severity: finding.severity,
        requiresAcknowledgement: finding.requires_acknowledgement,
        acknowledged: Boolean(finding.acknowledged_at),
      })),
      extractedItems: items.map((item) => ({
        id: item.id,
        medicineId: item.medicine_id,
        medicineName: item.raw_medicine_text,
        strength: item.strength ?? "",
        dosage: item.dosage ?? "",
        canonicalMedicine: item.medicine ? {
          brandName: item.medicine.brand_name,
          genericName: item.medicine.generic_name,
          strength: item.medicine.strength_display,
          dosageForm: item.medicine.dosage_form,
        } : null,
      })),
      patientClarification: clarification ? {
        id: clarification.id,
        request: clarification.request_text,
        response: clarification.response_text,
        respondedAt: clarification.responded_at,
      } : null,
      evidenceHash: records.evidence.find(
        ({ validation_id }) => validation_id === validation.id,
      )?.content_sha256 ?? "",
    };
  }

  async decide(input: {
    tenantId: string;
    reviewId: string;
    pharmacistId: string;
    decision: PharmacistReviewDecision;
    rationale: string;
    acknowledgedFindingIds: readonly string[];
    reviewedItems: readonly {
      prescriptionItemId: string;
      medicineId: string;
    }[];
    idempotencyKey: string;
    correlationId: string;
    requestId: string;
  }) {
    const { data, error } = await this.database.rpc(
      "decide_prescription_validation_with_resolution",
      {
        target_organization_id: input.tenantId,
        target_validation_id: input.reviewId,
        target_decision: input.decision,
        target_rationale: input.rationale,
        target_acknowledged_finding_ids: input.acknowledgedFindingIds,
        target_reviewed_items: input.reviewedItems,
        target_idempotency_key: input.idempotencyKey,
        target_correlation_id: input.correlationId,
        target_request_id: input.requestId,
      },
    );
    if (error) {
      throw new RuntimeError(
        "business_rule",
        "pharmacist_decision_rejected",
        "The pharmacist decision could not be recorded",
        409,
        false,
        "Review the findings, license status, and current decision state.",
        { cause: error },
      );
    }
    const value = z.object({
      reviewId: z.string().uuid(),
      prescriptionId: z.string().uuid(),
      decision: z.enum(["approved", "rejected", "needs_information"]),
    }).parse(data);
    return value;
  }
}
