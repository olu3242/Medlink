import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSentinel } from "../lib/run-context";
import { personaMatrix, type MemberRole, type PersonaName } from "./matrix";

export interface CertificationPersona {
  readonly name: PersonaName;
  readonly email: string;
  readonly userId: string;
  readonly organizationId: string | null;
  readonly role: MemberRole | null;
  readonly sentinel: string;
}

export interface PersonaCertificationFixture {
  readonly runId: string;
  readonly organizationId: string;
  readonly isolationOrganizationId: string;
  readonly personas: Record<PersonaName, CertificationPersona>;
}

export async function createPersona(
  service: SupabaseClient,
  runId: string,
  name: PersonaName,
  organizationId: string,
): Promise<CertificationPersona> {
  const definition = personaMatrix[name];
  const nonce = crypto.randomUUID().slice(0, 8);
  const email = `persona-${name.replaceAll("_", "-")}-${nonce}@medlink.test`;
  const created = await service.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) {
    throw created.error ?? new Error(`Could not create ${name} persona`);
  }
  const userId = created.data.user.id;
  const sentinel = createSentinel(runId, name);
  const { error: profileError } = await service.from("user_profiles").insert({
    id: userId,
    display_name: sentinel,
  });
  if (profileError) throw profileError;
  if (definition.membershipRole) {
    const { error: membershipError } = await service.from("organization_memberships").insert({
      organization_id: organizationId,
      user_id: userId,
      role: definition.membershipRole,
    });
    if (membershipError) throw membershipError;
  }
  return {
    name,
    email,
    userId,
    organizationId: definition.membershipRole ? organizationId : null,
    role: definition.membershipRole,
    sentinel,
  };
}

export async function provisionPersonaCertificationFixture(
  supabaseUrl: string,
  serviceRoleKey: string,
  runId: string,
): Promise<PersonaCertificationFixture> {
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const organizationId = crypto.randomUUID();
  const isolationOrganizationId = crypto.randomUUID();
  const slug = runId.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 52);
  const { error: organizationError } = await service.from("organizations").insert([
    { id: organizationId, name: createSentinel(runId, "primary tenant"), slug, type: "pharmacy" },
    {
      id: isolationOrganizationId,
      name: createSentinel(runId, "isolation tenant"),
      slug: `${slug}-isolation`,
      type: "pharmacy",
    },
  ]);
  if (organizationError) throw organizationError;

  const entries = await Promise.all(
    (Object.keys(personaMatrix) as PersonaName[])
      .map(async (name) => [name, await createPersona(service, runId, name, organizationId)] as const),
  );
  return {
    runId,
    organizationId,
    isolationOrganizationId,
    personas: Object.fromEntries(entries) as Record<PersonaName, CertificationPersona>,
  };
}
