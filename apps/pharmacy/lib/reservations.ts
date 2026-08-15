import { createHash, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RuntimeError, type RuntimeContext } from "@medlink/runtime";
import { z } from "zod";

// Same wrapper apps/patient/lib/application.ts's result() uses for every
// other decision RPC in this codebase (create_mar, decide_clinical_review,
// reserve_inventory): a thrown Postgres/RPC error becomes a safe,
// generic RuntimeError rather than a raw database error reaching the
// client. This does not differentiate error categories by HTTP status --
// consistent with every sibling RPC call already in the codebase, not a
// gap introduced here.
async function result<T>(
  query: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) {
    throw new RuntimeError(
      "infrastructure",
      "database_operation_failed",
      "The data operation could not be completed",
      503,
      true,
      "Retry later.",
      { cause: error },
    );
  }
  return data;
}

// External contract: the UI says "Decline"; the domain has no "declined"
// state, only "cancelled" (reservation_status already defines
// pending/confirmed/ready/collected/cancelled/expired). "declined" exists
// only as API vocabulary and is mapped to "cancelled" below -- it is never
// persisted or added to the database enum.
export const reservationDecisionSchema = z.object({
  status: z.enum(["confirmed", "declined"]),
  reason: z.string().trim().min(1).optional(),
}).refine(
  (value) => value.status !== "declined" || (value.reason?.trim().length ?? 0) >= 3,
  { message: "A reason of at least 3 characters is required to decline a reservation", path: ["reason"] },
);

export type ReservationDecisionInput = z.infer<typeof reservationDecisionSchema>;

export async function decideReservation(
  context: RuntimeContext,
  database: SupabaseClient,
  reservationId: string,
  input: ReservationDecisionInput,
) {
  const targetStatus = input.status === "declined" ? "cancelled" : "confirmed";
  // Confirm's reason is optional -- never synthesized when absent (the
  // RPC itself receives null, not a placeholder string). Decline's reason
  // is validated here too, ahead of the RPC's own check, so a missing
  // reason on decline surfaces as an ordinary 400 validation error through
  // the ApiOperation schema rather than only as an RPC exception.
  if (targetStatus === "cancelled" && !input.reason) {
    throw new RuntimeError(
      "validation",
      "reason_required",
      "A reason is required to decline a reservation",
      400,
      false,
      "Provide a reason and retry.",
    );
  }
  return result(database.rpc("decide_reservation", {
    target_organization_id: context.organizationId,
    target_actor_id: context.userId,
    target_correlation_id: context.correlationId,
    target_request_id: context.requestId,
    target_idempotency_key: `${reservationId}:${targetStatus}`,
    target_channel: context.channel,
    target_reservation_id: reservationId,
    target_status: targetStatus,
    target_reason: input.reason ?? null,
  }));
}

