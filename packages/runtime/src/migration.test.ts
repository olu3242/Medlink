import { readFileSync as readRawFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readFileSync(path: string, encoding: "utf8"): string {
  return readRawFileSync(path, encoding).replaceAll("\r\n", "\n");
}

describe("transactional runtime migration", () => {
  const sql = readFileSync(join(
    process.cwd(),
    "supabase",
    "migrations",
    "202607270006_transactional_runtime.sql",
  ), "utf8").toLowerCase();

  it("defines durable tenant-scoped evidence and recovery stores", () => {
    for (const table of [
      "runtime_outbox_events",
      "runtime_idempotency_keys",
      "runtime_dead_letters",
    ]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("records audit and outbox evidence in one database function", () => {
    expect(sql).toContain("function public.record_runtime_evidence");
    expect(sql).toContain("insert into public.runtime_outbox_events");
    expect(sql).toContain("insert into public.governance_audit_events");
    expect(sql).not.toContain("commit;");
  });
});

describe("use case transactional commit migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290008_use_case_transactional_commits.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("commits business state and runtime evidence in one function per use case", () => {
    for (const [fn, table] of [
      ["create_medicine_record", "insert into public.medicines"],
      ["update_medicine_record", "update public.medicines"],
      ["create_prescription_record", "insert into public.prescriptions"],
    ] as const) {
      expect(sql).toContain(`function public.${fn}`);
      expect(sql).toContain(table);
    }
    const occurrences = sql.split("public.record_runtime_evidence(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).not.toContain("commit;");
  });

  it("re-enforces the equivalent RLS authorization inside each SECURITY DEFINER function", () => {
    expect(sql).toContain("public.is_platform_admin()");
    expect(sql).toContain("public.is_organization_member(target_organization_id)");
    expect(sql).toContain("public.has_organization_role(");
  });
});

describe("wave 2 batch commit migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260729000901_wave2_batch_commits.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("commits business state, child rows, and runtime evidence in one function per use case", () => {
    for (const [fn, tables] of [
      ["review_medicine_equivalence", ["insert into public.tenant_equivalence_reviews"]],
      [
        "record_clinical_validation",
        [
          "insert into public.clinical_validations",
          "insert into public.clinical_findings",
        ],
      ],
      [
        "record_prescription_extraction",
        [
          "insert into public.prescription_extractions",
          "insert into public.prescription_extracted_fields",
          "update public.prescriptions set status = 'needs_review'",
        ],
      ],
    ] as const) {
      expect(sql).toContain(`function public.${fn}`);
      for (const table of tables) expect(sql).toContain(table);
    }
    const occurrences = sql.split("public.record_runtime_evidence(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).not.toContain("commit;");
  });

  it("re-enforces the equivalent RLS authorization inside each SECURITY DEFINER function", () => {
    const occurrences = sql.split("public.has_organization_role(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("array['pharmacist']");
  });
});

describe("reserve_inventory migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260729001001_reserve_inventory.sql"),
    "utf8",
  ).toLowerCase();

  it("creates the reservation and its inventory lock in one function, relying on the existing lock trigger for atomicity", () => {
    expect(sql).toContain("function public.reserve_inventory");
    expect(sql).toContain("insert into public.reservations");
    expect(sql).toContain("insert into public.inventory_locks");
    expect(sql).toContain("update public.medication_access_requests");
    expect(sql).toContain("set state = 'reserved'");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("replays idempotently instead of re-executing on a repeated idempotency key", () => {
    expect(sql).toContain("where organization_id = target_organization_id");
    expect(sql).toContain("and idempotency_key = target_idempotency_key");
    expect(sql).toContain("if found then");
    expect(sql).toContain("return existing;");
  });

  it("requires the medication access request to be matched before reserving, matching the MAR state machine", () => {
    expect(sql).toContain("if mar.state <> 'matched' then");
  });

  it("re-enforces the reservations_create RLS policy inside the SECURITY DEFINER function", () => {
    expect(sql).toContain("public.is_organization_member(target_organization_id)");
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']");
  });
});

