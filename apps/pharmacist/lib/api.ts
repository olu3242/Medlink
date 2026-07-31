export interface Review {
  id: string;
  medicineName: string;
  patientReference: string;
  priority: string;
  reason: string;
  status: string;
}

export interface ReviewDetail extends Review {
  prescriptionText: string;
  allergies: string[];
  currentMedicines: string[];
  clinicalFlags: string[];
  equivalents: { id: string; name: string; rationale: string }[];
}

export type ReviewDecision = "approved" | "rejected" | "needs_information";

const origin = process.env.MEDLINK_API_URL ?? "http://localhost:3000";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, origin), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error();
  return ((await response.json()) as { data: T }).data;
}

export const queue = () => get<Review[]>("/api/v1/review");
export const review = (id: string) =>
  get<ReviewDetail>(`/api/v1/review/${encodeURIComponent(id)}`);

// Matches PATCH /api/v1/review/{id} in apps/patient exactly: same path, same
// method, same decision enum (approved/rejected/needs_information), same
// "recommendation" field name. This app has no session of its own to
// forward on this cross-origin call yet (Wave 4 portal auth isn't built) -
// the same limitation queue()/review() above already have, not introduced
// here.
export async function decide(
  id: string,
  input: { decision: ReviewDecision; recommendation: string },
): Promise<void> {
  const response = await fetch(
    new URL(`/api/v1/review/${encodeURIComponent(id)}`, origin),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error();
}
