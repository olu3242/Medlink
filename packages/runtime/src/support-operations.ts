export type SupportStatus =
  | "new" | "triage" | "assigned" | "investigation" | "resolution"
  | "verification" | "closure" | "postmortem";

export type SupportDomain =
  | "technical" | "clinical" | "pharmacy" | "patient" | "infrastructure"
  | "identity" | "payments" | "messaging" | "inventory" | "ai"
  | "compliance";

export interface SupportTicket {
  readonly id: string;
  readonly tenantId: string;
  readonly domain: SupportDomain;
  readonly status: SupportStatus;
  readonly priority: 1 | 2 | 3 | 4;
  readonly impact: 1 | 2 | 3 | 4;
  readonly urgency: 1 | 2 | 3 | 4;
  readonly responseDeadline: Date;
  readonly resolutionDeadline: Date;
  readonly respondedAt?: Date;
  readonly resolvedAt?: Date;
  readonly verified: boolean;
  readonly knowledgeUpdates: readonly string[];
}

const transitions: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = {
  new: ["triage"],
  triage: ["assigned"],
  assigned: ["investigation"],
  investigation: ["resolution"],
  resolution: ["verification"],
  verification: ["closure", "investigation"],
  closure: ["postmortem"],
  postmortem: [],
};

export function transitionSupportTicket(
  ticket: SupportTicket,
  status: SupportStatus,
): SupportTicket {
  if (!transitions[ticket.status].includes(status)) {
    throw new Error(`Invalid support transition: ${ticket.status} -> ${status}`);
  }
  if (status === "closure"
    && (!ticket.verified || ticket.knowledgeUpdates.length === 0)) {
    throw new Error("Verified resolution and knowledge capture are required");
  }
  return { ...ticket, status };
}

export function evaluateSupportSla(ticket: SupportTicket, now: Date): {
  readonly violated: boolean;
  readonly escalationRequired: boolean;
  readonly reasons: readonly string[];
  readonly queueRisk: "normal" | "elevated" | "critical";
} {
  const reasons: string[] = [];
  if (!ticket.respondedAt && now > ticket.responseDeadline) reasons.push("response_overdue");
  if (!ticket.resolvedAt && now > ticket.resolutionDeadline) reasons.push("resolution_overdue");
  const score = ticket.priority + ticket.impact + ticket.urgency;
  return {
    violated: reasons.length > 0,
    escalationRequired: reasons.length > 0,
    reasons,
    queueRisk: score <= 4 ? "normal" : score <= 8 ? "elevated" : "critical",
  };
}
