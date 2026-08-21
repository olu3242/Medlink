import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getServerEnvironment,
  getSupabaseServiceRoleEnvironment,
} from "./env";
import { createSupabaseServiceRoleClient } from "./supabase/service-role";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("server environment boundaries", () => {
  it("constructs the Supabase service-role client without unrelated WhatsApp secrets", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");

    expect(getSupabaseServiceRoleEnvironment()).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    });
    expect(createSupabaseServiceRoleClient()).toBeDefined();
  });

  it("continues to require WhatsApp secrets at the webhook environment boundary", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("WHATSAPP_APP_SECRET", "");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");

    expect(() => getServerEnvironment()).toThrow();
  });

  it("accepts the complete webhook server environment", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("WHATSAPP_APP_SECRET", "app-secret");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "verify-token");

    expect(getServerEnvironment()).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      WHATSAPP_APP_SECRET: "app-secret",
      WHATSAPP_VERIFY_TOKEN: "verify-token",
    });
  });
});
