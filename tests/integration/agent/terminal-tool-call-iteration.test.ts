import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { announceStreamedToolCallInput } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { createSSECollector } from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private terminal tool calls ${hooks ? "hooks" : "baseline"}`, () => {
    it("announces private buffered input deltas without invoking their shared iterator", () => {
      const inputDeltas = ['{"query":', '"synthetic private deltas"}'];
      const call = {
        id: "buffered",
        name: "inspect",
        arguments: inputDeltas.join(""),
        inputDeltas,
      };
      const { controller, encoder, events } = createSSECollector();
      const iterator = Array.prototype[Symbol.iterator];
      const apply = Reflect.apply;
      let observations = 0;
      try {
        if (hooks) {
          Array.prototype[Symbol.iterator] = function () {
            if (this === inputDeltas) observations++;
            return apply(iterator, this, []);
          };
        }
        announceStreamedToolCallInput(controller, encoder, call);
        announceStreamedToolCallInput(controller, encoder, call);
      } finally {
        if (hooks) Array.prototype[Symbol.iterator] = iterator;
      }
      assertEquals(events, [
        { type: "tool-input-start", toolCallId: "buffered", toolName: "inspect" },
        { type: "tool-input-delta", toolCallId: "buffered", inputTextDelta: inputDeltas[0] },
        { type: "tool-input-delta", toolCallId: "buffered", inputTextDelta: inputDeltas[1] },
      ]);
      assertEquals(observations, 0);
    });
    it("finishes a provider-executed tool step without iterating private materialized arguments", async () => {
      const marker = "synthetic-private-terminal-arguments";
      const model = scriptedModel([{
        parts: [
          {
            type: "tool-call",
            toolCallId: "terminal",
            toolName: "inspect",
            input: { query: marker },
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "terminal",
            toolName: "inspect",
            output: { ok: true },
            providerExecuted: true,
          },
          { type: "text-delta", text: "Terminal complete" },
          { type: "finish", finishReason: "stop" },
        ],
      }], { only: "stream" });
      let localExecutions = 0;
      const runtime = createEphemeralAgentWithRuntimeOptions({
        model: "veryfront-cloud/openai/gpt-5.4",
        system: "Synthetic instructions",
        skills: false,
        maxSteps: 1,
        tools: {
          inspect: tool({
            id: "inspect",
            description: "Synthetic inspection",
            inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
            execute: () => {
              localExecutions++;
              return { ok: true };
            },
          }),
        },
      }, { resolveModelRuntime: () => model });
      const iterator = Array.prototype[Symbol.iterator];
      const hasOwn = Object.hasOwn;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let output = "";
      try {
        if (hooks) {
          Array.prototype[Symbol.iterator] = function () {
            for (let index = 0; index < this.length; index++) {
              const value = this[index];
              if (
                value && typeof value === "object" && hasOwn(value, "arguments") &&
                typeof value.arguments === "string" && apply(includes, value.arguments, [marker])
              ) observations++;
            }
            return apply(iterator, this, []);
          };
        }
        output = await (await runtime.stream({ input: "Complete provider work" }))
          .toDataStreamResponse().text();
      } finally {
        if (hooks) Array.prototype[Symbol.iterator] = iterator;
      }
      assertStringIncludes(output, "Terminal complete");
      assertEquals(model.callCount, 1);
      assertEquals(localExecutions, 0);
      assertEquals(observations, 0);
    });
  });
}
