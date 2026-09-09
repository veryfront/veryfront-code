import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { buildAgentCallContext } from "#veryfront/agent/runtime/call-context.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "strings", "arrays"]) {
  describe(`private framework tool search ${probe}`, () => {
    it("loads and executes a matching tool while preserving structured cache metadata", async () => {
      const marker = "synthetic private search";
      const model = scriptedModel([
        { toolCalls: [{ id: "search", name: "tool_search", input: { query: ` ${marker} ` } }] },
        { toolCalls: [{ id: "lookup", name: "lookup_private", input: {} }] },
        { text: "Complete" },
      ], { only: "stream" });
      let executions = 0;
      const config: AgentConfig & RuntimeToolFilterConfig = {
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic instructions",
        skills: false,
        maxSteps: 3,
        __vfToolLoadingMode: "deferred",
        tools: {
          lookup_private: tool({
            id: "lookup_private",
            description: marker,
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              executions++;
              return { ok: true };
            },
          }),
        },
      };
      const runtime = createEphemeralAgentWithRuntimeOptions(config, {
        resolveModelRuntime: () => model,
      });
      const contextInput = {
        instructions: [{
          role: "system" as const,
          content: "Instructions",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" }, custom: marker } },
        }],
      };
      const expectedContext = buildAgentCallContext(contextInput);
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const replace = (target: object, key: PropertyKey) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            if (apply(includes, stringify(this) ?? "", [marker])) observations++;
            return apply(descriptor.value, this, args);
          },
        });
      };
      let context;
      let output = "";
      try {
        if (probe === "strings") {
          for (
            const key of [
              "trim",
              "toLowerCase",
              "replace",
              "replaceAll",
              "indexOf",
              "slice",
              "split",
              "includes",
            ]
          ) replace(String.prototype, key);
        }
        if (probe === "arrays") {
          for (const key of ["some", "map", "filter", "reduce", "sort", Symbol.iterator]) {
            replace(Array.prototype, key);
          }
        }
        context = buildAgentCallContext(contextInput);
        output = await (await runtime.stream({ input: "Find and use the lookup tool" }))
          .toDataStreamResponse().text();
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(context, expectedContext);
      assertEquals(executions, 1);
      assertEquals(model.callCount, 3);
      assertStringIncludes(output, "Complete");
      assertEquals(observations, 0);
    });
  });
}