describe("generics migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290011_generics.sql"),
    "utf8",
  ).toLowerCase();

  it("defines a first-class generics table distinct from active_ingredients", () => {
    expect(sql).toContain("create table public.generics");
    expect(sql).toContain("canonical_name text not null unique");
    expect(sql).toContain("therapeutic_class_id uuid references public.therapeutic_classes(id)");
    expect(sql).toContain("alter table public.generics enable row level security");
  });

  it("links medicines to generics without dropping generic_name", () => {
    expect(sql).toContain("add column generic_id uuid references public.generics(id)");
    expect(sql).not.toContain("drop column generic_name");
  });

  it("backfills generics from existing medicines.generic_name and links medicines.generic_id", () => {
    expect(sql).toContain("insert into public.generics");
    expect(sql).toContain("group by lower(trim(medicine.generic_name))");
    expect(sql).toContain("update public.medicines medicine");
    expect(sql).toContain("set generic_id = generic.id");
  });

  it("keeps generic_id in sync going forward via a trigger, not a duplicated RPC", () => {
    expect(sql).toContain("function public.sync_medicine_generic");
    expect(sql).toContain("create trigger medicines_sync_generic");
    expect(sql).toContain("before insert or update of generic_name on public.medicines");
  });
});

describe("conversation engine migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290012_conversation_engine.sql"),
    "utf8",
  ).toLowerCase();

  it("defines the conversation aggregate and its message/event logs", () => {
    for (const table of ["conversations", "conversation_messages", "conversation_events"]) {
      expect(sql).toContain(`create table public.${table}`);
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("binds one conversation per organization/channel/channel-identity", () => {
    expect(sql).toContain("unique (organization_id, channel, channel_identity)");
  });

  it("makes the interaction/decision log append-only", () => {
    expect(sql).toContain("create trigger conversation_events_append_only");
    expect(sql).toContain("before update or delete on public.conversation_events");
    expect(sql).toContain("public.prevent_enterprise_event_mutation()");
  });
});

describe("conversation channel bindings migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290013_conversation_channel_bindings.sql"),
    "utf8",
  ).toLowerCase();

  it("defines the channel-identifier-to-organization binding table", () => {
    expect(sql).toContain("create table public.conversation_channel_bindings");
    expect(sql).toContain("alter table public.conversation_channel_bindings enable row level security");
  });

  it("makes a channel identifier globally unique per channel, not just per organization", () => {
    expect(sql).toContain("unique (channel, channel_identifier)");
  });
});

describe("retire legacy reserve_inventory overload migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "20260729001401_retire_legacy_reserve_inventory_overload.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("drops the 7-parameter overload nothing calls, keeping only the evidence-committing 11-parameter version", () => {
    expect(sql).toContain("drop function if exists public.reserve_inventory(");
    expect(sql).toContain("uuid, uuid, uuid, uuid, integer, text, timestamptz");
  });
});

describe("workflow instances migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290015_workflow_instances.sql"),
    "utf8",
  ).toLowerCase();

  it("defines durable workflow run state with RLS", () => {
    expect(sql).toContain("create table public.workflow_instances");
    expect(sql).toContain("alter table public.workflow_instances enable row level security");
  });

  it("is idempotent per organization on the workflow's idempotency key", () => {
    expect(sql).toContain("unique (organization_id, idempotency_key)");
  });
});

describe("create_mar migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290016_create_mar.sql"),
    "utf8",
  ).toLowerCase();

  it("creates the MAR and commits its runtime evidence in one function", () => {
    expect(sql).toContain("function public.create_mar");
    expect(sql).toContain("insert into public.medication_access_requests");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("replays idempotently via the mar_audit_events MAR.Created uniqueness, not a new constraint", () => {
    expect(sql).toContain("from public.mar_audit_events");
    expect(sql).toContain("and event_type = 'mar.created'");
    expect(sql).toContain("if found then");
  });

  it("re-enforces the medication_access_requests_create RLS policy inside the SECURITY DEFINER function", () => {
    expect(sql).toContain("public.is_organization_member(target_organization_id)");
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']");
  });
});

describe("decide_clinical_review migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290017_decide_clinical_review.sql"),
    "utf8",
  ).toLowerCase();

  it("commits the decision and its runtime evidence in one function", () => {
    expect(sql).toContain("function public.decide_clinical_review");
    expect(sql).toContain("update public.clinical_reviews");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("replays idempotently on the same actor repeating the same decision, rather than erroring", () => {
    expect(sql).toContain("if existing.decision <> 'pending' then");
    expect(sql).toContain("existing.decision = target_decision");
    expect(sql).toContain("existing.reviewed_by = target_actor_id");
    expect(sql).toContain("return existing;");
  });

  it("still raises for a genuine conflict: a different decision or actor on an already-decided review", () => {
    expect(sql).toContain("raise exception 'clinical review has already been decided'");
  });

  it("re-enforces the clinical_reviews_pharmacist_manage RLS policy inside the SECURITY DEFINER function", () => {
    expect(sql).toContain("array['pharmacist']::public.member_role[]");
  });
});

