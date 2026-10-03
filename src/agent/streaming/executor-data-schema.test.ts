import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
