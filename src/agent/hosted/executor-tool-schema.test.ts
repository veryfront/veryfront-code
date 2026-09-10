import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  executorToolBytes,
  executorToolDefinition,
  executorToolJson,
  executorToolLimits,
  executorToolProgress,
  getExecutorToolCallSchema,
  getExecutorToolListSchema,
  parseExecutorToolData,
} from "./executor-tool-schema.ts";

describe("executor tool schema", () => {
  it("preserves the existing node and depth limits while measuring array-heavy JSON", () => {
    const value = { items: Array.from({ length: 50_000 }, () => []) };
    assertEquals(executorToolBytes(executorToolJson(value)), 150_011);
    let nested: JsonValue = [];
    for (let depth = 0; depth < 128; depth++) nested = [nested];
    assertEquals(executorToolBytes(executorToolJson(nested)), 258);
  });

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
    assertEquals(
      parseExecutorToolData(getExecutorToolListSchema(), {
        sourceId: "source",
        toolCallId: "list-call",
        progressToken: 0,
      }),
      { sourceId: "source", toolCallId: "list-call", progressToken: 0 },
    );
    for (
      const correlation of [{ toolCallId: "" }, { toolCallId: "x".repeat(257) }, {
        progressToken: Infinity,
      }, { progressToken: "x".repeat(257) }]
    ) {
      assertThrows(() =>
        parseExecutorToolData(getExecutorToolListSchema(), { sourceId: "source", ...correlation })
      );
    }
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
