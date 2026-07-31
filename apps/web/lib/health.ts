import {
  HealthRegistry,
  HealthService,
  dependencyCheck,
} from "@medlink/runtime";
import { runtimeDiagnostics } from "@medlink/observability";
import { createSupabaseServerClient } from "./supabase/server";

const startedAt = new Date();

function configured(...names: string[]): boolean {
  return names.every((name) => Boolean(process.env[name]));
}

function createPlatformHealth(): HealthService {
  const registry = new HealthRegistry();
  registry.register(dependencyCheck({
    name: "runtime",
    category: "runtime",
    critical: true,
    check: async () => true,
  }));
  registry.register(dependencyCheck({
    name: "configuration",
    category: "configuration",
    critical: true,
    check: async () => configured(
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ),
    recoveryHint: "Provide the required runtime configuration.",
  }));
  registry.register(dependencyCheck({
    name: "authentication",
    category: "authentication",
    critical: true,
    check: async () => Boolean(await createSupabaseServerClient()),
  }));
  registry.register(dependencyCheck({
    name: "database",
    category: "database",
    critical: true,
    check: async () => {
      const database = await createSupabaseServerClient();
      const { error } = await database.from("organizations").select("id").limit(1);
      return !error;
    },
    recoveryHint: "Verify database connectivity and migration compatibility.",
  }));
  registry.register(dependencyCheck({
    name: "audit",
    category: "audit",
    critical: true,
    check: async () => {
      const database = await createSupabaseServerClient();
      const { error } = await database.from("governance_audit_events")
        .select("id").limit(1);
      return !error;
    },
    recoveryHint: "Verify the governance audit event store is reachable.",
  }));
  registry.register(dependencyCheck({
    name: "outbox",
    category: "outbox",
    critical: true,
    check: async () => {
      const database = await createSupabaseServerClient();
      const { error } = await database.from("runtime_outbox_events")
        .select("id").limit(1);
      return !error;
    },
    recoveryHint: "Verify the runtime outbox event store is reachable.",
  }));

  return new HealthService(registry, {
    service: "medlink-web",
    version: process.env.npm_package_version ?? "unknown",
    buildId: process.env.BUILD_ID ?? "development",
    environment: process.env.NODE_ENV ?? "development",
    startedAt,
  });
}

const healthService = createPlatformHealth();

export function platformHealth(): HealthService {
  return healthService;
}

export function healthRuntimeDetails(): Readonly<Record<string, number | boolean>> {
  return {
    ...runtimeDiagnostics(),
    loggerAvailable: true,
    tracingAvailable: true,
  };
}
