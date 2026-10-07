import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseExecutorDataEvent } from "./executor-data-schema.ts";

describe("agent/streaming/executor-data-schema", () => {
  it("preserves unsupported output schema codes across the hosted agent stream", () => {
    assertEquals(
      parseExecutorDataEvent({
        type: "error",
        code: "OUTPUT_SCHEMA_INVALID",
        error: "Private upstream schema text <REDACTED>",
      }),
      {
        type: "error",
        code: "OUTPUT_SCHEMA_INVALID",
        error:
          "The model provider rejected the outputSchema. Use a root object with supported JSON Schema keywords. " +
          "For strict output, set additionalProperties: false on every object and include every property in required.",
      },
    );
  });

  it("accepts only reviewed private runtime observation carriers on matching events", () => {
    const stepId = "11111111-1111-4111-8111-111111111111";
    const messageSpanId = "22222222-2222-4222-8222-222222222222";
    const occurrenceId = "33333333-3333-4333-8333-333333333333";

    assertEquals(
      parseExecutorDataEvent({
        type: "data-veryfront.runtime_context",
        data: { runStartedAtUtc: "2026-01-01T00:00:00.000Z" },
        privateRuntimeObservation: { version: 1, kind: "execution_entry", occurrenceId },
      }),
      {
        type: "data-veryfront.runtime_context",
        data: { runStartedAtUtc: "2026-01-01T00:00:00.000Z" },
        privateRuntimeObservation: { version: 1, kind: "execution_entry", occurrenceId },
      },
    );
    assertEquals(
      parseExecutorDataEvent({
        type: "text-delta",
        id: "text-1",
        delta: "hello",
        privateRuntimeObservation: { version: 1, kind: "step_message", stepId, messageSpanId },
      }),
      {
        type: "text-delta",
        id: "text-1",
        delta: "hello",
        privateRuntimeObservation: { version: 1, kind: "step_message", stepId, messageSpanId },
      },
    );

    assertThrows(() =>
      parseExecutorDataEvent({
        type: "text-delta",
        id: "text-1",
        delta: "hello",
        privateRuntimeObservation: { version: 1, kind: "step_started", stepId },
      })
    );
    assertThrows(() =>
      parseExecutorDataEvent({
        type: "step-start",
        privateRuntimeObservation: { version: 1, kind: "step_started", stepId: "forged" },
      })
    );
  });

  it("accepts the one-hour cache-write share on finish usage", () => {
    const event = {
      type: "message-finish",
      finishReason: "stop",
      totalUsage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
        cacheCreationInputTokens: 1000,
        cacheCreation1hInputTokens: 600,
      },
    };

    assertEquals(parseExecutorDataEvent(event), event);
  });
});
