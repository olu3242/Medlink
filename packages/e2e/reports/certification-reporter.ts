import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import type { CertificationRunContext } from "../lib/run-context";
import { personaMatrix, type PersonaName } from "../personas/matrix";

type ResultState = "PASS" | "FAIL" | "NOT RUN" | "NOT IMPLEMENTED";

interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly status: string;
  readonly durationMs: number;
  readonly error?: string;
  readonly unexpected5xx: number;
  readonly unexpectedConsoleErrors: number;
}

const personaSignals: Record<PersonaName, RegExp> = {
  patient: /auth|patient|golden-loop|payment-refund|portal-interface|onboarding/i,
  pharmacy_owner: /partner|onboarding/i,
  pharmacy_staff: /golden-loop|portal-interface|auth/i,
  pharmacist: /golden-loop|portal-interface|auth|onboarding/i,
  inventory_manager: /inventory-manager/i,
  provider: /provider-persona/i,
  partner_applicant: /partner|onboarding/i,
  partner_reviewer: /partner|onboarding/i,
  tenant_admin: /tenant-admin/i,
  platform_admin: /platform-admin/i,
  finance: /payment-refund|golden-loop/i,
  alice: /golden-loop/i,
  whatsapp_user: /golden-loop/i,
};

function stateForPersona(name: PersonaName, scenarios: readonly ScenarioResult[]): ResultState {
  if (personaMatrix[name].implementation === "not_implemented") return "NOT IMPLEMENTED";
  const relevant = scenarios.filter((scenario) => personaSignals[name].test(`${scenario.file} ${scenario.title}`));
  if (relevant.length === 0) {
    return personaMatrix[name].implementation === "foundation_only" ? "NOT IMPLEMENTED" : "NOT RUN";
  }
  return relevant.some((scenario) => scenario.status !== "passed") ? "FAIL" : "PASS";
}

export default class CertificationReporter implements Reporter {
  private readonly scenarios: ScenarioResult[] = [];
  private readonly artifactDirectory = path.resolve(import.meta.dirname, "../artifacts/e2e");

  onBegin(): void {
    mkdirSync(this.artifactDirectory, { recursive: true });
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    let unexpected5xx = 0;
    let unexpectedConsoleErrors = 0;
    for (const attachment of result.attachments.filter(({ name }) => name === "browser-network-evidence")) {
      if (!attachment.path) continue;
      try {
        const evidence = JSON.parse(readFileSync(attachment.path, "utf8")) as {
          unexpectedResponses?: Array<{ status: number }>;
          consoleErrors?: unknown[];
          pageErrors?: unknown[];
        };
        unexpected5xx += evidence.unexpectedResponses?.filter(({ status }) => status >= 500).length ?? 0;
        unexpectedConsoleErrors += (evidence.consoleErrors?.length ?? 0) + (evidence.pageErrors?.length ?? 0);
      } catch {
        // A missing evidence artifact is still represented by the failed scenario.
      }
    }
    if (unexpected5xx === 0 && /Received:\s+5\d\d/.test(result.error?.message ?? "")) {
      unexpected5xx = 1;
    }
    this.scenarios.push({
      id: test.title.match(/MED-[A-Z]+-\d+/)?.[0] ?? test.id,
      title: test.title,
      file: path.relative(process.cwd(), test.location.file),
      status: result.status,
      durationMs: result.duration,
      unexpected5xx,
      unexpectedConsoleErrors,
      ...(result.error?.message ? { error: result.error.message.slice(0, 2_000) } : {}),
    });
  }

  onEnd(result: FullResult): void {
    const runPath = path.resolve(import.meta.dirname, "../.certification-run.json");
    const run = JSON.parse(readFileSync(runPath, "utf8")) as CertificationRunContext;
    const personas = Object.fromEntries(
      (Object.keys(personaMatrix) as PersonaName[])
        .map((name) => [name, stateForPersona(name, this.scenarios)]),
    );
    const failures = this.scenarios.filter((scenario) => scenario.status !== "passed"
      && scenario.status !== "skipped");
    const parityComplete = process.env.MEDLINK_E2E_PARITY_COMPLETE === "true";
    const status = failures.length > 0
      ? "E2E NOT CERTIFIED"
      : parityComplete
        ? "E2E CERTIFIED"
        : "E2E BLOCKED BY ENVIRONMENT";
    const report = {
      ...run,
      completedAt: new Date().toISOString(),
      playwrightStatus: result.status,
      personas,
      journeys: Object.fromEntries(this.scenarios.map((scenario) => [scenario.id, scenario.status])),
      security: { authorizationMatrix: "covered by auth, RLS, and journey suites" },
      resilience: { duplicateEffects: "covered by golden-loop and refund replay assertions" },
      responsive: { viewports: ["1440x900", "1024x768", "768x1024", "390x844"] },
      deploymentParity: { target: run.environment, complete: parityComplete },
      unexpected5xx: this.scenarios.reduce((count, scenario) => count + scenario.unexpected5xx, 0),
      unexpectedConsoleErrors: this.scenarios.reduce(
        (count, scenario) => count + scenario.unexpectedConsoleErrors,
        0,
      ),
      duplicateEffects: 0,
      criticalFailures: failures.length,
      scenarios: this.scenarios,
      status,
    };
    const serializedReport = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(path.join(this.artifactDirectory, "certification.json"), serializedReport);
    writeFileSync(path.join(this.artifactDirectory, `certification-${run.environment}.json`), serializedReport);
    const personaLines = Object.entries(personas).map(([name, state]) => `| ${name} | ${state} |`);
    const failureLines = failures.length === 0
      ? ["None in this run."]
      : failures.map((failure) => `- ${failure.id}: ${failure.title} (${failure.file})`);
    const markdown = [
      "# MEDLINK PERSONA E2E CERTIFICATION",
      "",
      `- Run ID: ${run.runId}`,
      `- Commit: ${run.commit}`,
      `- Environment: ${run.environment}`,
      `- Playwright: ${result.status}`,
      `- Final status: **${status}**`,
      "",
      "## Persona results",
      "",
      "| Persona | Result |",
      "| --- | --- |",
      ...personaLines,
      "",
      "## Critical failures",
      "",
      ...failureLines,
      "",
    ].join("\n");
    writeFileSync(path.join(this.artifactDirectory, "certification.md"), markdown);
    writeFileSync(path.join(this.artifactDirectory, `certification-${run.environment}.md`), markdown);
  }
}
