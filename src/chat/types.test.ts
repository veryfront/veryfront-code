import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildDataFileAnnotation,
  chatRequestContextSchema,
  chatUiMessageSchema,
  imageFileTypes,
  messageMetadataSchema,
  normalizeInlineAttachmentMediaType,
  textFileExtensions,
} from "veryfront/chat/types";

describe("chat/types", () => {
  it("exports hosted chat schemas through veryfront/chat/types", () => {
    assertEquals(
      chatRequestContextSchema.parse({
        conversationId: "conversation-1",
        projectId: "project-1",
        branchId: null,
      }),
      {
        conversationId: "conversation-1",
        projectId: "project-1",
        branchId: null,
      },
    );

    assertEquals(
      chatUiMessageSchema.parse({
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: {
          agentName: "Veryfront",
          usage: { inputTokens: 1, outputTokens: 2 },
        },
      }),
      {
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: {
          agentName: "Veryfront",
          usage: { inputTokens: 1, outputTokens: 2 },
        },
      },
    );
  });

  it("keeps message metadata and attachment helpers available outside agent runtime", () => {
    assertEquals(
      messageMetadataSchema.parse({
        childRunAudit: {
          status: "completed",
          toolCalls: [{ toolName: "read_file", toolCallId: "tool-1" }],
        },
      }),
      {
        childRunAudit: {
          status: "completed",
          toolCalls: [{ toolName: "read_file", toolCallId: "tool-1" }],
        },
      },
    );

    assertEquals(normalizeInlineAttachmentMediaType("notes.md", undefined), "text/plain");
    assertEquals(
      normalizeInlineAttachmentMediaType("archive.zip", undefined),
      "application/octet-stream",
    );
    assertEquals(imageFileTypes.includes("image/png"), true);
    assertEquals(textFileExtensions.includes(".csv"), true);

    const annotation = buildDataFileAnnotation([
      {
        name: 'report"<>&.pdf',
        mediaType: "application/pdf",
        uploadId: "upload-1",
        path: "/uploads/report.pdf",
        size: 10,
      },
    ]);

    assertEquals(
      annotation,
      '\n\n<uploaded_files>\n<file name="report&quot;&lt;&gt;&amp;.pdf" upload_id="upload-1" path="/uploads/report.pdf" size="10" type="application/pdf" />\n</uploaded_files>',
    );
  });
});
