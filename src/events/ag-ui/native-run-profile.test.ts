import "#veryfront/schemas/_test-setup.ts";
import "../test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createZodAdapter } from "../../../extensions/ext-schema-zod/src/adapter.ts";
import type { JsonSchema, JsonSchemaValidationResult } from "#veryfront/extensions/schema/index.ts";
import {
  registerEventSchemaValidator,
  tryResolveEventSchemaValidator,
  unregisterEventSchemaValidator,
} from "../schema-validator.ts";
import { EVENT_SCHEMA_BY_TYPE } from "../types.ts";
import type { AgUiEvent, AgUiEventOf, AgUiRunProfileStoredRunContext } from "./index.ts";
import {
  AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA,
  AG_UI_NATIVE_RUN_PAUSED_TYPE,
  parseNativeRunPausedRecord,
} from "./native-run-paused.ts";
import {
  createGeneratedRunProfileFrame,
  parseNativeRunProfileEvent,
  projectAgUiRunProfileEvent,
  projectNativeRunProfileEvent,
} from "./native-run-profile.ts";

const context: AgUiRunProfileStoredRunContext = {
  occurrence: {
    source: "https://example.test/ag-ui",
    id: "run-occurrence-1",
    time: "2026-10-06T12:00:00.000Z",
  },
  runid: "native-run-1",
  agui: { threadId: "thread-1", runId: "run-1" },
  runkind: "agent",
  conversationid: "conversation-1",
} as const;

function isPromiseLikeValidationResult<T>(
  value: JsonSchemaValidationResult<T> | PromiseLike<JsonSchemaValidationResult<T>>,
): value is PromiseLike<JsonSchemaValidationResult<T>> {
  return typeof value === "object" && value !== null && "then" in value &&
    typeof value.then === "function";
}

function canonical(event: AgUiEvent, projectedContext = context) {
  const command = projectAgUiRunProfileEvent({ event, context: projectedContext });
  assertEquals(command.kind, "canonical-event");
  if (command.kind !== "canonical-event") throw new Error(command.message);
  return command;
}