describe("validate_mar migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607290018_validate_mar.sql"),
    "utf8",
  ).toLowerCase();

  it("transitions created to validated and commits runtime evidence in one function", () => {
    expect(sql).toContain("function public.validate_mar");
    expect(sql).toContain("set state = 'validated'");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("replays idempotently rather than erroring on a MAR that already progressed", () => {
    expect(sql).toContain("if mar.state <> 'created' then");
    expect(sql).toContain("if mar.transition_idempotency_key = target_idempotency_key then");
    expect(sql).toContain("return mar;");
  });

  it("guards the UPDATE itself against a concurrent transition, not just the prior read", () => {
    const updateStart = sql.indexOf("update public.medication_access_requests\n  set state = 'validated'");
    const updateBody = sql.slice(updateStart, updateStart + 300);
    expect(updateBody).toContain("and state = 'created'");
  });

  it("re-enforces the medication_access_requests_update RLS policy inside the SECURITY DEFINER function", () => {
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']::public.member_role[]");
  });
});

describe("mar reviewed-on-approval migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290019_mar_reviewed_on_approval.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("advances the MAR from validated to reviewed only when the review is approved", () => {
    expect(sql).toContain("if updated.decision = 'approved' then");
    expect(sql).toContain("if found and mar.state = 'validated' then");
    expect(sql).toContain("set state = 'reviewed'");
  });

  it("does not re-raise when replaying an approval whose MAR already advanced", () => {
    expect(sql).toContain("elsif found and mar.state <> 'reviewed' and mar.state <> 'cancelled' then");
  });

  it("still commits the review decision and its runtime evidence in the same function", () => {
    expect(sql).toContain("function public.decide_clinical_review");
    expect(sql).toContain("update public.clinical_reviews");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("guards the decision UPDATE against a concurrent decide call, not just the prior read", () => {
    const updateStart = sql.indexOf("update public.clinical_reviews\n  set decision = target_decision");
    const updateBody = sql.slice(updateStart, updateStart + 400);
    expect(updateBody).toContain("and decision = 'pending'");
  });

  it("re-checks and replays or raises when the UPDATE loses the concurrency race", () => {
    const guardedUpdateEnd = sql.indexOf("if not found then");
    expect(guardedUpdateEnd).toBeGreaterThan(-1);
    const afterGuard = sql.slice(guardedUpdateEnd, guardedUpdateEnd + 400);
    expect(afterGuard).toContain("raise exception 'clinical review has already been decided'");
  });
});

describe("reserve_inventory replay validation migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290020_reserve_inventory_replay_validation.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("compares the replay payload against the stored reservation and lock before trusting the key", () => {
    expect(sql).toContain("if existing.mar_id <> target_mar_id");
    expect(sql).toContain("or existing.pharmacy_location_id <> target_pharmacy_location_id");
    expect(sql).toContain("or existing_lock.inventory_batch_id <> target_inventory_batch_id");
    expect(sql).toContain("or existing_lock.quantity <> target_quantity");
    expect(sql).toContain("raise exception 'idempotency key was already used for a different reservation'");
  });

  it("still commits the reservation, lock, MAR transition, and evidence atomically", () => {
    expect(sql).toContain("function public.reserve_inventory");
    expect(sql).toContain("insert into public.reservations");
    expect(sql).toContain("insert into public.inventory_locks");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });
});

describe("clinical_validations idempotency migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607290021_clinical_validations_idempotency.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("adds an idempotency key column and a partial unique index scoped to it", () => {
    expect(sql).toContain("alter table public.clinical_validations");
    expect(sql).toContain("add column idempotency_key text");
    expect(sql).toContain("create unique index clinical_validations_idempotency_idx");
    expect(sql).toContain("on public.clinical_validations(organization_id, idempotency_key)");
    expect(sql).toContain("where idempotency_key is not null");
  });

  it("replays idempotently before inserting a duplicate validation or its findings", () => {
    expect(sql).toContain("select * into existing from public.clinical_validations");
    expect(sql).toContain("and idempotency_key = target_idempotency_key");
    expect(sql).toContain("if found then\n    return existing;\n  end if;");
  });

  it("still inserts findings and commits runtime evidence in the same function", () => {
    expect(sql).toContain("function public.record_clinical_validation");
    expect(sql).toContain("insert into public.clinical_validations");
    expect(sql).toContain("insert into public.clinical_findings");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });
});

