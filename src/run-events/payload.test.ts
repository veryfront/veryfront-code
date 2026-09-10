import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RUN_EVENT_TYPES } from "./vocabulary.ts";
import {
  getChildRunStatusChangedPayloadSchema,
  getDocumentCitedPayloadSchema,
  getRuntimeEventRecordedPayloadSchema,
  getTextMessageStartPayloadSchema,
  getToolCallResultPayloadSchema,
  getToolCallStatusChangedPayloadSchema,
  getUrlCitedPayloadSchema,
  RUN_EVENT_PAYLOAD_SCHEMAS,
} from "./payload.ts";

/**
 * The sixteen control plane types the API declares as bare `{ type }`
 * variants, whose payloads it sanitizes before a reader sees them. They have
 * no per-type getter here, which is the signal to validate the envelope only.
 */
const CONTROL_PLANE_TYPES = RUN_EVENT_TYPES.filter((eventType) =>
  eventType.startsWith("AGENT_RUN_")
);

describe("run-events/payload", () => {
  it("declares a schema for every catalogued type except the control plane ones", () => {
    const withSchema = RUN_EVENT_TYPES.filter((eventType) =>
      RUN_EVENT_PAYLOAD_SCHEMAS[eventType] !== undefined
    );
    assertEquals(CONTROL_PLANE_TYPES.length, 16);
    assertEquals(withSchema.length, RUN_EVENT_TYPES.length - CONTROL_PLANE_TYPES.length);
    for (const eventType of CONTROL_PLANE_TYPES) {
      assertEquals(RUN_EVENT_PAYLOAD_SCHEMAS[eventType], undefined);
    }
  });

  it("keys each schema by the type its discriminant names", () => {
    for (const eventType of RUN_EVENT_TYPES) {
      const getSchema = RUN_EVENT_PAYLOAD_SCHEMAS[eventType];
      if (!getSchema) continue;
      assert(
        getSchema().safeParse({ type: eventType, ...MINIMAL_PAYLOADS[eventType] }).success,
        `${eventType} rejected its own minimal payload`,
      );
      assertEquals(
        getSchema().safeParse({ type: "URL_CITED", url: "https://example.com", sourceId: "a" })
          .success,
        eventType === "URL_CITED",
      );
    }
  });

  it("rejects a citation with no url", () => {
    assertThrows(() => getUrlCitedPayloadSchema().parse({ type: "URL_CITED", sourceId: "web-1" }));
    assertThrows(() =>
      getUrlCitedPayloadSchema().parse({ type: "URL_CITED", url: "", sourceId: "web-1" })
    );
  });

  it("rejects an empty optional string rather than treating it as absent", () => {
    assertThrows(() =>
      getDocumentCitedPayloadSchema().parse({
        type: "DOCUMENT_CITED",
        mediaType: "text/markdown",
        sourceId: "knowledge/report.md",
        title: "",
      })
    );
  });

  it("accepts a null toolCallName on a status change but not a missing one", () => {
    const parsed = getToolCallStatusChangedPayloadSchema().parse({
      type: "TOOL_CALL_STATUS_CHANGED",
      toolCallId: "toolu_01",
      status: "in_progress",
      toolCallName: null,
    });
    assertEquals(parsed.toolCallName, null);
    assertThrows(() =>
      getToolCallStatusChangedPayloadSchema().parse({
        type: "TOOL_CALL_STATUS_CHANGED",
        toolCallId: "toolu_01",
        status: "in_progress",
      })
    );
  });

  it("requires an explicit isError on a tool result, null included", () => {
    const parsed = getToolCallResultPayloadSchema().parse({
      type: "TOOL_CALL_RESULT",
      toolCallId: "toolu_01",
      content: { ok: true },
      isError: null,
    });
    assertEquals(parsed.isError, null);
    assertThrows(() =>
      getToolCallResultPayloadSchema().parse({
        type: "TOOL_CALL_RESULT",
        toolCallId: "toolu_01",
        content: { ok: true },
      })
    );
  });

  it("requires contentId on a text message start", () => {
    assertThrows(() =>
      getTextMessageStartPayloadSchema().parse({
        type: "TEXT_MESSAGE_START",
        messageId: "33333333-3333-4333-a333-333333333333",
      })
    );
  });

  it("carries a child run's optional lifecycle fields through unchanged", () => {
    const parsed = getChildRunStatusChangedPayloadSchema().parse({
      type: "CHILD_RUN_STATUS_CHANGED",
      toolCallId: "toolu_child_1",
      childRunId: "run_child_1",
      status: "running",
      childAgentId: null,
      sourceTargetKind: "project",
    });
    assertEquals(parsed.childAgentId, null);
    assertEquals(parsed.sourceTargetKind, "project");
  });

  it("accepts any JSON value as a recorded runtime event's value", () => {
    for (const value of [null, 7, "text", { nested: true }, [1, 2]]) {
      const parsed = getRuntimeEventRecordedPayloadSchema().parse({
        type: "RUNTIME_EVENT_RECORDED",
        runtime: "veryfront",
        kind: "runtime_context",
        value,
      });
      assertEquals(parsed.value, value);
    }
  });
});

