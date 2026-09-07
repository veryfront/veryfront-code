import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  executorToolDefinition,
  executorToolJson,
  executorToolLimits,
  executorToolProgress,
  getExecutorToolCallSchema,
  parseExecutorToolData,
} from "./executor-tool-schema.ts";

describe("executor tool schema", () => {
  it("requires data-only JSON without coercing unsupported values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (
      const input of [
        undefined,
        { value: undefined },
        NaN,
        Infinity,
        new Date(0),
        new Error("synthetic"),
        { value() {} },
        circular,
      ]
    ) {
      assertThrows(() => executorToolJson(input), TypeError);
    }
    const input = { nested: { value: 1 } };
    const snapshot = executorToolJson(input);
    input.nested.value = 2;
    assertEquals(snapshot, { nested: { value: 1 } });
  });

  it("preserves ordinary argument and JSON Schema keys without treating them as authority", () => {
    const args = JSON.parse(
      '{"__proto__":{"type":"string"},"constructor":"synthetic","url":"https://example.test","context":{"projectId":"data-only"}}',
    );
    const parsed = parseExecutorToolData(getExecutorToolCallSchema(), {
      sourceId: "source",
      toolName: "tool",
      args,
    });
    assertEquals(parsed.args, args);
    assert(Object.hasOwn(parsed.args, "__proto__"));
    const definition = executorToolDefinition({
      name: "tool",
      description: "Synthetic",
      parameters: { properties: args },
      title: undefined,
    }, executorToolLimits());
    assertEquals(definition.parameters.properties, args);
    assert(!Object.hasOwn(definition, "title"));
  });

  it("bounds IDs, correlations, definitions, progress and JSON byte size", () => {
    const call = { sourceId: "source", toolName: "tool", args: {} };
    for (
      const input of [
        { ...call, sourceId: "" },
        { ...call, toolName: "x".repeat(257) },
        { ...call, args: [] },
        { ...call, toolCallId: "x".repeat(257) },
        { ...call, progressToken: Infinity },
        { ...call, progressToken: {} },
      ]
    ) assertThrows(() => parseExecutorToolData(getExecutorToolCallSchema(), input));
    assertThrows(() => executorToolJson("é".repeat(20), 30));
    assertThrows(() =>
      executorToolDefinition({
        name: "tool",
        description: "Synthetic",
        parameters: {},
        url: "https://example.test",
      }, executorToolLimits())
    );
    assertThrows(() => executorToolProgress({ type: "" }, executorToolLimits()));
    assertThrows(() =>
      executorToolProgress(
        { type: "progress", value: "x".repeat(100) },
        executorToolLimits({ maxProgressEventBytes: 50 }),
      )
    );
    assertEquals(
      executorToolProgress(
        { type: "progress", name: "custom", value: 1, data: null },
        executorToolLimits(),
      ),
      { type: "progress", name: "custom", value: 1, data: null },
    );
  });
});
