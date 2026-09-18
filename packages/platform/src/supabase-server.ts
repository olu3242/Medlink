import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { z } from "zod";

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

// Canonical auth-flow server client (magic-link request + callback code
// exchange, session cookie establish/refresh) for every persona app. Reused
// verbatim -- not re-implemented -- by apps/web, apps/patient,
// apps/pharmacist, and apps/pharmacy's own `lib/supabase/server.ts` (each
// re-exports this under its existing `createSupabaseServerClient` name so
// none of their call sites change), in addition to apps/admin's direct use
// below. Ordinary domain reads/writes in each app still go through that
// app's own API routes; this client's only job is the session cookie.
export async function createPersonaSupabaseServerClient() {
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
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Middleware refreshes cookies when this runs in a Server Component.
          }
        },
      },
    },
  );
}