/**
 * The smallest payload each type's declared fields accept. Written out so the
 * discriminant test above proves every schema is reachable and keyed to its
 * own type, rather than only the eight the contract fixture covers.
 */
const MINIMAL_PAYLOADS: Record<string, Record<string, unknown>> = {
  RUN_STARTED: {},
  RUN_FINISHED: {},
  RUN_ERROR: {},
  TEXT_MESSAGE_START: { messageId: "m1", contentId: "c1" },
  TEXT_MESSAGE_CONTENT: { messageId: "m1", delta: "hi" },
  TEXT_MESSAGE_END: { messageId: "m1" },
  TOOL_CALL_START: { toolCallId: "t1", toolCallName: "create_file" },
  TOOL_CALL_ARGS: { toolCallId: "t1", delta: "{" },
  TOOL_CALL_CHUNK: { toolCallId: "t1", delta: "{" },
  TOOL_CALL_END: { toolCallId: "t1" },
  TOOL_CALL_RESULT: { toolCallId: "t1", content: null, isError: null },
  STATE_SNAPSHOT: { snapshot: {} },
  STATE_DELTA: { delta: [] },
  MESSAGES_SNAPSHOT: { messages: [] },
  STEP_STARTED: {},
  STEP_FINISHED: {},
  REASONING_START: {},
  REASONING_MESSAGE_START: { messageId: "m1" },
  REASONING_MESSAGE_CONTENT: { messageId: "m1", delta: "why" },
  REASONING_MESSAGE_END: { messageId: "m1" },
  REASONING_CONTENT: { delta: "why" },
  REASONING_END: {},
  ACTIVITY_SNAPSHOT: {},
  ACTIVITY_DELTA: {},
  TOOL_CALL_STATUS_CHANGED: { toolCallId: "t1", status: "completed", toolCallName: null },
  INPUT_REQUEST_CREATED: { inputRequest: { id: "ir1" } },
  INPUT_REQUEST_UPDATED: { inputRequest: { id: "ir1" } },
  CHILD_RUN_STATUS_CHANGED: { toolCallId: "t1", childRunId: "r1", status: "running" },
  RUN_PARKED: { runId: "r1", reason: "integration_auth", lastEventId: 0 },
  RUN_LOG_CAPTURED: { logs: "" },
  STREAM_HEARTBEAT_EMITTED: { runId: "r1", lastEventId: 0 },
  URL_CITED: { url: "https://example.com", sourceId: "web-1" },
  DOCUMENT_CITED: { mediaType: "text/markdown", sourceId: "doc-1" },
  FILE_ATTACHED: { mediaType: "application/pdf" },
  FILES_CHANGED: { id: null, status: null, changes: null },
  RUNTIME_EVENT_RECORDED: { runtime: "veryfront", kind: "runtime_context", value: {} },
  UNKNOWN: { originalType: "CUSTOM", name: "start", raw: null },
};
