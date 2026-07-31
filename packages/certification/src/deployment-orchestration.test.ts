import { describe, expect, it } from "vitest";
import {
  orchestrateDeployment,
  type DeploymentRequest,
} from "./deployment-orchestration";

const request: DeploymentRequest = {
  id: "deploy-1",
  releaseVersion: "rc1.0.0",
  previousReleaseVersion: "rc1.0.0-rc.1",
  strategy: "canary",
  environment: {
    name: "production",
    configurationVersion: "3",
    secretsReference: "vault://medlink/prod",
    databaseVersion: "15",
    migrationVersion: "14",
    runtimeVersion: "1",
    workflowVersion: "1",
    certificationStatus: "certified",
    deploymentHistory: [],
  },
  validations: {
    runtime: true,
    schema_compatibility: true,
    migration: true,
    security: true,
    clinical: true,
    tenant_isolation: true,
  },
  smokeTestsPassed: true,
  healthVerified: true,
  releaseApprovalEvidenceSha256: "a".repeat(64),
};

describe("deployment orchestration", () => {
  it("completes only a fully certified deployment", () => {
    expect(orchestrateDeployment(request).status).toBe("completed");
  });

  it("aborts immediately on mandatory validation failure", () => {
    const result = orchestrateDeployment({
      ...request,
      validations: { ...request.validations, tenant_isolation: false },
    });
    expect(result.status).toBe("aborted");
    expect(result.blockers).toContain("validation_failed:tenant_isolation");
  });

  it("does not promote an uncertified environment", () => {
    const result = orchestrateDeployment({
      ...request,
      environment: { ...request.environment, certificationStatus: "degraded" },
    });
    expect(result.dashboard.currentRelease).toBe(request.previousReleaseVersion);
  });
});
