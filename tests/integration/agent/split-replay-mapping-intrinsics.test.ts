import "#veryfront/schemas/_test-setup.ts";
import { convertToTextGenerationRuntimeMessages } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";
import {
  attachProviderMetadata,
  markProviderReplayDelivered,
} from "#veryfront/agent/runtime/provider-metadata.ts";
import type { Message } from "#veryfront/agent/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private split replay mapping ${hooks ? "hooks" : "baseline"}`, () => {
    it("distributes raw replay groups without passing them through Array.map", () => {
      const marker = "synthetic-private-split-replay";
      const rawToolUse = {
        type: "tool_use",
        id: "call",
        name: "inspect",
        input: { query: marker },
      };
      const rawText = { type: "text", text: marker };
      const message: Message = {
        id: "assistant",
        role: "assistant",
        parts: [
          { type: "tool-call", toolCallId: "call", toolName: "inspect", args: { query: marker } },
          { type: "tool-result", toolCallId: "call", toolName: "inspect", result: { ok: true } },
          { type: "text", text: marker },
        ],
      };
      markProviderReplayDelivered(attachProviderMetadata(message, {
        anthropic: { rawAssistantMessages: [[rawToolUse], [rawText]] },
      }));
      const map = Array.prototype.map;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let converted: ReturnType<typeof convertToTextGenerationRuntimeMessages> = [];
      try {
        if (hooks) {
          Array.prototype.map = function (...args: unknown[]) {
            if (apply(includes, stringify(this), [marker])) observations++;
            return apply(map, this, args);
          };
        }
        converted = convertToTextGenerationRuntimeMessages([message]);
      } finally {
        if (hooks) Array.prototype.map = map;
      }
      const assistantMessages = converted.filter((entry) => entry.role === "assistant");
      assertEquals(assistantMessages.length, 2);
      assertEquals(assistantMessages.map((entry) => entry.providerMetadata), [
        { anthropic: { rawAssistantMessages: [[rawToolUse]] } },
        { anthropic: { rawAssistantMessages: [[rawText]] } },
      ]);
      assertEquals(observations, 0);
    });
  });
}
