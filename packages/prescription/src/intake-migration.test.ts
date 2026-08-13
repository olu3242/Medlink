import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300016_mvp_prescription_intake.sql",
), "utf8").toLowerCase();

describe("ML-WF-001 prescription intake migration", () => {
  it("uses private tenant-scoped storage and immutable file evidence", () => {
    expect(sql).toContain("'prescriptions-private'");
    expect(sql).toContain("create table public.prescription_files");
    expect(sql).toContain("alter table public.prescription_files enable row level security");
    expect(sql).toContain("prescription_objects_compensating_delete");
    expect(sql).not.toContain("create policy prescription_files_tenant_update");
  });

  it("persists workflow, business state, extraction queue and outbox atomically", () => {
    expect(sql).toContain("function public.create_prescription_intake");
    expect(sql).toContain("'ml-wf-001'");
    expect(sql).toContain("insert into public.workflow_runs");
    expect(sql).toContain("insert into public.workflow_run_events");
    expect(sql).toContain("insert into public.prescription_extractions");
    expect(sql).toContain("insert into public.runtime_outbox_events");
    expect(sql).not.toContain("commit;");
  });

  it("binds idempotent retries to the original file", () => {
    expect(sql).toContain("idempotency key was already used for another prescription");
    expect(sql).toContain("f.sha256 = target_sha256");
    expect(sql).toContain("f.storage_object_path = target_path");
  });
});
