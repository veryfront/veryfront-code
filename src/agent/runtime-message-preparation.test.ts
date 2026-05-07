import { assertEquals } from "../testing/assert.ts";
import type { ChatUiMessage } from "../chat/types.ts";
import { prepareAgentRuntimeMessagesFromUiMessages } from "./runtime-message-preparation.ts";

function userMessage(parts: ChatUiMessage["parts"]): ChatUiMessage {
  return {
    id: "message-1",
    role: "user",
    parts,
  };
}

Deno.test("prepareAgentRuntimeMessagesFromUiMessages returns an empty-conversation prompt", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [],
    emptyConversationPrompt: "Suggest next steps.",
  });

  assertEquals(messages[0]?.role, "user");
  assertEquals(messages[0]?.parts, [{ type: "text", text: "Suggest next steps." }]);
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages refreshes upload file URLs before conversion", async () => {
  const resolvedUploadIds: string[] = [];
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Use these files." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-1",
          url: "https://files.example.com/original.txt",
        },
      ]),
    ],
    resolveFileUrl: async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/file.txt";
    },
  });

  assertEquals(resolvedUploadIds, ["upload-1"]);
  assertEquals(messages[0]?.parts, [
    { type: "text", text: "Use these files." },
    { type: "file", url: "https://signed.example.com/file.txt", mediaType: "text/plain" },
  ]);
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages keeps original URL when resolver returns undefined", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Check this image." },
        {
          type: "file",
          mediaType: "image/png",
          filename: "photo.png",
          uploadId: "upload-2",
          url: "https://files.example.com/photo.png",
        },
      ]),
    ],
    resolveFileUrl: async () => undefined,
  });

  assertEquals(messages[0]?.parts, [
    { type: "text", text: "Check this image." },
    { type: "file", url: "https://files.example.com/photo.png", mediaType: "image/png" },
  ]);
});