describe("agent memory governance migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202607310001_agent_memory_governance.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("defines tenant-scoped agent memory with RLS enabled", () => {
    expect(sql).toContain("create table public.agent_memory_entries");
    expect(sql).toContain("alter table public.agent_memory_entries enable row level security");
    expect(sql).toContain("organization_id uuid not null references public.organizations(id)");
  });

  it("requires session-scoped memory to carry an expiry, independent of the calling code", () => {
    expect(sql).toContain(
      "check (memory_boundary <> 'session' or expires_at is not null)",
    );
  });

  it("requires subject_id so the uniqueness constraint cannot be defeated by null", () => {
    expect(sql).toContain("subject_id uuid not null");
    expect(sql).toContain("unique (organization_id, agent_id, subject_id, key)");
  });

  it("has no authenticated write policy -- an agent acts through the service role", () => {
    expect(sql).not.toContain("for insert to authenticated");
    expect(sql).not.toContain("for update to authenticated");
    expect(sql).not.toContain("for all to authenticated");
  });

  it("grants authenticated platform/tenant admins read-only access for support and audit", () => {
    expect(sql).toContain("agent_memory_entries_admin_read");
    expect(sql).toContain("for select to authenticated");
    expect(sql).toContain("array['platform_admin', 'tenant_admin']::public.member_role[]");
  });
});

describe("agent escalations migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202607310002_agent_escalations.sql"),
    "utf8",
  ).toLowerCase();

  it("defines a tenant-scoped escalation table with RLS enabled", () => {
    expect(sql).toContain("create table public.agent_escalations");
    expect(sql).toContain("alter table public.agent_escalations enable row level security");
    expect(sql).toContain("status public.agent_escalation_status not null default 'pending'");
  });

  it("raises idempotently on (organization_id, idempotency_key)", () => {
    expect(sql).toContain("function public.raise_agent_escalation");
    expect(sql).toContain("unique (organization_id, idempotency_key)");
    expect(sql).toContain("where organization_id = target_organization_id and idempotency_key = target_idempotency_key");
    expect(sql).toContain("if found then\n    return existing;\n  end if;");
  });

  it("restricts deciding an escalation to a licensed pharmacist, matching decide_clinical_review", () => {
    expect(sql).toContain("function public.decide_agent_escalation");
    expect(sql).toContain("only a licensed pharmacist may decide an agent escalation");
    expect(sql).toContain("array['pharmacist']::public.member_role[]");
  });

  it("replays an already-decided escalation idempotently on matching actor/status/rationale, and rejects a conflicting redecision", () => {
    expect(sql).toContain("if existing.status <> 'pending' then");
    expect(sql).toContain("existing.status = target_status");
    expect(sql).toContain("and existing.decided_by = target_actor_id");
    expect(sql).toContain("raise exception 'agent escalation has already been decided'");
  });

  it("commits both the raise and the decision atomically with runtime evidence, never a bare commit", () => {
    expect(sql).toContain("'agent_escalation.raised'");
    expect(sql).toContain("'agent_escalation.decided'");
    const occurrences = sql.split("public.record_runtime_evidence(").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(sql).not.toContain("commit;");
  });
});

describe("runtime evidence repository migration", () => {
  const evidenceSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607280007_runtime_evidence_repository.sql"),
    "utf8",
  );

  it("defines immutable, tenant-scoped, integrity-hashed evidence", () => {
    expect(evidenceSql).toContain("create table public.runtime_evidence_records");
    expect(evidenceSql).toContain("runtime_evidence_append_only");
    expect(evidenceSql).toContain("enable row level security");
    expect(evidenceSql).toContain("integrity_hash");
    expect(evidenceSql).toContain("parent_version_id");
  });
});

describe("atomic reservation migration", () => {
  const reservationSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607280008_atomic_reservation.sql"),
    "utf8",
  ).toLowerCase();

  it("atomically locks inventory and advances only a matched MAR", () => {
    expect(reservationSql).toContain("function public.reserve_inventory");
    expect(reservationSql).toContain("for update");
    expect(reservationSql).toContain("pg_advisory_xact_lock");
    expect(reservationSql).toContain("insert into public.inventory_locks");
    expect(reservationSql).toContain("target_mar.state <> 'matched'");
    expect(reservationSql).toContain("set state = 'reserved'");
  });

  it("binds retries to the original reservation inputs", () => {
    expect(reservationSql).toContain("idempotency key was already used");
    expect(reservationSql).toContain("existing_lock.inventory_batch_id");
    expect(reservationSql).toContain("existing_lock.quantity");
  });
});

