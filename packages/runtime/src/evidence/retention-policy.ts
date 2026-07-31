import type { RetentionClass } from "./evidence-types";

export interface RetentionPolicy {
  retentionClass: RetentionClass;
  durationDays?: number;
  archive: boolean;
}

export class RetentionPolicyRegistry {
  private readonly policies = new Map<RetentionClass, RetentionPolicy>();
  register(policy: RetentionPolicy): void {
    this.policies.set(policy.retentionClass, Object.freeze({ ...policy }));
  }
  get(retentionClass: RetentionClass): RetentionPolicy | undefined {
    return this.policies.get(retentionClass);
  }
  expiresAt(timestamp: string, retentionClass: RetentionClass): string | undefined {
    const days = this.get(retentionClass)?.durationDays;
    if (days === undefined) return undefined;
    return new Date(new Date(timestamp).getTime() + days * 86_400_000).toISOString();
  }
}
