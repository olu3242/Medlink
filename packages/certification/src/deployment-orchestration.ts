import type { CertificationArtifact } from "./artifact-repository";

export type DeploymentStrategy =
  | "blue_green" | "rolling" | "canary" | "regional" | "tenant_specific"
  | "emergency_hotfix" | "rollback" | "feature_flag" | "shadow"
  | "progressive_rollout";

export type DeploymentEnvironment =
  | "development" | "qa" | "certification" | "staging" | "pre_production"
  | "production" | "disaster_recovery" | "training" | "demo" | "sandbox";

export type DeploymentValidation =
  | "runtime" | "schema_compatibility" | "migration" | "security" | "clinical"
  | "tenant_isolation";

export interface EnvironmentRecord {
  readonly name: DeploymentEnvironment;
  readonly configurationVersion: string;
  readonly secretsReference: string;
  readonly databaseVersion: string;
  readonly migrationVersion: string;
  readonly runtimeVersion: string;
  readonly workflowVersion: string;
  readonly certificationStatus: "certified" | "degraded" | "uncertified";
  readonly deploymentHistory: readonly string[];
}

export interface DeploymentRequest {
  readonly id: string;
  readonly releaseVersion: string;
  readonly previousReleaseVersion: string;
  readonly strategy: DeploymentStrategy;
  readonly environment: EnvironmentRecord;
  readonly validations: Readonly<Record<DeploymentValidation, boolean>>;
  readonly smokeTestsPassed: boolean;
  readonly healthVerified: boolean;
  readonly releaseApprovalEvidenceSha256: string;
}

export interface DeploymentDecision {
  readonly status: "completed" | "aborted";
  readonly blockers: readonly string[];
  readonly certificationUpdate: "pass" | "fail";
  readonly dashboard: {
    readonly currentRelease: string;
    readonly previousRelease: string;
    readonly environmentStatus: "healthy" | "blocked";
    readonly deploymentHealth: "healthy" | "failed";
  };
}

const requiredValidations: readonly DeploymentValidation[] = [
  "runtime", "schema_compatibility", "migration", "security", "clinical",
  "tenant_isolation",
];

export function orchestrateDeployment(request: DeploymentRequest): DeploymentDecision {
  const blockers = requiredValidations
    .filter((gate) => !request.validations[gate])
    .map((gate) => `validation_failed:${gate}`);
  if (request.environment.certificationStatus !== "certified") {
    blockers.push("environment_not_certified");
  }
  if (!/^[a-f0-9]{64}$/i.test(request.releaseApprovalEvidenceSha256)) {
    blockers.push("release_approval_invalid");
  }
  if (!request.smokeTestsPassed) blockers.push("smoke_tests_failed");
  if (!request.healthVerified) blockers.push("health_verification_failed");
  const allowed = blockers.length === 0;
  return {
    status: allowed ? "completed" : "aborted",
    blockers,
    certificationUpdate: allowed ? "pass" : "fail",
    dashboard: {
      currentRelease: allowed
        ? request.releaseVersion
        : request.previousReleaseVersion,
      previousRelease: request.previousReleaseVersion,
      environmentStatus: allowed ? "healthy" : "blocked",
      deploymentHealth: allowed ? "healthy" : "failed",
    },
  };
}

export type RollbackScope =
  | "automatic" | "manual" | "partial" | "database" | "configuration"
  | "feature" | "provider";

export interface RollbackRecord {
  readonly deploymentId: string;
  readonly scope: RollbackScope;
  readonly authorizedBy: string;
  readonly evidence: CertificationArtifact;
  readonly completed: boolean;
}

export function validateRollback(record: RollbackRecord): boolean {
  return record.authorizedBy.trim() !== ""
    && record.completed
    && record.evidence.status === "pass"
    && /^[a-f0-9]{64}$/i.test(record.evidence.evidenceHash);
}
