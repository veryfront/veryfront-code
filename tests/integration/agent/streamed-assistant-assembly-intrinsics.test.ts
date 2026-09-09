import "#veryfront/schemas/_test-setup.ts";
import type { StreamingToolCall } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { buildStreamedAssistantMessage } from "#veryfront/agent/runtime/streamed-assistant-message.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "push", "iterator"] as const) {
  describe(`private streamed assistant assembly ${probe}`, () => {
    it("preserves reasoning, text, and tool arguments without exposing private arrays", () => {
      const marker = "synthetic-private-streamed-assembly";
      const reasoningParts = [
        { id: "empty", text: "", signature: "", redactedData: "" },
        { id: "text", text: `${marker}-reasoning`, signature: `${marker}-signature` },
        { id: "signature", text: "", signature: `${marker}-signature-only` },
        { id: "redacted", text: "", redactedData: `${marker}-redacted` },
      ];
      const toolCalls = createPrivateMap<string, StreamingToolCall>();
      toolCalls.set("call", {
        id: "call",
        name: "lookup",
        arguments: '{"query":"synthetic-private-streamed-assembly-arguments"}',
        inputAvailable: true,
      });
      toolCalls.set("placeholder", {
        id: "placeholder",
        name: "suggestions",
        arguments: "{}",
        inputAvailable: false,
      });
      const state = { accumulatedText: `${marker}-answer`, reasoningParts, toolCalls };
      const identity = { id: "assistant", timestamp: 123 };
      const push = Array.prototype.push;
      const iterator = Array.prototype[Symbol.iterator];
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let message: ReturnType<typeof buildStreamedAssistantMessage> | undefined;
      let preserved: typeof message;
      try {
        if (probe === "push") {
          Array.prototype.push = function (...items) {
            for (let index = 0; index < items.length; index++) {
              const serialized = stringify(items[index]);
              if (serialized && apply(includes, serialized, [marker])) observations++;
            }
            return apply(push, this, items);
          };
        } else if (probe === "iterator") {
          Array.prototype[Symbol.iterator] = function () {
            if (this === reasoningParts) observations++;
            return apply(iterator, this, []);
          };
        }
        message = buildStreamedAssistantMessage(state, identity);
        preserved = buildStreamedAssistantMessage(state, identity, {
          preserveRecoverablePlaceholderToolCalls: true,
        });
      } finally {
        if (probe === "push") Array.prototype.push = push;
        else if (probe === "iterator") Array.prototype[Symbol.iterator] = iterator;
      }
      const expected: ReturnType<typeof buildStreamedAssistantMessage> = {
        id: "assistant",
        role: "assistant",
        timestamp: 123,
        parts: [
          {
            type: "reasoning",
            text: `${marker}-reasoning`,
            signature: `${marker}-signature`,
          },
          { type: "reasoning", signature: `${marker}-signature-only` },
          { type: "reasoning", redactedData: `${marker}-redacted` },
          { type: "text", text: `${marker}-answer` },
          {
            type: "tool-lookup",
            toolCallId: "call",
            toolName: "lookup",
            args: { query: `${marker}-arguments` },
            inputText: '{"query":"synthetic-private-streamed-assembly-arguments"}',
          },
        ],
      };
      assertEquals(message, expected);
      assertEquals(preserved, {
        ...expected,
        parts: [...expected.parts, {
          type: "tool-suggestions",
          toolCallId: "placeholder",
          toolName: "suggestions",
          args: {},
          inputText: "{}",
        }],
      });
      assertEquals(observations, 0);
    });
  });
}
