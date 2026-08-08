import { z } from "zod";

export const idempotencyKeySchema = z.string().min(8).max(200);

export const createReservationCommandSchema = z.object({
  marId: z.string().uuid(),
  pharmacyLocationId: z.string().uuid(),
  inventoryBatchId: z.string().uuid(),
  quantity: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  idempotencyKey: idempotencyKeySchema,
});

export type CreateReservationCommand = z.infer<typeof createReservationCommandSchema>;

export const reservationDecisionSchema = z.object({
  decision: z.enum(["confirmed", "declined"]),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: idempotencyKeySchema,
});

export type ReservationDecisionCommand = z.infer<typeof reservationDecisionSchema>;

export function requestIdempotencyKey(request: Request): string | null {
  return request.headers.get("idempotency-key");
}