describe("payment reservation foreign-key prerequisite", () => {
  const accessSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607270003_medication_access_core.sql"),
    "utf8",
  ).toLowerCase();

  it("provides the composite reservation key referenced by payments", () => {
    const reservationsTable = accessSql.match(
      /create table public\.reservations \(([\s\S]*?)\n\);/,
    )?.[1];
    const clinicalReviewsTable = accessSql.match(
      /create table public\.clinical_reviews \(([\s\S]*?)\n\);/,
    )?.[1];

    expect(reservationsTable).toContain(
      "unique (id, organization_id, patient_id)",
    );
    expect(clinicalReviewsTable).not.toContain(
      "unique (id, organization_id, patient_id)",
    );
  });
});

describe("medicine search migration", () => {
  const clinicalSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607270002_clinical_intelligence.sql"),
    "utf8",
  ).toLowerCase();
  const searchSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290010_medicine_search.sql"),
    "utf8",
  ).toLowerCase();

  it("schema-qualifies pg_trgm functions and operators with an empty search path", () => {
    expect(clinicalSql).toContain(
      "create extension if not exists pg_trgm with schema extensions",
    );
    expect(searchSql).toContain("extensions.similarity(");
    expect(searchSql).toContain("operator(extensions.%)");
    expect(searchSql).not.toMatch(/(^|[^.])\bsimilarity\(/);
  });
});

describe("durable observability migration", () => {
  const observabilitySql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290009_durable_observability.sql"),
    "utf8",
  ).toLowerCase();

  it("persists each required operational evidence class under RLS", () => {
    for (const table of [
      "runtime_metric_points",
      "runtime_trace_spans",
      "runtime_diagnostic_events",
      "runtime_certification_reports",
    ]) {
      expect(observabilitySql).toContain(`create table public.${table}`);
      expect(observabilitySql).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("keeps metrics, completed spans, and reports immutable", () => {
    expect(observabilitySql).toContain("runtime_metric_points_append_only");
    expect(observabilitySql).toContain("runtime_trace_spans_append_only");
    expect(observabilitySql).toContain("runtime_certification_reports_append_only");
  });
});

describe("professional operations migrations", () => {
  const roleSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260729001201_professional_operations.sql"),
    "utf8",
  ).toLowerCase();
  const fulfillmentSql = readFileSync(
    join(process.cwd(), "supabase/migrations/20260729001301_fulfillment_transitions.sql"),
    "utf8",
  ).toLowerCase();

  it("adds the provider role in its own committed migration", () => {
    expect(roleSql).toContain("add value if not exists 'provider'");
    expect(roleSql).not.toContain("create policy");
  });

  it("persists immutable tenant-scoped fulfillment transitions", () => {
    expect(fulfillmentSql).toContain("create table public.fulfillment_transitions");
    expect(fulfillmentSql).toContain(
      "alter table public.fulfillment_transitions enable row level security",
    );
    expect(fulfillmentSql).toContain("fulfillment_transitions_append_only");
    expect(fulfillmentSql).toContain("unique (organization_id, idempotency_key)");
  });
});

describe("certification approval migration", () => {
  const approvalSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290014_certification_approvals.sql"),
    "utf8",
  ).toLowerCase();

  it("stores immutable signed approvals under tenant RLS", () => {
    expect(approvalSql).toContain("create table public.certification_approvals");
    expect(approvalSql).toContain("evidence_sha256");
    expect(approvalSql).toContain("algorithm = 'ed25519'");
    expect(approvalSql).toContain(
      "alter table public.certification_approvals enable row level security",
    );
    expect(approvalSql).toContain("certification_approvals_append_only");
  });
});

describe("conversation runtime system identity migration (ADR 0004)", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202608010001_conversation_runtime_system_identity.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("provisions exactly the documented, fixed system identity, idempotently", () => {
    expect(sql).toContain("insert into auth.users");
    expect(sql).toContain("'11111111-1111-4111-8111-111111111111'");
    expect(sql).toContain("on conflict (id) do nothing");
  });

  it("never sets a usable password -- this identity never logs in via GoTrue", () => {
    expect(sql).toContain("encrypted_password");
    expect(sql).not.toMatch(/encrypted_password.*\n.*'\$2/);
  });
});

