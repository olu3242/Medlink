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

describe("conversation platform migration", () => {
  const conversationSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290011_conversation_platform.sql"),
    "utf8",
  ).toLowerCase();

  it("defines tenant-scoped conversation and handoff persistence", () => {
    for (const table of [
      "conversation_sessions",
      "conversation_messages",
      "conversation_handoffs",
    ]) {
      expect(conversationSql).toContain(`create table public.${table}`);
      expect(conversationSql).toContain(
        `alter table public.${table} enable row level security`,
      );
    }
  });

  it("deduplicates provider messages and keeps message evidence immutable", () => {
    expect(conversationSql).toContain("unique(organization_id,provider_message_id)");
    expect(conversationSql).toContain("conversation_messages_append_only");
  });
});

describe("professional operations migrations", () => {
  const roleSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290012_professional_operations.sql"),
    "utf8",
  ).toLowerCase();
  const fulfillmentSql = readFileSync(
    join(process.cwd(), "supabase/migrations/202607290013_fulfillment_transitions.sql"),
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
