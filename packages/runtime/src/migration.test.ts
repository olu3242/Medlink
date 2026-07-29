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
