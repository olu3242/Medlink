import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

// Auth-flow-only client (password/OTP requests, callback exchange, and recovery).
// Ordinary domain reads/writes still go through this app's own API
// routes (lib/reservations.ts, lib/api.ts) -- this client's only job is
// establishing/refreshing the session cookie itself, matching
// apps/web/lib/supabase/server.ts's identical pattern.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const environment = environmentSchema.parse(process.env);

  return createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server components cannot set cookies. Middleware refreshes sessions.
          }
        },
      },
    },
  );
}