describe("prescription file storage migration (G05, Engine 26)", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202608010003_prescription_file_storage.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("provisions a private bucket with size and MIME enforcement", () => {
    expect(sql).toContain("insert into storage.buckets");
    expect(sql).toContain("'prescriptions',\n  'prescriptions',\n  false,");
    expect(sql).toContain("15728640");
    expect(sql).toContain(
      "array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']",
    );
  });

  it("scopes storage RLS to the uploader's own patient folder or staff role, within tenant membership", () => {
    expect(sql).toContain("create policy prescriptions_bucket_insert");
    expect(sql).toContain("create policy prescriptions_bucket_read");
    expect(sql).toContain("public.is_organization_member(((storage.foldername(name))[1])::uuid)");
    expect(sql).toContain("(storage.foldername(name))[2] = auth.uid()::text");
    expect(sql).toContain(
      "array['platform_admin', 'tenant_admin', 'pharmacist', 'pharmacy_staff']::public.member_role[]",
    );
  });

  it("defines no update/delete policy -- an uploaded prescription image is immutable", () => {
    expect(sql).not.toContain("for update");
    expect(sql).not.toContain("for delete");
  });

  it("adds nullable checksum/mime/size columns and a per-tenant duplicate-detection index", () => {
    expect(sql).toContain("add column storage_checksum text");
    expect(sql).toContain("add column storage_mime_type text");
    expect(sql).toContain("add column storage_size_bytes bigint");
    expect(sql).toContain("create unique index prescriptions_org_checksum_idx");
    expect(sql).toContain("on public.prescriptions(organization_id, storage_checksum)");
    expect(sql).toContain("where storage_checksum is not null");
  });

  it("drops the old 11-argument signature before creating the extended one, so callers share one function", () => {
    expect(sql).toContain(
      "drop function if exists public.create_prescription_record(\n  uuid, uuid, text, text, text, text, uuid, public.prescription_source, text, text, text\n);",
    );
    expect(sql).toContain("target_storage_checksum text default null");
    expect(sql).toContain("target_storage_mime_type text default null");
    expect(sql).toContain("target_storage_size_bytes bigint default null");
  });

  it("replays the existing row on a checksum match within the same organization instead of erroring", () => {
    expect(sql).toContain("if target_storage_checksum is not null then");
    expect(sql).toContain("where organization_id = target_organization_id");
    expect(sql).toContain("and storage_checksum = target_storage_checksum");
    expect(sql).toContain("if found then\n      return existing;\n    end if;");
  });

  it("still commits the prescription and runtime evidence atomically", () => {
    expect(sql).toContain("insert into public.prescriptions (");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });
});

describe("reservation decision migration", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202608150030_reservation_decision.sql"),
    "utf8",
  ).toLowerCase();

  it("adds an optional, meaningful-if-present reason column to fulfillment_transitions rather than a second table", () => {
    expect(sql).toContain("alter table public.fulfillment_transitions");
    expect(sql).toContain("add column reason text");
    expect(sql).toContain("check (reason is null or char_length(btrim(reason)) >= 3)");
  });

  it("commits the reservation decision and its runtime evidence in one function", () => {
    expect(sql).toContain("function public.decide_reservation");
    expect(sql).toContain("update public.reservations set");
    expect(sql).toContain("insert into public.fulfillment_transitions");
    expect(sql).toContain("public.record_runtime_evidence(");
    expect(sql).not.toContain("commit;");
  });

  it("requires a meaningful reason to cancel but never synthesizes one, and allows confirm without a reason", () => {
    expect(sql).toContain("normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');");
    expect(sql).toContain("if target_status = 'cancelled' and (normalized_reason is null or char_length(normalized_reason) < 3) then");
    expect(sql).toContain("raise exception 'a meaningful reason is required to cancel a reservation';");
    expect(sql).not.toMatch(/no reason provided|'n\/a'/);
  });

  it("only requires a pending reservation, rejecting any other current status including the opposite terminal state", () => {
    expect(sql).toContain("if current_reservation.status <> 'pending' then");
    expect(sql).toContain("raise exception 'only a pending reservation may receive a pharmacy decision';");
  });

  it("replays idempotently on the same key and decision, and rejects a conflicting replay", () => {
    expect(sql).toContain("where organization_id = target_organization_id");
    expect(sql).toContain("and idempotency_key = target_idempotency_key");
    expect(sql).toContain("if prior_transition.reservation_id <> target_reservation_id");
    expect(sql).toContain("or prior_transition.to_state <> target_status then");
    expect(sql).toContain("raise exception 'idempotency key was already used for a different reservation decision';");
  });

  it("releases the inventory lock only on cancellation, leaving a confirmed reservation's lock active", () => {
    const cancelBlockStart = sql.indexOf("if target_status = 'cancelled' then\n    update public.inventory_locks");
    expect(cancelBlockStart).toBeGreaterThan(-1);
    expect(sql).toContain("set status = 'released', released_at = now()");
    expect(sql).toContain("and status = 'active';");
  });

  it("re-enforces the pharmacist/pharmacy_staff role rule already established by reservations_manage RLS", () => {
    expect(sql).toContain("public.is_organization_member(target_organization_id)");
    expect(sql).toContain("array['pharmacist', 'pharmacy_staff']::public.member_role[]");
  });

  it("grants execute to authenticated, matching every other actor-invoked decision RPC", () => {
    expect(sql).toContain("revoke all on function public.decide_reservation(");
    expect(sql).toContain("from public;");
    expect(sql).toContain("grant execute on function public.decide_reservation(");
    expect(sql).toContain("to authenticated;");
  });
});

