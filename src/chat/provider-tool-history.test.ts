import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ChatUiMessage } from "./types.ts";
import { stripProviderOwnedToolParts } from "./provider-tool-history.ts";

Deno.test("provider-owned tool preservation stays inside one transcript segment", () => {
  const messages = [{
    id: "older-assistant",
    role: "assistant",
    parts: [{
      type: "tool-web_search",
      toolCallId: "reused-provider-id",
      toolName: "web_search",
      providerExecuted: true,
    }],
  }, {
    id: "older-tool",
    role: "tool",
    parts: [{
      type: "tool-result",
      toolCallId: "reused-provider-id",
      toolName: "web_search",
      providerExecuted: true,
    }],
  }, {
    id: "new-user",
    role: "user",
    parts: [{ type: "text", text: "Start another turn" }],
  }, {
    id: "checkpoint-assistant",
    role: "assistant",
    parts: [{
      type: "tool-web_search",
      toolCallId: "reused-provider-id",
      toolName: "web_search",
      providerExecuted: true,
    }],
  }] as ChatUiMessage[];

  assertEquals(
    stripProviderOwnedToolParts(messages, ["web_search"], ["checkpoint-assistant"]),
    [{ ...messages[0]!, parts: [] }, { ...messages[1]!, parts: [] }, messages[2]!, messages[3]!],
  );
});
