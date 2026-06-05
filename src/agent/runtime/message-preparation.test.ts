import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { ChatUiMessage } from "../../chat/types.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { createGenerateModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import { convertToTextGenerationRuntimeMessages } from "./text-generation-runtime-message-converter.ts";
import { prepareAgentRuntimeMessagesFromUiMessages } from "./message-preparation.ts";

function countOccurrences(value: string, pattern: string): number {
  return value.split(pattern).length - 1;
}

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

Deno.test("prepareAgentRuntimeMessagesFromUiMessages preserves source message ids", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      {
        id: "user-source-1",
        role: "user",
        parts: [{ type: "text", text: "First request" }],
      },
      {
        id: "assistant-source-1",
        role: "assistant",
        parts: [{ type: "text", text: "First answer" }],
      },
      {
        id: "user-source-2",
        role: "user",
        parts: [{ type: "text", text: "Follow up" }],
      },
    ],
  });

  assertEquals(messages.map((message) => message.id), [
    "user-source-1",
    "assistant-source-1",
    "user-source-2",
  ]);
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
  const parts = messages[0]?.parts ?? [];
  assertEquals(
    parts.some((part) =>
      part.type === "file" &&
      "url" in part &&
      part.url === "https://signed.example.com/file.txt" &&
      part.mediaType === "text/plain"
    ),
    true,
  );

  const text = parts.flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
    .join("\n");
  assertStringIncludes(text, "Use these files.");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "notes.txt");
  assertStringIncludes(text, "upload-1");
  assertStringIncludes(text, "https://signed.example.com/file.txt");
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages preserves persisted uploaded image parts for vision models", async () => {
  const resolvedUploadIds: string[] = [];
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage(
        [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            upload_id: "upload-image-1",
            media_type: "image/jpeg",
            url: "/api/projects/project-1/uploads/upload-image-1",
          },
        ] as unknown as ChatUiMessage["parts"],
      ),
    ],
    resolveFileUrl: async ({ uploadId }) => {
      resolvedUploadIds.push(uploadId);
      return "https://signed.example.com/web-app-screenshot.jpg";
    },
  });

  assertEquals(resolvedUploadIds, ["upload-image-1"]);
  assertEquals(messages[0]?.parts, [
    { type: "text", text: "What is this?" },
    {
      type: "image",
      url: "https://signed.example.com/web-app-screenshot.jpg",
      mediaType: "image/jpeg",
    },
    {
      type: "text",
      text: "Attached files from earlier conversation context:\n\n<uploaded_files>\n" +
        '<file name="image" upload_id="upload-image-1" url="https://signed.example.com/web-app-screenshot.jpg" type="image/jpeg" />\n' +
        "</uploaded_files>",
    },
  ]);

  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);
  const content = runtimeMessages[0]?.role === "user" ? runtimeMessages[0].content : null;
  if (!Array.isArray(content)) {
    throw new Error("Expected text-generation runtime to keep multimodal user content");
  }

  const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  assertStringIncludes(text, "What is this?");
  assertStringIncludes(text, "<uploaded_files>");
  assertEquals(
    content.some((part) =>
      part.type === "image" &&
      part.url === "https://signed.example.com/web-app-screenshot.jpg" &&
      part.mediaType === "image/jpeg"
    ),
    true,
  );
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

  const parts = messages[0]?.parts ?? [];
  assertEquals(
    parts.some((part) =>
      part.type === "file" &&
      "url" in part &&
      part.url === "https://files.example.com/photo.png" &&
      part.mediaType === "image/png"
    ),
    true,
  );

  const text = parts.flatMap((part) => part.type === "text" && "text" in part ? [part.text] : [])
    .join("\n");
  assertStringIncludes(text, "Check this image.");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "photo.png");
  assertStringIncludes(text, "upload-2");
});

Deno.test("prepareAgentRuntimeMessagesFromUiMessages keeps a synthetic PDF visible through text-generation conversion", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Sent with attachments" },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "sample-attachment.pdf",
          uploadId: "test-upload-id",
          uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          url: "/api/projects/test-project-id/uploads/test-upload-id",
        },
      ]),
    ],
    resolveFileUrl: async () => "https://signed.example.com/invoice.pdf",
  });

  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);

  assertEquals(runtimeMessages[0]?.role, "user");
  const content = runtimeMessages[0]?.content;
  if (!Array.isArray(content)) {
    throw new Error("Expected text-generation runtime user content to preserve native file parts");
  }

  const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
  assertStringIncludes(text, "Sent with attachments");
  assertStringIncludes(text, "<uploaded_files>");
  assertStringIncludes(text, "sample-attachment.pdf");
  assertStringIncludes(text, "test-upload-id");
  assertStringIncludes(text, "application/pdf");
  assertStringIncludes(text, "https://signed.example.com/invoice.pdf");
  assertEquals(countOccurrences(text, "<uploaded_files>"), 1);
  assertEquals(
    content.some((part) =>
      part.type === "file" && part.url === "https://signed.example.com/invoice.pdf"
    ),
    true,
  );
});

Deno.test("chat attachment preparation keeps a synthetic PDF visible in the model prompt", async () => {
  const messages = await prepareAgentRuntimeMessagesFromUiMessages({
    messages: [
      userMessage([
        { type: "text", text: "Sent with attachments" },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "sample-attachment.pdf",
          uploadId: "test-upload-id",
          uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          url: "/api/projects/test-project-id/uploads/test-upload-id",
        },
      ]),
    ],
    resolveFileUrl: async () => "https://signed.example.com/invoice.pdf",
  });
  const runtimeMessages = convertToTextGenerationRuntimeMessages(messages);
  let sawPrompt = false;
  const model = createGenerateModel("test", "test/attachment-e2e", async (options) => {
    sawPrompt = true;
    const prompt = options.prompt;
    assertEquals(prompt.length, 1);
    const firstMessage = prompt[0];
    if (
      !firstMessage ||
      typeof firstMessage !== "object" ||
      !("role" in firstMessage) ||
      firstMessage.role !== "user" ||
      !("content" in firstMessage) ||
      !Array.isArray(firstMessage.content)
    ) {
      throw new Error("Expected a user prompt with text content parts");
    }

    const text = firstMessage.content
      .flatMap((part) =>
        part && typeof part === "object" && "type" in part && part.type === "text" &&
          "text" in part && typeof part.text === "string"
          ? [part.text]
          : []
      )
      .join("\n");

    assertStringIncludes(text, "Sent with attachments");
    assertStringIncludes(text, "<uploaded_files>");
    assertStringIncludes(text, "sample-attachment.pdf");
    assertStringIncludes(text, "test-upload-id");
    assertStringIncludes(text, "https://signed.example.com/invoice.pdf");
    assertEquals(countOccurrences(text, "<uploaded_files>"), 1);

    return {
      content: [{ type: "text", text: "I can see sample-attachment.pdf." }],
      finishReason: { unified: "stop", raw: "stop" },
    };
  });

  const result = await generateText({ model, messages: runtimeMessages });

  assertEquals(sawPrompt, true);
  assertEquals(result.text, "I can see sample-attachment.pdf.");
});
