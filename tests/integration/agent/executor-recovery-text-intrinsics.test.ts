import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import type { AgentResponse } from "#veryfront/agent/types.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";
import { runtimeStream } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";

for (const replaceMethods of [false, true]) {
  describe(`private recovery text ${replaceMethods ? "hooks" : "baseline"}`, () => {
    it("deduplicates replayed text without invoking replaced string methods", async () => {
      const marker = "synthetic-private-recovery-marker";
      const originalStartsWith = String.prototype.startsWith;
      const originalSlice = String.prototype.slice;
      const originalIncludes = String.prototype.includes;
      const apply = Reflect.apply;
      let calls = 0;
      let observations = 0;
      let finished: AgentResponse | undefined;
      const chunks: string[] = [];
      const model: ModelRuntime = {
        provider: "openai",
        modelId: "gpt-5.4",
        doGenerate: () => Promise.reject(new Error("Unexpected generation")),
        doStream: () =>
          Promise.resolve({
            stream: runtimeStream(
              ++calls === 2
                ? [
                  { type: "text-delta", text: marker + " " },
                  { type: "finish", finishReason: "stop" },
                ]
                : [
                  { type: "text-delta", text: marker + " complete" },
                  {
                    type: "tool-input-start",
                    id: "synthetic-recovery",
                    toolName: "studio_suggestions",
                  },
                  { type: "tool-input-delta", id: "synthetic-recovery", delta: "{}" },
                  { type: "finish", finishReason: "tool-calls" },
                ],
            ),
          }),
      };
      const runtime = createEphemeralAgentWithRuntimeOptions({
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic recovery instructions",
        maxSteps: 3,
        __vfToolLoadingMode: "eager",
        tools: {
          studio_suggestions: tool({
            id: "studio_suggestions",
            description: "Synthetic suggestions",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => Promise.resolve({ suggestions: [] }),
          }),
        },
      } as RuntimeToolFilterConfig, { resolveModelRuntime: () => model });
      try {
        if (replaceMethods) {
          String.prototype.startsWith = function (search, position) {
            if (apply(originalIncludes, this, [marker])) observations++;
            return apply(originalStartsWith, this, [search, position]);
          };
          String.prototype.slice = function (start, end) {
            if (apply(originalIncludes, this, [marker])) observations++;
            return apply(originalSlice, this, [start, end]);
          };
        }
        const result = await runtime.stream({
          input: "Synthetic request",
          onChunk: (chunk) => chunks.push(chunk),
          onFinish: (response) => {
            finished = response;
          },
        });
        await result.toDataStreamResponse().text();
      } finally {
        if (replaceMethods) {
          String.prototype.startsWith = originalStartsWith;
          String.prototype.slice = originalSlice;
        }
      }
      assertEquals(calls, 2);
      assertEquals(chunks, [marker + " complete"]);
      assertEquals((finished as AgentResponse | undefined)?.text, marker + " complete");
      assertEquals(observations, 0);
    });
  });
}
