import { z } from "zod";

export const e2eTargets = ["local", "preview", "staging"] as const;
export type E2ETarget = typeof e2eTargets[number];

export interface E2EOrigins {
  readonly patient: string;
  readonly pharmacy: string;
  readonly pharmacist: string;
  readonly web: string;
  readonly provider: string;
}

export interface E2ETargetConfiguration {
  readonly target: E2ETarget;
  readonly origins: E2EOrigins;
}

const targetSchema = z.enum(e2eTargets);
const urlSchema = z.string().url();

const localOrigins: E2EOrigins = {
  patient: "http://localhost:3000",
  pharmacy: "http://localhost:3002",
  pharmacist: "http://localhost:3003",
  web: "http://localhost:3004",
  provider: "http://127.0.0.1:4010",
};

function configuredUrl(
  environment: Readonly<Record<string, string | undefined>>,
  target: E2ETarget,
  app: keyof E2EOrigins,
): string | undefined {
  const targetKey = `MEDLINK_E2E_${target.toUpperCase()}_${app.toUpperCase()}_URL`;
  const sharedKey = `MEDLINK_E2E_${app.toUpperCase()}_URL`;
  return environment[targetKey] ?? environment[sharedKey];
}

export function resolveTarget(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): E2ETargetConfiguration {
  const target = targetSchema.parse(environment.E2E_TARGET ?? "local");
  const origins = Object.fromEntries(
    (Object.keys(localOrigins) as Array<keyof E2EOrigins>).map((app) => {
      const configured = configuredUrl(environment, target, app);
      if (target !== "local" && !configured && app !== "provider") {
        throw new Error(
          `E2E_TARGET=${target} requires MEDLINK_E2E_${target.toUpperCase()}_${app.toUpperCase()}_URL`,
        );
      }
      return [app, urlSchema.parse(configured ?? localOrigins[app])];
    }),
  ) as unknown as E2EOrigins;
  return { target, origins };
}

export function applyTargetToEnvironment(configuration: E2ETargetConfiguration): void {
  for (const [app, origin] of Object.entries(configuration.origins)) {
    process.env[`MEDLINK_E2E_${app.toUpperCase()}_URL`] = origin;
  }
  process.env.MEDLINK_E2E_TARGET = configuration.target;
}