describe("events/ag-ui/native-run-profile", () => {
  it("roundtrips upstream-valid empty subagent attribution", () => {
    const event: AgUiEventOf<"RUN_STARTED"> = {
      type: "RUN_STARTED",
      threadId: "thread-1",
      runId: "run-1",
      subagentRunId: "",
    };
    const command = canonical(event);
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);
  });

  it("roundtrips upstream-valid empty AG-UI run identifiers with a nonempty native run mapping", () => {
    const emptyAguiContext: AgUiRunProfileStoredRunContext = {
      ...context,
      agui: { threadId: "", runId: "" },
    };
    const started: AgUiEventOf<"RUN_STARTED"> = {
      type: "RUN_STARTED",
      threadId: "",
      runId: "",
    };
    const startedCommand = canonical(started, emptyAguiContext);
    assertEquals(projectNativeRunProfileEvent({ event: startedCommand.event }), started);

    const finished: AgUiEventOf<"RUN_FINISHED"> = {
      type: "RUN_FINISHED",
      threadId: "",
      runId: "",
      outcome: { type: "success" },
    };
    const finishedCommand = canonical(finished, emptyAguiContext);
    assertEquals(projectNativeRunProfileEvent({ event: finishedCommand.event }), finished);
  });

  it("projects RUN_STARTED to canonical run.started with validated target schema and lossless AG-UI metadata", () => {
    const event: AgUiEventOf<"RUN_STARTED"> & {
      readonly extensionRun: { readonly opaque: boolean };
    } = {
      type: "RUN_STARTED",
      threadId: "thread-1",
      runId: "run-1",
      protocolVersion: "1.0",
      parentRunId: "parent-run",
      input: {
        threadId: "thread-1",
        runId: "run-1",
        protocolVersion: "1.0",
        parentRunId: "parent-run",
        state: { prior: true },
        messages: [{ id: "user", role: "user", content: [{ type: "text", text: "hi" }] }],
        tools: [{ name: "search", description: "Search", parameters: { type: "object" } }],
        context: [{ description: "tenant", value: "test" }],
        forwardedProps: { locale: "en" },
        resume: [{ interruptId: "interrupt-1", status: "resolved", payload: { approved: true } }],
      },
      timestamp: 100,
      metadata: { trace: "run-start" },
      rawEvent: { provider: "upstream" },
      subagentRunId: "sub-run",
      extensionRun: { opaque: true },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.run.started");
    assertEquals(command.event.dataschema, EVENT_SCHEMA_BY_TYPE["com.veryfront.run.started"]);
    assertEquals(command.event.source, context.occurrence.source);
    assertEquals(command.event.id, context.occurrence.id);
    assertEquals(command.event.runid, context.runid);
    const protocol = command.event.data.extensions
      ?.["urn:veryfront:ag-ui:protocol:run-lifecycle:1"];
    assertEquals(protocol?.name, "ag-ui");
    assertEquals(protocol?.version, "1.0");
    assertEquals(protocol?.eventType, "RUN_STARTED");
    assertEquals(protocol?.timestamp, 100);
    assertEquals(protocol?.rawEvent, { provider: "upstream" });
    assertEquals(protocol?.metadata, { trace: "run-start" });
    assertEquals(protocol?.extensions, { extensionRun: { opaque: true } });
    assertEquals(protocol?.attribution, { invocation: { subagentRunId: "sub-run" } });
    const runProtocol: unknown = protocol?.run;
    assertEquals(runProtocol, {
      threadId: "thread-1",
      runId: "run-1",
      protocolVersion: "1.0",
      parentRunId: "parent-run",
      input: event.input,
    });
    assertEquals(parseNativeRunProfileEvent(command.event), command.event);
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);
  });

  it("preserves success outcome truth, result, pending tool ids and usage without inventing model-call facts", () => {
    const event: AgUiEvent = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      result: { answer: "ok" },
      outcome: { type: "success", pendingToolCallIds: ["tool-1", "tool-2"] },
      usage: [{
        provider: "openai",
        model: "model",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      }],
      metadata: { trace: "success" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.run.succeeded");
    assertEquals(command.event.dataschema, EVENT_SCHEMA_BY_TYPE["com.veryfront.run.succeeded"]);
    assertEquals(command.event.data.extensions?.["urn:veryfront:ag-ui:protocol:run-lifecycle:1"], {
      name: "ag-ui",
      version: "1.0",
      eventType: "RUN_FINISHED",
      metadata: { trace: "success" },
      run: { threadId: "thread-1", runId: "run-1", result: { answer: "ok" } },
      outcome: { type: "success", pendingToolCallIds: ["tool-1", "tool-2"] },
      usage: [{
        provider: "openai",
        model: "model",
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
      }],
    });
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);
  });

  it("projects cancelled outcome to run.cancelled without inventing cancellation reason", () => {
    const event: AgUiEvent = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "cancelled" },
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.run.cancelled");
    assertEquals(command.event.dataschema, EVENT_SCHEMA_BY_TYPE["com.veryfront.run.cancelled"]);
    assert(!("reason" in command.event.data));
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);

    const withReason = canonical(event, { ...context, cancellationReason: "user requested stop" });
    assertEquals(withReason.event.type, "com.veryfront.run.cancelled");
    if (withReason.event.type !== "com.veryfront.run.cancelled") return;
    assertEquals(withReason.event.data.reason, "user requested stop");
  });

  it("projects RUN_ERROR to canonical run.failed and keeps usage as AG-UI metadata only", () => {
    const event: AgUiEvent = {
      type: "RUN_ERROR",
      message: "failed",
      code: "ERR_TEST",
      usage: [{
        provider: "provider",
        model: "model",
        reasoningTokens: 4,
        cacheWriteInputTokens: 2,
      }],
      metadata: { trace: "error" },
      subagentRunId: "sub-error",
    };

    const command = canonical(event);
    assertEquals(command.event.type, "com.veryfront.run.failed");
    assertEquals(command.event.dataschema, EVENT_SCHEMA_BY_TYPE["com.veryfront.run.failed"]);
    if (command.event.type !== "com.veryfront.run.failed") return;
    assertEquals(command.event.data.error, { message: "failed", code: "ERR_TEST" });
    assertEquals(command.event.data.extensions?.["urn:veryfront:ag-ui:protocol:run-lifecycle:1"], {
      name: "ag-ui",
      version: "1.0",
      eventType: "RUN_ERROR",
      metadata: { trace: "error" },
      attribution: { invocation: { subagentRunId: "sub-error" } },
      error: { message: "failed", code: "ERR_TEST" },
      usage: [{
        provider: "provider",
        model: "model",
        reasoningTokens: 4,
        cacheWriteInputTokens: 2,
      }],
    });
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);
  });

  it("rejects RUN_ERROR payload and protocol error conflicts", () => {
    const command = canonical({
      type: "RUN_ERROR",
      message: "protocol failed",
      code: "ERR_PROTOCOL",
      metadata: { trace: "error" },
    });
    if (command.event.type !== "com.veryfront.run.failed") return;
    assertEquals(command.event.data.error, {
      message: "protocol failed",
      code: "ERR_PROTOCOL",
    });

    assertThrows(
      () =>
        parseNativeRunProfileEvent({
          ...command.event,
          data: {
            ...command.event.data,
            error: {
              message: "payload failed",
              code: "ERR_PAYLOAD",
            },
          },
        }),
      TypeError,
      "run.failed error payload does not match AG-UI RUN_ERROR protocol metadata",
    );
    assertThrows(
      () =>
        projectNativeRunProfileEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              error: {
                message: "payload failed",
                code: "ERR_PAYLOAD",
              },
            },
          },
        }),
      TypeError,
      "run.failed error payload does not match AG-UI RUN_ERROR protocol metadata",
    );
  });

  it("returns requirements for non-data JSON run metadata without invoking accessors", () => {
    const dateCommand = projectAgUiRunProfileEvent({
      event: {
        type: "RUN_ERROR",
        message: "failed",
        rawEvent: new Date("2026-10-06T12:00:00.000Z"),
      },
      context,
    });
    assertEquals(dateCommand.kind, "missing-fact-requirement");
    if (dateCommand.kind !== "missing-fact-requirement") return;
    assertEquals(dateCommand.reason, "non-json-protocol-metadata");

    const cycle: Record<string, unknown> = { provider: "upstream" };
    cycle.self = cycle;
    const cycleCommand = projectAgUiRunProfileEvent({
      event: { type: "RUN_ERROR", message: "failed", rawEvent: cycle },
      context,
    });
    assertEquals(cycleCommand.kind, "missing-fact-requirement");
    if (cycleCommand.kind !== "missing-fact-requirement") return;
    assertEquals(cycleCommand.reason, "non-json-protocol-metadata");

    let getterInvoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return "leak";
      },
    });
    const accessorCommand = projectAgUiRunProfileEvent({
      event: { type: "RUN_ERROR", message: "failed", rawEvent: accessor },
      context,
    });
    assertEquals(accessorCommand.kind, "missing-fact-requirement");
    if (accessorCommand.kind !== "missing-fact-requirement") return;
    assertEquals(accessorCommand.reason, "non-json-protocol-metadata");
    assertEquals(getterInvoked, false);
  });

  it("projects interrupt outcome to internal canonical run.paused with schema-backed lossless metadata", () => {
    const event: AgUiEvent = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      result: { progress: "waiting" },
      outcome: {
        type: "interrupt",
        interrupts: [{
          id: "interrupt-1",
          reason: "approval",
          message: "Approve?",
          toolCallId: "tool-1",
          subagentRunId: "sub-run",
          responseSchema: { type: "object", additionalProperties: true },
          expiresAt: "2026-10-06T12:30:00.000Z",
          metadata: { scope: "approval" },
        }],
      },
      usage: [{
        provider: "openai",
        model: "gpt-test",
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      }],
      metadata: { trace: "interrupt" },
    };

    const outcome = event.outcome;
    if (outcome?.type !== "interrupt") throw new Error("test fixture must be interrupt");

    const command = canonical(event);
    assertEquals(command.event.type, AG_UI_NATIVE_RUN_PAUSED_TYPE);
    assertEquals(command.event.dataschema, AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA);
    assertEquals(command.event.source, context.occurrence.source);
    assertEquals(command.event.id, context.occurrence.id);
    assertEquals(command.event.runid, context.runid);
    if (command.event.type !== AG_UI_NATIVE_RUN_PAUSED_TYPE) return;
    assertEquals(command.event.data.pause.interrupts, outcome.interrupts);
    assertEquals(command.event.data.extensions["urn:veryfront:ag-ui:protocol:run-lifecycle:1"], {
      name: "ag-ui",
      version: "1.0",
      eventType: "RUN_FINISHED",
      metadata: { trace: "interrupt" },
      run: { threadId: "thread-1", runId: "run-1", result: { progress: "waiting" } },
      outcome,
      usage: [{
        provider: "openai",
        model: "gpt-test",
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      }],
    });
    assertEquals(parseNativeRunPausedRecord(command.event), command.event);
    assertEquals(parseNativeRunProfileEvent(command.event), command.event);
    assertEquals(projectNativeRunProfileEvent({ event: command.event }), event);
  });

  it("accepts run.paused interrupt payloads regardless of JSON object key order", () => {
    const event: AgUiEvent = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [{
          id: "interrupt-1",
          reason: "approval",
          metadata: { z: 1, a: { second: true, first: false }, é: 1, "e\u0301": 2 },
        }],
      },
    };

    const command = canonical(event);
    if (command.event.type !== AG_UI_NATIVE_RUN_PAUSED_TYPE) return;
    const reordered = {
      ...command.event,
      data: {
        ...command.event.data,
        pause: {
          interrupts: [{
            metadata: { "e\u0301": 2, é: 1, a: { first: false, second: true }, z: 1 },
            reason: "approval",
            id: "interrupt-1",
          }],
        },
      },
    };

    const previousValidator = tryResolveEventSchemaValidator();
    const adapter = createZodAdapter();
    registerEventSchemaValidator({
      ...adapter,
      compileJsonSchema<T = unknown>(schema: JsonSchema) {
        const validate = adapter.compileJsonSchema<T>?.(schema);
        if (!validate) throw new Error("test validator requires JSON Schema compilation");
        return (value) => {
          const result = validate(value);
          if (isPromiseLikeValidationResult(result)) {
            throw new Error("test validator must be synchronous");
          }
          return result.success ? { success: true, value: value as T } : result;
        };
      },
    });
    try {
      assertEquals(parseNativeRunProfileEvent(reordered).type, AG_UI_NATIVE_RUN_PAUSED_TYPE);
      assertEquals(projectNativeRunProfileEvent({ event: reordered }), event);
    } finally {
      if (previousValidator) registerEventSchemaValidator(previousValidator);
      else unregisterEventSchemaValidator();
    }
  });

  it("rejects run.paused interrupt payloads when array order changes", () => {
    const event: AgUiEvent = {
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [
          { id: "interrupt-1", reason: "first" },
          { id: "interrupt-2", reason: "second" },
        ],
      },
    };

    const command = canonical(event);
    if (command.event.type !== AG_UI_NATIVE_RUN_PAUSED_TYPE) return;
    assertThrows(
      () =>
        projectNativeRunProfileEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              pause: {
                interrupts: [
                  { id: "interrupt-2", reason: "second" },
                  { id: "interrupt-1", reason: "first" },
                ],
              },
            },
          },
        }),
      TypeError,
      "run.paused interrupt payload does not match AG-UI outcome metadata",
    );
  });

  it("rejects invalid or conflicting internal run.paused records", () => {
    const command = canonical({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "interrupt-1", reason: "approval" }],
      },
    });
    if (command.event.type !== AG_UI_NATIVE_RUN_PAUSED_TYPE) return;
    const protocol = command.event.data.extensions["urn:veryfront:ag-ui:protocol:run-lifecycle:1"];

    assertThrows(
      () =>
        parseNativeRunPausedRecord({
          ...command.event,
          data: {
            ...command.event.data,
            pause: { interrupts: [] },
          },
        }),
      TypeError,
      "Invalid native run.paused event",
    );

    assertThrows(
      () =>
        parseNativeRunPausedRecord({
          ...command.event,
          data: {
            ...command.event.data,
            extensions: {
              ...command.event.data.extensions,
              "urn:veryfront:ag-ui:protocol:run-lifecycle:1": {
                ...protocol,
                run: { threadId: "thread-1", runId: "run-1", result: null },
              },
            },
          },
        }),
      TypeError,
      "Invalid native run.paused event",
    );

    assertThrows(
      () =>
        parseNativeRunPausedRecord({
          ...command.event,
          data: {
            ...command.event.data,
            extensions: {
              ...command.event.data.extensions,
              "urn:veryfront:ag-ui:protocol:run-lifecycle:1": {
                ...protocol,
                usage: [{ totalTokens: -1 }],
              },
            },
          },
        }),
      TypeError,
      "Invalid native run.paused event",
    );

    assertThrows(
      () =>
        projectNativeRunProfileEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              pause: { interrupts: [{ id: "interrupt-2", reason: "different" }] },
            },
          },
        }),
      TypeError,
      "run.paused interrupt payload does not match AG-UI outcome metadata",
    );

    assertThrows(
      () =>
        projectNativeRunProfileEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              extensions: {
                ...command.event.data.extensions,
                "urn:veryfront:ag-ui:protocol:run-lifecycle:1": {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "RUN_FINISHED",
                  run: { threadId: "thread-1", runId: "run-1" },
                  outcome: { type: "success" },
                },
              },
            },
          },
        }),
      TypeError,
      "Invalid native run.paused event",
    );
  });

  it("rejects identity context conflicts instead of deriving nearby ids", () => {
    const command = projectAgUiRunProfileEvent({
      event: {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "forged",
        outcome: { type: "success" },
      },
      context,
    });
    assertEquals(command.kind, "missing-fact-requirement");
    if (command.kind !== "missing-fact-requirement") return;
    assertEquals(command.reason, "context-conflict");
  });

  it("rejects wrong canonical outcome pairings and old run-profile durable names", () => {
    const command = canonical({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "success" },
    });
    assert(!command.event.type.includes("run-profile"));
    assertThrows(
      () =>
        projectNativeRunProfileEvent({
          event: {
            ...command.event,
            data: {
              ...command.event.data,
              extensions: {
                ...command.event.data.extensions,
                "urn:veryfront:ag-ui:protocol:run-lifecycle:1": {
                  name: "ag-ui",
                  version: "1.0",
                  eventType: "RUN_FINISHED",
                  run: { threadId: "thread-1", runId: "run-1" },
                  outcome: {
                    type: "interrupt",
                    interrupts: [{ id: "interrupt-1", reason: "approval" }],
                  },
                },
              },
            },
          },
        }),
      TypeError,
      "run.succeeded cannot carry cancelled or interrupt AG-UI outcome metadata",
    );
  });

  it("keeps generated frames without durable identity", () => {
    const frame = createGeneratedRunProfileFrame({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: { type: "success" },
    });
    assertEquals(frame.kind, "generated-read-frame");
    assert(!("id" in frame));
    assert(!("source" in frame));
    assertEquals(frame.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "RUN_FINISHED",
      run: { threadId: "thread-1", runId: "run-1" },
      outcome: { type: "success" },
    });

    const interruptFrame = createGeneratedRunProfileFrame({
      type: "RUN_FINISHED",
      threadId: "thread-1",
      runId: "run-1",
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "interrupt-1", reason: "approval" }],
      },
    });
    assert(!("id" in interruptFrame));
    assert(!("source" in interruptFrame));
    assertEquals(interruptFrame.protocol.agui, {
      name: "ag-ui",
      version: "1.0",
      eventType: "RUN_FINISHED",
      run: { threadId: "thread-1", runId: "run-1" },
      outcome: {
        type: "interrupt",
        interrupts: [{ id: "interrupt-1", reason: "approval" }],
      },
    });
  });
});
