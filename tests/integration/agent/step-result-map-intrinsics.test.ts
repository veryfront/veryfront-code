import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";

for (const hooks of [false, true]) {
  describe(`private step result map ${hooks ? "hooks" : "baseline"}`, () => {
    it("retains tool output without passing it through a replaced Map constructor", async () => {
      const marker = "synthetic-private-step-result";
      const model = scriptedModel([
        { toolCalls: [{ id: "call", name: "inspect", input: {} }] },
        { text: "Complete" },
      ], { only: "stream" });
      let executions = 0;
      const runtime = createEphemeralAgentWithRuntimeOptions({
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic tool instructions",
        maxSteps: 2,
        tools: {
          inspect: tool({
            id: "inspect",
            description: "Synthetic inspection",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              executions++;
              return Promise.resolve({ text: marker });
            },
          }),
        },
      }, { resolveModelRuntime: () => model });
      const NativeMap = Map;
      const nativeSet = Map.prototype.set;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let output = "";
      try {
        if (hooks) {
          globalThis.Map = class<K, V> extends NativeMap<K, V> {
            override set(key: K, value: V): this {
              if (apply(includes, stringify(value) ?? "", [marker])) observations++;
              apply(nativeSet, this, [key, value]);
              return this;
            }
          };
        }
        const result = await runtime.stream({ input: "Synthetic request" });
        output = await result.toDataStreamResponse().text();
      } finally {
        if (hooks) globalThis.Map = NativeMap;
      }
      assertEquals(executions, 1);
      assertEquals(model.callCount, 2);
      assertStringIncludes(output, marker);
      assertEquals(observations, 0);
    });
  });
}