describe("reservation fulfillment migration (F2/F3)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "202608150031_reservation_fulfillment.sql"),
    "utf8",
  ).toLowerCase();

  it("only accepts a pre-hashed pickup credential -- never a plaintext parameter", () => {
    expect(sql).toContain("target_pickup_code_hash text");
    expect(sql).not.toContain("target_pickup_code text");
  });

  it("strips pickup_code_hash from every jsonb value either function returns", () => {
    const occurrences = sql.split("- 'pickup_code_hash'").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("mark_reservation_ready only transitions a confirmed reservation, storing the hash without touching the inventory lock", () => {
    expect(sql).toContain("function public.mark_reservation_ready");
    expect(sql).toContain("if current_reservation.status <> 'confirmed' then");
    expect(sql).toContain("status = 'ready',");
    expect(sql).toContain("pickup_code_hash = target_pickup_code_hash");
    const readyFnStart = sql.indexOf("create or replace function public.mark_reservation_ready");
    const collectFnStart = sql.indexOf("create or replace function public.collect_reservation");
    expect(readyFnStart).toBeGreaterThan(-1);
    expect(collectFnStart).toBeGreaterThan(readyFnStart);
    expect(sql.slice(readyFnStart, collectFnStart)).not.toContain("inventory_locks");
  });

  it("replaying mark_reservation_ready never rotates the credential and reports isNewTransition accordingly", () => {
    expect(sql).toContain("jsonb_build_object('isnewtransition', false)");
    expect(sql).toContain("jsonb_build_object('isnewtransition', true)");
  });

  it("collect_reservation only transitions a ready reservation whose hash matches, consuming the lock atomically", () => {
    expect(sql).toContain("function public.collect_reservation");
    expect(sql).toContain("if current_reservation.status <> 'ready' then");
    expect(sql).toContain("if current_reservation.pickup_code_hash is distinct from target_pickup_code_hash then");
    expect(sql).toContain("raise exception 'pickup credential is invalid';");
    expect(sql).toContain("status = 'consumed', consumed_at = now()");
    expect(sql).toContain("and status = 'active';");
  });

  it("clears the stored hash on collection so a reused credential cannot collect twice", () => {
    expect(sql).toContain("status = 'collected',");
    expect(sql).toContain("pickup_code_hash = null");
  });

  it("re-enforces the pharmacist/pharmacy_staff role rule on both functions", () => {
    const occurrences = sql.split("array['pharmacist', 'pharmacy_staff']::public.member_role[]").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("records runtime evidence for both transitions, with a payload that never includes the credential", () => {
    expect(sql).toContain("'reservation.ready.v1'");
    expect(sql).toContain("'reservation.collected.v1'");
    const readyEvidenceStart = sql.indexOf("perform public.record_runtime_evidence(\n    target_organization_id, target_actor_id, 'reservations.ready'");
    const readyEvidenceEnd = sql.indexOf(");", readyEvidenceStart);
    expect(readyEvidenceStart).toBeGreaterThan(-1);
    expect(sql.slice(readyEvidenceStart, readyEvidenceEnd)).not.toContain("pickup_code");
  });
});

describe("reservation fulfillment live-certification fixture migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202608150032_reservation_fulfillment_live_fixture.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("is restricted to service_role, matching the existing certify_merdp_wave1_golden_lineage guard pattern", () => {
    expect(sql).toContain("if auth.role() <> 'service_role'");
    expect(sql).toContain("grant execute on function public.certify_reservation_fulfillment_fixture(");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toContain("to authenticated;");
  });

  it("walks the real MAR state machine transition by transition rather than inserting a terminal state directly", () => {
    const validatedIndex = sql.indexOf("state = 'validated'");
    const reviewedIndex = sql.indexOf("state = 'reviewed'");
    const searchingIndex = sql.indexOf("state = 'searching'");
    const matchedIndex = sql.indexOf("state = 'matched'");
    expect(validatedIndex).toBeGreaterThan(-1);
    expect(reviewedIndex).toBeGreaterThan(validatedIndex);
    expect(searchingIndex).toBeGreaterThan(reviewedIndex);
    expect(matchedIndex).toBeGreaterThan(searchingIndex);
  });

  it("only marks a MAR reviewed after inserting an approved clinical review, matching the trigger's own requirement", () => {
    const reviewInsertIndex = sql.indexOf("insert into public.clinical_reviews");
    const reviewedStateIndex = sql.indexOf("state = 'reviewed'");
    expect(reviewInsertIndex).toBeGreaterThan(-1);
    expect(reviewedStateIndex).toBeGreaterThan(reviewInsertIndex);
    expect(sql).toContain("'approved', pharmacist_id, now()");
  });

  it("seeds every reservation directly at pending status with a matching active inventory lock, one MAR per reservation", () => {
    expect(sql).toContain("foreach reservation_key in array reservation_keys loop");
    expect(sql).toContain("'pending',");
    expect(sql).toContain("'active',");
    expect(sql).toContain("insert into public.inventory_locks(");
  });

  it("seeds a second, unrelated organization for cross-tenant isolation tests", () => {
    expect(sql).toContain("other_organization_id uuid := gen_random_uuid();");
    expect(sql).toContain("insert into public.organizations(id, name, slug, type) values");
  });

  it("inserts its own medicine rather than depending on MERDP catalog data existing after a plain db reset", () => {
    expect(sql).toContain("insert into public.medicines(");
    expect(sql).not.toContain("where m.status = 'active'");
    expect(sql).not.toContain("no active medicine available");
  });

  it("seeds a single-unit scarce batch with two matched-but-unreserved MARs for a real reserve_inventory concurrency race", () => {
    expect(sql).toContain("scarce_batch_id, organization_id, location_id, medicine_id, 'scarce-' || fixture_key, '2099-12-31',\n    1, 'tablet', 'available', pharmacist_id");
    expect(sql).toContain("'scarceinventorybatchid', scarce_batch_id");
    expect(sql).toContain("'scarcemarids', jsonb_build_array(scarce_mar_id_a, scarce_mar_id_b)");
    const scarceMarBlockStart = sql.indexOf("scarce_batch_id, organization_id, location_id, medicine_id");
    const loopStart = sql.indexOf("foreach reservation_key in array reservation_keys loop");
    expect(scarceMarBlockStart).toBeGreaterThan(-1);
    expect(loopStart).toBeGreaterThan(scarceMarBlockStart);
    expect(sql.slice(scarceMarBlockStart, loopStart)).not.toContain("insert into public.reservations(");
  });
});

