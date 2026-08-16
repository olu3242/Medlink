import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dispatch = vi.fn(async () => undefined);

vi.mock("@medlink/notifications", () => ({
  buildReservationNotificationDispatcher: vi.fn(() => ({ dispatch })),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({})),
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  WHATSAPP_ACCESS_TOKEN: "whatsapp-token",
  MEDLINK_NOTIFICATION_WORKER_TOKEN: "a".repeat(32),
};

describe("POST /api/internal/notification-dispatch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    dispatch.mockClear();
    Object.assign(process.env, ENV);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 503 when the worker is not configured", async () => {
    delete process.env.MEDLINK_NOTIFICATION_WORKER_TOKEN;
    const { POST } = await import("./route");
    const response = await POST(new Request("https://medlink.test/api/internal/notification-dispatch", {
      method: "POST",
      headers: { authorization: `Bearer ${ENV.MEDLINK_NOTIFICATION_WORKER_TOKEN}` },
    }));
    expect(response.status).toBe(503);
  });

  it("rejects a missing or wrong bearer token before touching the dispatcher", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://medlink.test/api/internal/notification-dispatch", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    }));
    expect(response.status).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches with the requested limit when authorized", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://medlink.test/api/internal/notification-dispatch", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ENV.MEDLINK_NOTIFICATION_WORKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ limit: 10 }),
    }));
    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledWith("scheduled-reservations-worker", 10);
  });
});