// F1: pharmacy reservation inbox. Scope is organization-level, matching
// reservations_manage/reservations_read RLS exactly -- this codebase's
// schema has no per-location pharmacy-staff membership table, so an
// organization is the real, evidence-backed authorization boundary, not a
// narrower one invented for this route. RLS remains the actual enforcement;
// the explicit .eq("organization_id", ...) here is defense in depth, same
// posture as every other route in this app.
export const reservationListQuerySchema = z.object({
  status: z.enum(["pending", "confirmed", "ready"]).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export type ReservationListQuery = z.infer<typeof reservationListQuerySchema>;

interface ReservationInboxRow {
  readonly id: string;
  readonly status: string;
  readonly patient_id: string;
  readonly created_at: string;
  readonly confirmed_at: string | null;
  readonly expires_at: string;
  readonly pharmacy_location: { readonly id: string; readonly name: string } | null;
  readonly inventory_locks: ReadonlyArray<{
    readonly quantity: number;
    readonly inventory_batch: {
      readonly medicine: { readonly brand_name: string | null; readonly generic_name: string | null } | null;
    } | null;
  }>;
}

// Deliberately narrow: no raw Greenbook/NRN identity (never reaches this
// table at all -- only packages/merdp's own certification path touches
// those), no patient contact/PII (patient_profiles has no pharmacy-role
// read policy; only the opaque patientId already visible on the
// reservation row itself is exposed -- pickup identity is verified by the
// F2/F3 credential, not by handing staff a name/phone to eyeball).
export interface ReservationInboxEntry {
  readonly id: string;
  readonly status: string;
  readonly patientId: string;
  readonly medicineName: string;
  readonly pharmacyLocationName: string | null;
  readonly quantity: number | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
  readonly expiresAt: string;
}

function toInboxEntry(row: ReservationInboxRow): ReservationInboxEntry {
  const batchMedicine = row.inventory_locks[0]?.inventory_batch?.medicine;
  return {
    id: row.id,
    status: row.status,
    patientId: row.patient_id,
    medicineName: batchMedicine?.brand_name || batchMedicine?.generic_name || "Medicine",
    pharmacyLocationName: row.pharmacy_location?.name ?? null,
    quantity: row.inventory_locks[0]?.quantity ?? null,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
  };
}

export async function listReservations(
  context: RuntimeContext,
  database: SupabaseClient,
  query: ReservationListQuery,
): Promise<readonly ReservationInboxEntry[]> {
  let statement = database.from("reservations")
    .select(`
      id, status, patient_id, created_at, confirmed_at, expires_at,
      pharmacy_location:pharmacy_locations(id, name),
      inventory_locks(quantity, inventory_batch:inventory_batches(medicine:medicines(brand_name, generic_name)))
    `)
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(query.limit ?? 20);
  if (query.status) statement = statement.eq("status", query.status);
  if (query.cursor) statement = statement.lt("created_at", query.cursor);
  const rows = (await result(statement)) ?? [];
  return (rows as unknown as ReservationInboxRow[]).map(toInboxEntry);
}

// F2/F3 pickup credential. Human-enterable, cryptographically random,
// generated and hashed here in the application process -- the RPCs below
// only ever see/store/return the SHA-256 hash, never the plaintext, so it
// cannot appear in a database row, a runtime-evidence payload, or (as long
// as nothing here logs `pickupCode` itself) a server log. Alphabet
// excludes visually ambiguous characters (0/O, 1/I/L); 8 characters over a
// 32-symbol alphabet is ~40 bits of entropy, sized for a short-lived,
// single-pharmacy-interaction credential, not a long-term secret.
const PICKUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PICKUP_CODE_LENGTH = 8;

function generatePickupCode(): string {
  let code = "";
  for (let i = 0; i < PICKUP_CODE_LENGTH; i += 1) {
    code += PICKUP_CODE_ALPHABET[randomInt(PICKUP_CODE_ALPHABET.length)];
  }
  return code;
}

function hashPickupCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export interface ReadyResult {
  readonly reservation: unknown;
  // Present only when this call actually performed the confirmed->ready
  // transition. A replayed call (same idempotency key) never re-reveals a
  // plaintext code -- it was never persisted anywhere to recover.
  readonly pickupCode?: string;
}

export async function markReservationReady(
  context: RuntimeContext,
  database: SupabaseClient,
  reservationId: string,
): Promise<ReadyResult> {
  const pickupCode = generatePickupCode();
  const data = await result(database.rpc("mark_reservation_ready", {
    target_organization_id: context.organizationId,
    target_actor_id: context.userId,
    target_correlation_id: context.correlationId,
    target_request_id: context.requestId,
    target_idempotency_key: `${reservationId}:ready`,
    target_channel: context.channel,
    target_reservation_id: reservationId,
    target_pickup_code_hash: hashPickupCode(pickupCode),
  })) as { isNewTransition: boolean } & Record<string, unknown>;
  const { isNewTransition, ...reservation } = data;
  return isNewTransition ? { reservation, pickupCode } : { reservation };
}

export const collectReservationSchema = z.object({
  pickupCode: z.string().trim().min(1, "A pickup credential is required"),
});

export type CollectReservationInput = z.infer<typeof collectReservationSchema>;

export async function collectReservation(
  context: RuntimeContext,
  database: SupabaseClient,
  reservationId: string,
  input: CollectReservationInput,
) {
  return result(database.rpc("collect_reservation", {
    target_organization_id: context.organizationId,
    target_actor_id: context.userId,
    target_correlation_id: context.correlationId,
    target_request_id: context.requestId,
    target_idempotency_key: `${reservationId}:collected`,
    target_channel: context.channel,
    target_reservation_id: reservationId,
    target_pickup_code_hash: hashPickupCode(input.pickupCode),
  }));
}
