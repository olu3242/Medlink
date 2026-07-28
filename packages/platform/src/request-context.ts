import { z } from "zod";
import { roles } from "./roles";

export const requestContextSchema = z.object({
  correlationId: z.string().uuid(),
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  role: z.enum(roles),
});

export type RequestContext = z.infer<typeof requestContextSchema>;

export function parseRequestContext(value: unknown): RequestContext {
  return requestContextSchema.parse(value);
}
