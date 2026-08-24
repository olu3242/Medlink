import pino, { type Logger } from "pino";

export interface MedLinkLoggerEnvironment {
  readonly LOG_LEVEL?: string | undefined;
  readonly NODE_ENV?: string | undefined;
}

export interface MedLinkLoggerOptions {
  readonly environment?: MedLinkLoggerEnvironment;
  readonly customLevels?: Readonly<Record<string, number>>;
}

const fallbackLogLevel = "info";

export function resolveMedLinkLogLevel(
  environment: MedLinkLoggerEnvironment = process.env,
  customLevels: Readonly<Record<string, number>> = {},
): string {
  const configured = environment.LOG_LEVEL?.trim();
  if (!configured) return fallbackLogLevel;

  const supportedLevels = new Set([
    ...Object.keys(pino.levels.values),
    "silent",
    ...Object.keys(customLevels),
  ]);
  if (!supportedLevels.has(configured)) {
    throw new Error(
      `LOG_LEVEL "${configured}" is unsupported. Supported levels: ${[...supportedLevels].sort().join(", ")}`,
    );
  }
  return configured;
}

export function createMedLinkLogger(options: MedLinkLoggerOptions = {}): Logger<string, false> {
  const environment = options.environment ?? process.env;
  const customLevels = options.customLevels ?? {};
  return pino<string, false>({
    level: resolveMedLinkLogLevel(environment, customLevels),
    customLevels,
    useOnlyCustomLevels: false as const,
    base: { service: "medlink" },
    redact: {
      paths: ["password", "token", "authorization", "*.password"],
      censor: "[REDACTED]",
    },
  });
}
