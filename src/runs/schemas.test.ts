import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isTriggerTarget } from "#veryfront/trigger/target.ts";
import type { Run } from "./schemas.ts";
import { getRunKindSchema, getScheduleReferenceListSchema, RunSchema } from "./schemas.ts";

function makeRun(overrides: Partial<Run> = {}): Run {
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

  // `isTriggerTarget` rejects unknown target keys. A schedules-list response is
  // the one place a target crosses the wire from the platform, so this pins the
  // coupling: the response schema strips keys the SDK does not model, and a
  // platform that starts sending a new one must not fail local resolution.
  it("maps known schedule target fields and strips unknown fields", () => {
    const parsed = getScheduleReferenceListSchema().parse({
      schedules: [
        {
          id: "schedule_1",
          name: "Triage new cases",
          status: "active",
          target: {
            kind: "agent",
            id: "case-triage",
            conversation_mode: "create_new",
            conversation_id: null,
            ignored_field: "ignored",
          },
          definition_source: "source",
          source_trigger_id: "triage-new-cases",
          timeout_seconds: 900,
        },
      ],
    });

    const target = parsed.schedules[0]?.target;
    assertEquals(target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "create_new",
      conversationId: null,
    });
    assertEquals(isTriggerTarget(target), true);
  });

  it("rejects conversation fields on non-agent schedule targets", () => {
    const result = getScheduleReferenceListSchema().safeParse({
      schedules: [
        {
          id: "schedule_1",
          name: "Sync helpdesk",
          status: "active",
          target: {
            kind: "task",
            id: "sync-helpdesk",
            conversation_mode: "create_new",
          },
          definition_source: "source",
          source_trigger_id: "sync-helpdesk",
          timeout_seconds: 900,
        },
      ],
    });

    assertEquals(result.success, false);
  });

  it("rejects existing agent schedule targets without a conversation id", () => {
    const result = getScheduleReferenceListSchema().safeParse({
      schedules: [
        {
          id: "schedule_1",
          name: "Resume triage",
          status: "active",
          target: {
            kind: "agent",
            id: "case-triage",
            conversation_mode: "existing",
          },
          definition_source: "source",
          source_trigger_id: "resume-triage",
          timeout_seconds: 900,
        },
      ],
    });

    assertEquals(result.success, false);
  });

  for (const conversationMode of ["none", "create_new"] as const) {
    it(`rejects ${conversationMode} agent schedule targets with a conversation id`, () => {
      const result = getScheduleReferenceListSchema().safeParse({
        schedules: [
          {
            id: "schedule_1",
            name: "Start triage",
            status: "active",
            target: {
              kind: "agent",
              id: "case-triage",
              conversation_mode: conversationMode,
              conversation_id: "11111111-1111-4111-8111-111111111111",
            },
            definition_source: "source",
            source_trigger_id: "start-triage",
            timeout_seconds: 900,
          },
        ],
      });

      assertEquals(result.success, false);
    });
  }

  it("maps existing agent schedule targets with a valid conversation id", () => {
    const parsed = getScheduleReferenceListSchema().parse({
      schedules: [
        {
          id: "schedule_1",
          name: "Resume triage",
          status: "active",
          target: {
            kind: "agent",
            id: "case-triage",
            conversation_mode: "existing",
            conversation_id: "11111111-1111-4111-8111-111111111111",
          },
          definition_source: "source",
          source_trigger_id: "resume-triage",
          timeout_seconds: 900,
        },
      ],
    });

    const target = parsed.schedules[0]?.target;
    assertEquals(target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "existing",
      conversationId: "11111111-1111-4111-8111-111111111111",
    });
    assertEquals(isTriggerTarget(target), true);
  });
});
