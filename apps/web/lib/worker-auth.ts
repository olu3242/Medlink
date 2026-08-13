import { timingSafeEqual } from "node:crypto";

export function authorizedWorkerRequest(request: Request, expected: string) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice(7));
  const configured = Buffer.from(expected);
  return supplied.length === configured.length
    && timingSafeEqual(supplied, configured);
}
