import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isTriggerTarget } from "#veryfront/trigger/target.ts";
import type { Run } from "./schemas.ts";
import {
  getRunEventSchema,
  getRunKindSchema,
  getScheduleReferenceListSchema,
  RunSchema,
} from "./schemas.ts";

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
  it("continues reading legacy eval-kind run responses", () => {
    assertEquals(getRunKindSchema().parse("eval"), "eval");

    const run = makeRun({
      kind: "eval",
      target: "eval:deep-research",
      metadata: { evalId: "eval:deep-research" },
    });

    assertEquals(RunSchema.parse(run), run);
  });

  it("keeps the run I/O contract schema identities the API returns (#2109)", () => {
    const identity = "3b1f5c0a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b";
    const run = makeRun({ input_schema_sha256: identity, output_schema_sha256: null });

    const parsed: Run = RunSchema.parse(run);
    const inputIdentity: string | null | undefined = parsed.input_schema_sha256;
    const outputIdentity: string | null | undefined = parsed.output_schema_sha256;

    assertEquals(inputIdentity, identity);
    assertEquals(outputIdentity, null);
    assertEquals(parsed, run);
  });

  it("keeps the child runs a waiting run depends on (#2092)", () => {
    const waitingOn = [{
      kind: "run" as const,
      run_id: "run_child_1",
      correlation: { kind: "tool_call" as const, id: "call_invoke_agent_1" },
    }];
    const run = makeRun({
      kind: "agent",
      status: "waiting",
      waiting_reason: "child_run",
      waiting_on: waitingOn,
    });

    const parsed: Run = RunSchema.parse(run);

    assertEquals(parsed.waiting_reason, "child_run");
    assertEquals(parsed.waiting_on, waitingOn);
    assertEquals(RunSchema.parse(makeRun()).waiting_on, undefined);
    assertEquals(RunSchema.parse(makeRun({ waiting_on: null })).waiting_on, null);
  });

  it("rejects a malformed waiting dependency", () => {
    for (
      const dependency of [
        { kind: "task", run_id: "run_child_1", correlation: { kind: "tool_call", id: "call_1" } },
        { kind: "run", run_id: "", correlation: { kind: "tool_call", id: "call_1" } },
        { kind: "run", run_id: "run_child_1", correlation: { kind: "message", id: "call_1" } },
        { kind: "run", run_id: "run_child_1", correlation: { kind: "tool_call", id: "" } },
      ]
    ) {
      assertEquals(
        RunSchema.safeParse(makeRun({ waiting_on: [dependency] } as unknown as Partial<Run>))
          .success,
        false,
        `waiting_on=${JSON.stringify(dependency)} is rejected`,
      );
    }
  });

  it("parses runs from APIs that predate schema identities", () => {
    const parsed = RunSchema.parse(makeRun());

    assertEquals(parsed.input_schema_sha256, undefined);
    assertEquals(parsed.output_schema_sha256, undefined);
  });

  it("rejects a schema identity that is not a lowercase hex sha256", () => {
    const digest = "3b1f5c0a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b";
    for (
      const identity of [42, "", { sha256: "abc" }, digest.slice(0, 12), digest.toUpperCase()]
    ) {
      assertEquals(
        RunSchema.safeParse(makeRun({ output_schema_sha256: identity } as Partial<Run>)).success,
        false,
        `output_schema_sha256=${JSON.stringify(identity)} is rejected`,
      );
    }
  });

  it("keeps any JSON value as run input and output", () => {
    for (
      const [input, output] of [
        [["INV-7731", "Harbor Office"], "billing"],
        ["Classify ticket INV-7731", 0.94],
        [7731, true],
        [false, [{ category: "billing" }]],
      ] as const
    ) {
      const run = makeRun({ input, output });
      assertEquals(RunSchema.parse(run), run);
    }
  });

  it("rejects impossible numeric run state", () => {
    for (
      const [field, value] of [
        ["duration_ms", -1],
        ["timeout_seconds", 0],
        ["timeout_seconds", -1],
        ["backoff_limit", -1],
      ] as const
    ) {
      assertEquals(
        RunSchema.safeParse(makeRun({ [field]: value })).success,
        false,
        `${field}=${value} is rejected`,
      );
    }

    assertEquals(RunSchema.safeParse(makeRun({ duration_ms: 0 })).success, true);
    assertEquals(RunSchema.safeParse(makeRun({ timeout_seconds: 1 })).success, true);
    assertEquals(RunSchema.safeParse(makeRun({ backoff_limit: 0 })).success, true);
  });

  it("requires run event ids to be non-negative integers", () => {
    const event = {
      event_id: 0,
      event_type: "RUN_STARTED",
      payload: {},
      created_at: "2026-06-20T08:00:00.000Z",
    };

    assertEquals(getRunEventSchema().safeParse(event).success, true);
    assertEquals(
      getRunEventSchema().safeParse({ ...event, event_id: -1 }).success,
      false,
    );
    assertEquals(
      getRunEventSchema().safeParse({ ...event, event_id: 1.5 }).success,
      false,
    );
  });

  it("requires source schedule timeouts to be positive integers", () => {
    const response = (timeout_seconds: number) => ({
      schedules: [{
        id: "schedule_1",
        name: "Sync helpdesk",
        status: "active",
        target: { kind: "task", id: "sync-helpdesk" },
        definition_source: "source",
        source_trigger_id: "sync-helpdesk",
        timeout_seconds,
      }],
    });

    assertEquals(getScheduleReferenceListSchema().safeParse(response(1)).success, true);
    for (const timeout of [-1, 0, 1.5]) {
      assertEquals(
        getScheduleReferenceListSchema().safeParse(response(timeout)).success,
        false,
        `timeout_seconds=${timeout} is rejected`,
      );
    }
  });

  // A schedules-list response is the one place a target crosses the wire from
  // the platform, so the response schema normalizes known fields and strips
  // extension fields the SDK does not model before local resolution.
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

  for (const [kind, id] of [["task", "sync-helpdesk"], ["workflow", "billing/sync"]] as const) {
    it(`maps ${kind} schedule targets without conversation fields`, () => {
      const parsed = getScheduleReferenceListSchema().parse({
        schedules: [
          {
            id: "schedule_1",
            name: "Sync helpdesk",
            status: "active",
            target: { kind, id },
            definition_source: "source",
            source_trigger_id: "sync-helpdesk",
            timeout_seconds: 900,
          },
        ],
      });

      const target = parsed.schedules[0]?.target;
      assertEquals(
        target,
        { kind, id },
        `a ${kind} target must keep its id and gain no conversation fields`,
      );
      assertEquals(
        isTriggerTarget(target),
        true,
        `a mapped ${kind} target must stay a resolvable trigger target`,
      );
    });
  }

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