describe("reservation fulfillment read grants migration", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202608150033_reservation_fulfillment_read_grants.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("grants select on all five fulfillment tables to both authenticated and service_role", () => {
    for (const table of [
      "reservations",
      "inventory_locks",
      "fulfillment_transitions",
      "medication_access_requests",
      "inventory_batches",
    ]) {
      expect(sql).toContain(`grant select on public.${table} to authenticated, service_role;`);
    }
  });

  it("does not touch RLS policies -- the gap was the table-level grant, not row-level authorization", () => {
    expect(sql).not.toContain("create policy");
    expect(sql).not.toContain("alter table");
    expect(sql).not.toContain("enable row level security");
  });
});

describe("outbox dispatch worker migration (G09 minimum slice)", () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      "supabase",
      "migrations",
      "202608160034_outbox_dispatch_worker.sql",
    ),
    "utf8",
  ).toLowerCase();

  it("atomically claims pending/retrying rows with a row lock", () => {
    expect(sql).toContain("function public.claim_runtime_outbox_events");
    expect(sql).toContain("where status in ('pending', 'retrying') and available_at <= now()");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("set status = 'publishing', locked_by = target_worker, locked_at = now()");
  });

  it("is worker-only -- no authenticated caller may lock outbox rows", () => {
    expect(sql).toContain("revoke all on function public.claim_runtime_outbox_events(text, integer)");
    expect(sql).toContain("from public;");
    expect(sql).toContain("grant execute on function public.claim_runtime_outbox_events(text, integer)");
    expect(sql).toContain("to service_role;");
    expect(sql).not.toContain("to authenticated;");
  });

  it("validates its own inputs rather than trusting the caller", () => {
    expect(sql).toContain("if target_worker is null or btrim(target_worker) = '' then");
    expect(sql).toContain("if target_limit is null or target_limit < 1 or target_limit > 200 then");
  });
});
