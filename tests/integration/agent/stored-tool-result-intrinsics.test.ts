import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { collectFinalStreamToolResults } from "#veryfront/agent/runtime/tool-result-continuation.ts";

for (const probe of ["baseline", "iterator", "filter", "map", "some"]) {
  describe(`private stored tool results ${probe}`, () => {
    it("retains final provider output without mutable collection callbacks", async () => {
      const marker = "synthetic-private-stored-output";
      const output = { text: marker };
      const state = createStreamState();
      const { controller, encoder } = createSSECollector();
      const result = createMockResult([
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "web_fetch",
          input: {},
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "web_fetch",
          output,
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "web_fetch",
          output,
          providerExecuted: true,
        },
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "web_fetch",
          input: {},
          providerExecuted: true,
        },
        { type: "finish", finishReason: "stop", totalUsage: null },
      ]);
      const iterator = Array.prototype[Symbol.iterator];
      const filter = Array.prototype.filter;
      const map = Array.prototype.map;
      const some = Array.prototype.some;
      const hasOwn = Object.hasOwn;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (values: unknown[]) => {
        for (let index = 0; index < values.length; index++) {
          const value = values[index];
          if (
            value && typeof value === "object" && !hasOwn(value, "type") &&
            hasOwn(value, "output") &&
            apply(includes, stringify(value) ?? "", [marker])
          ) observations++;
        }
      };
      let collected: ReturnType<typeof collectFinalStreamToolResults> | undefined;
      try {
        if (probe === "iterator") {
          Array.prototype[Symbol.iterator] = function () {
            observe(this);
            return apply(iterator, this, []);
          };
        }
        if (probe === "filter") {
          Array.prototype.filter = (function (this: unknown[], ...args: unknown[]) {
            observe(this);
            return apply(filter, this, args);
          }) as typeof filter;
        }
        if (probe === "map") {
          Array.prototype.map = (function (this: unknown[], ...args: unknown[]) {
            observe(this);
            return apply(map, this, args);
          }) as typeof map;
        }
        if (probe === "some") {
          Array.prototype.some = function (...args) {
            observe(this);
            return apply(some, this, args);
          };
        }
        await processStream(result, state, controller, encoder, "text", {
          providerExecutedToolNames: ["web_fetch"],
          availableToolNames: ["web_fetch"],
        });
        collected = collectFinalStreamToolResults(state);
      } finally {
        if (probe !== "baseline") {
          Array.prototype[Symbol.iterator] = iterator;
          Array.prototype.filter = filter;
          Array.prototype.map = map;
          Array.prototype.some = some;
        }
      }
      assertEquals(collected?.get("call-1")?.output, output);
      assertEquals(observations, 0);
    });
  });
}
