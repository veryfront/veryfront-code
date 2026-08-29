import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { preserveEmptyAssistantAnchors } from "./provider-message-anchor-preservation.ts";
import { withProviderModelMessageSourceId } from "./conversation.ts";
import type { ChatUiMessage, ProviderModelMessage } from "./types.ts";

Deno.test("preserveEmptyAssistantAnchors emits shared-id message groups once", () => {
  const firstHalf = withProviderModelMessageSourceId(
    { role: "assistant", content: [{ type: "text", text: "first half" }] },
    "a1",
  );
  const secondHalf = withProviderModelMessageSourceId(
    { role: "assistant", content: [{ type: "text", text: "second half" }] },
    "a1",
  );
  const sourceMessages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "first half" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "second half" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "next" }] },
  ] as unknown as readonly ChatUiMessage[];

  const preserved = preserveEmptyAssistantAnchors(
    [firstHalf, secondHalf],
    sourceMessages,
    ["a1"],
  );

  assertEquals(preserved, [firstHalf, secondHalf]);
});

Deno.test("preserveEmptyAssistantAnchors inserts one anchor per preserved empty assistant id", () => {
  const sourceMessages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    { id: "a1", role: "assistant", parts: [] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "next" }] },
  ] as unknown as readonly ChatUiMessage[];
  const userMessage: ProviderModelMessage = withProviderModelMessageSourceId(
    { role: "user", content: [{ type: "text", text: "hi" }] },
    "u1",
  );

  const preserved = preserveEmptyAssistantAnchors([userMessage], sourceMessages, ["a1"]);

  assertEquals(preserved.length, 2);
  assertEquals(preserved[0], userMessage);
  assertEquals(preserved[1], { role: "assistant", content: [] });
});
