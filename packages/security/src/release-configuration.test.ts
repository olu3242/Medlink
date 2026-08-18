import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const requiredReleaseVariables = [
  "NEXT_PUBLIC_APP_URL",
  "MEDLINK_APP_URL",
  "MEDLINK_API_URL",
  "MEDLINK_PHARMACIST_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "MEDLINK_PAYMENT_PROVIDER_URL",
  "MEDLINK_PAYMENT_PROVIDER_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "MEDLINK_PAYMENT_REFUND_WORKER_TOKEN",
  "MEDLINK_FILE_SCANNER_URL",
  "MEDLINK_CLINICAL_WORKER_TOKEN",
  "MEDLINK_OCR_PROVIDER_URL",
  "MEDLINK_PARSER_PROVIDER_URL",
  "MEDLINK_INVENTORY_WORKER_TOKEN",
  "MEDLINK_NOTIFICATION_WORKER_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

const serverOnlyVariables = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "MEDLINK_PAYMENT_PROVIDER_KEY",
  "PAYMENT_WEBHOOK_SECRET",
  "MEDLINK_PAYMENT_REFUND_WORKER_TOKEN",
  "MEDLINK_FILE_SCANNER_TOKEN",
  "MEDLINK_CLINICAL_WORKER_TOKEN",
  "MEDLINK_OCR_PROVIDER_TOKEN",
  "MEDLINK_PARSER_PROVIDER_TOKEN",
  "MEDLINK_INVENTORY_WORKER_TOKEN",
  "MEDLINK_NOTIFICATION_WORKER_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

describe("RC1 release configuration contract", () => {
  const template = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
  const declared = new Set(
    template
      .split(/\r?\n/u)
      .filter((line) => /^[A-Z][A-Z0-9_]*=/u.test(line))
      .map((line) => line.slice(0, line.indexOf("="))),
  );

  it("documents every release-critical runtime and worker variable", () => {
    expect(requiredReleaseVariables.filter((name) => !declared.has(name))).toEqual([]);
  });

  it("keeps every secret-bearing variable server-only", () => {
    expect(serverOnlyVariables.filter((name) => name.startsWith("NEXT_PUBLIC_"))).toEqual([]);
    expect(serverOnlyVariables.filter((name) => !declared.has(name))).toEqual([]);
  });
});
