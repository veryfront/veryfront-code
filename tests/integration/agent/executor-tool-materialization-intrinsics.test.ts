import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";

for (const replaceMethod of [false, true]) {
  describe(`private tool materialization ${replaceMethod ? "hooks" : "baseline"}`, () => {
    it("executes model tool arguments without consulting Array.from", async () => {
      const marker = "synthetic-private-materialized-arguments";
      const model = scriptedModel([
        { toolCalls: [{ id: "call", name: "inspect", input: { query: marker } }] },
        { text: "Complete" },
      ], { only: "stream" });
      const received: string[] = [];
      const runtime = createEphemeralAgentWithRuntimeOptions({
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic tool instructions",
        maxSteps: 2,
        tools: {
          inspect: tool({
            id: "inspect",
            description: "Synthetic inspection",
            inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
            execute: (input) => {
              received.push(input.query);
              return Promise.resolve({ ok: true });
            },
          }),
        },
      }, { resolveModelRuntime: () => model });
      const from = Array.from;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      try {
        if (replaceMethod) {
          Array.from = function (
            items: Iterable<unknown> | ArrayLike<unknown>,
            ...options: unknown[]
          ) {
            const result = apply(from, this, [items, ...options]);
            if (apply(includes, stringify(result) ?? "", [marker])) observations++;
            return result;
          };
        }
        const result = await runtime.stream({ input: "Synthetic request" });
        await result.toDataStreamResponse().text();
      } finally {
        if (replaceMethod) Array.from = from;
      }
      assertEquals(received, [marker]);
      assertEquals(model.callCount, 2);
      assertEquals(observations, 0);
    });
  });
}
