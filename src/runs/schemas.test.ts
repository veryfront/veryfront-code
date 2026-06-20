import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRunKindSchema, RunSchema } from "./schemas.ts";

function makeRun(overrides: Record<string, unknown> = {}) {
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

    assertEquals(RunSchema.parse(run), run);
  });
});
