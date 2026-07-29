import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
      "202607290009_wave2_batch_commits.sql",
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
    join(process.cwd(), "supabase", "migrations", "202607290010_reserve_inventory.sql"),
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
      "202607290014_retire_legacy_reserve_inventory_overload.sql",
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
