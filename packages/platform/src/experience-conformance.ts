export type ConformanceSeverity = "error" | "warning";
export interface ConformanceFinding { readonly rule: string; readonly severity: ConformanceSeverity; readonly file: string; readonly detail: string; }
export interface ConformanceSource { readonly file: string; readonly content: string; }
export interface ExperienceConformanceInput { readonly portalLayouts: readonly ConformanceSource[]; readonly reactSources: readonly ConformanceSource[]; readonly apiRoutes: readonly ConformanceSource[]; }

export function evaluateExperienceConformance(input: ExperienceConformanceInput): readonly ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const source of input.portalLayouts) {
    if (!source.content.includes("AppShell")) findings.push({ rule: "shared-app-shell", severity: "error", file: source.file, detail: "Operational portal layout must render AppShell." });
  }
  for (const source of input.reactSources) {
    if (/@supabase|createServerClient|createBrowserClient|\.from\s*\(|\.rpc\s*\(/.test(source.content)) findings.push({ rule: "no-client-database-access", severity: "error", file: source.file, detail: "React components must use versioned runtime APIs, never database clients." });
  }
  for (const source of input.apiRoutes) {
    const hasRuntimeBoundary = /run(?:Experience)?Api\s*\(/.test(source.content);
    if (!hasRuntimeBoundary) findings.push({ rule: "runtime-boundary", severity: "error", file: source.file, detail: "Versioned API routes must execute through runApi or runExperienceApi." });
    else if (!source.content.includes("runExperienceApi")) findings.push({ rule: "experience-registry-adoption", severity: "warning", file: source.file, detail: "Route uses runApi but has not yet adopted a registered experience contract." });
  }
  return findings;
}

export function blocksRelease(findings: readonly ConformanceFinding[]): boolean {
  return findings.some(({ severity }) => severity === "error");
}
