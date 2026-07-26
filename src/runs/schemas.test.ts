import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRunKindSchema, RunEventSchema, RunSchema } from "./schemas.ts";

function makeRun(overrides: Record<string, unknown> = {}): unknown {
  return {
    run_id: "run_11111111-1111-4111-8111-111111111111",
    kind: "task",
    status: "pending",
    owner: { kind: "project", id: "project-1" },
    parent_run_id: null,
    root_run_id: "run_11111111-1111-4111-8111-111111111111",
    waiting_reason: null,
    metadata: null,
    target: "task:sync-data",
    workflow_id: null,
    schedule_id: null,
    batch_id: null,
    runtime_target_kind: null,
    runtime_target_environment_id: null,
    runtime_target_branch_id: null,
    input: null,
    config: null,
    output: null,
    error: null,
    logs: null,
    artifacts: [],
    duration_ms: null,
    exit_code: null,
    start_mode: null,
    timeout_seconds: null,
    backoff_limit: null,
    trigger_kind: null,
    trigger_id: null,
    created_by: null,
    updated_at: "2026-06-20T08:00:00.000Z",
    created_at: "2026-06-20T08:00:00.000Z",
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

describe("runs/schemas", () => {
  it("accepts eval as a first-class durable run kind", () => {
    assertEquals(getRunKindSchema().parse("eval"), "eval");

    const run = makeRun({
      kind: "eval",
      target: "eval:deep-research",
      metadata: { evalId: "eval:deep-research" },
    });

    const parsed = RunSchema.parse(run);
    assertEquals(parsed.kind, "eval");
    assertEquals(parsed.target, "eval:deep-research");
    assertEquals(parsed.metadata, { evalId: "eval:deep-research" });
  });

  it("rejects malformed timestamps and impossible counters at the API boundary", () => {
    assertEquals(
      RunSchema.safeParse(makeRun({ created_at: "yesterday" })).success,
      false,
    );
    assertEquals(
      RunSchema.safeParse(makeRun({ duration_ms: -1 })).success,
      false,
    );
    assertEquals(
      RunSchema.safeParse(makeRun({ backoff_limit: -1 })).success,
      false,
    );
    assertEquals(
      RunEventSchema.safeParse({
        event_id: 1.5,
        event_type: "RUN_STARTED",
        payload: {},
        created_at: "2026-06-20T08:00:00.000Z",
      }).success,
      false,
    );
  });

  it("enforces coherent runtime-target response fields", () => {
    assertEquals(
      RunSchema.safeParse(makeRun({
        runtime_target_kind: "environment",
        runtime_target_environment_id: null,
      })).success,
      false,
    );
    assertEquals(
      RunSchema.safeParse(makeRun({
        runtime_target_kind: "preview_branch",
        runtime_target_environment_id: "environment-id",
        runtime_target_branch_id: "branch-id",
      })).success,
      false,
    );
    assertEquals(
      RunSchema.safeParse(makeRun({
        runtime_target_kind: "main_branch",
        runtime_target_environment_id: null,
        runtime_target_branch_id: null,
      })).success,
      true,
    );
  });
});
