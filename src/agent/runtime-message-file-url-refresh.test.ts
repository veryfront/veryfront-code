import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "../testing/assert.ts";
import type { ChatUiMessage } from "../chat/types.ts";
import { resolveRuntimeMessageFileUrls } from "./runtime-message-file-url-refresh.ts";

function userMessage(parts: ChatUiMessage["parts"]): ChatUiMessage {
  return {
    id: "message-1",
    role: "user",
    parts,
  };
}

Deno.test("resolveRuntimeMessageFileUrls refreshes upload file URLs once", async () => {
  const resolvedUploadIds: string[] = [];
  const messages = await resolveRuntimeMessageFileUrls(
    [
      userMessage([
        { type: "text", text: "Use these files." },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "notes.txt",
          uploadId: "upload-1",
          url: "https://files.example.com/original.txt",
        },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "copy.txt",
          uploadId: "upload-1",
          url: "https://files.example.com/copy.txt",
        },
      ]),
    ],
    async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/file.txt";
    },
  );

  assertEquals(resolvedUploadIds, ["upload-1"]);
  assertEquals(messages[0]?.parts, [
    { type: "text", text: "Use these files." },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "notes.txt",
      uploadId: "upload-1",
      url: "https://signed.example.com/file.txt",
    },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "copy.txt",
      uploadId: "upload-1",
      url: "https://signed.example.com/file.txt",
    },
  ]);
});

Deno.test("resolveRuntimeMessageFileUrls keeps existing parts when resolver returns no URL", async () => {
  const messages = [
    userMessage([
      {
        type: "file",
        mediaType: "text/plain",
        filename: "notes.txt",
        uploadId: "upload-1",
        url: "https://files.example.com/original.txt",
      },
    ]),
  ];

  assertEquals(
    await resolveRuntimeMessageFileUrls(messages, () => Promise.resolve(undefined)),
    messages,
  );
});
