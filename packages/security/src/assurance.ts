export interface SourceArtifact {
  readonly path: string;
  readonly content: string;
}

export interface SecurityFinding {
  readonly rule: "embedded_secret" | "private_key" | "unsafe_url";
  readonly path: string;
}

const secretAssignment =
  /\b(password|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["'][^"'${}]{12,}["']/i;

export function scanSource(artifacts: readonly SourceArtifact[]): readonly SecurityFinding[] {
  return artifacts.flatMap((artifact) => {
    const findings: SecurityFinding[] = [];
    if (secretAssignment.test(artifact.content)) {
      findings.push({ rule: "embedded_secret", path: artifact.path });
    }
    if (/-----begin (rsa |ec |openssh )?private key-----/i.test(artifact.content)) {
      findings.push({ rule: "private_key", path: artifact.path });
    }
    if (/\bhttp:\/\/(?!localhost|127\.0\.0\.1)/i.test(artifact.content)) {
      findings.push({ rule: "unsafe_url", path: artifact.path });
    }
    return findings;
  });
}

export interface DependencyAdvisory {
  readonly package: string;
  readonly severity: "low" | "moderate" | "high" | "critical";
  readonly production: boolean;
}

export function releaseBlockingAdvisories(
  advisories: readonly DependencyAdvisory[],
): readonly DependencyAdvisory[] {
  return advisories.filter((advisory) =>
    advisory.production
    && (advisory.severity === "high" || advisory.severity === "critical"),
  );
}
