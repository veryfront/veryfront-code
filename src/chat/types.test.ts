import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  chatRequestContextSchema,
  chatUiMessageSchema,
  messageMetadataSchema,
} from "#veryfront/chat/compat";
import {
  buildDataFileAnnotation,
  imageFileTypes,
  normalizeInlineAttachmentMediaType,
  textFileExtensions,
} from "veryfront/chat/types";

describe("chat/types", () => {
  it("exports hosted chat schemas through veryfront/chat/compat", () => {
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
          costCredits: 0.25,
          costSource: "gateway",
        },
      }),
      {
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "Hello" }],
        metadata: {
          agentName: "Veryfront",
          usage: { inputTokens: 1, outputTokens: 2 },
          costCredits: 0.25,
          costSource: "gateway",
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
        costCredits: 0.25,
      }),
      {
        childRunAudit: {
          status: "completed",
          toolCalls: [{ toolName: "read_file", toolCallId: "tool-1" }],
        },
        costCredits: 0.25,
      },
    );
    assertEquals(
      chatUiMessageSchema.safeParse({
        id: "message-streaming-output",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "report",
          toolCallId: "tool-report",
          input: {},
          state: "output-streaming",
        }],
      }).success,
      true,
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

  it("normalizes case-insensitive media types and omits invalid annotation sizes", () => {
    assertEquals(
      normalizeInlineAttachmentMediaType("photo.PNG", " Image/PNG; Charset=binary "),
      "image/png",
    );
    assertEquals(
      normalizeInlineAttachmentMediaType("archive.bin", "not a media type\n"),
      "application/octet-stream",
    );
    assertEquals(
      buildDataFileAnnotation([{
        name: "report\u0000\n.csv",
        mediaType: "text/csv",
        size: 1.5,
      }]).includes('size="'),
      false,
    );
    assertEquals(
      buildDataFileAnnotation([{
        name: "report\u0000\n.csv",
        mediaType: "text/csv",
      }]).includes('name="report  .csv"'),
      true,
    );
  });

  it("rejects unsafe URLs and invalid usage or billing values", () => {
    assertEquals(
      chatUiMessageSchema.safeParse({
        id: "message-1",
        role: "assistant",
        parts: [{
          type: "source-url",
          sourceId: "source-1",
          url: "javascript:alert(1)",
        }],
      }).success,
      false,
    );
    for (
      const url of [
        "javascript:alert(1)",
        "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        "https://user:password@example.com/file.pdf",
      ]
    ) {
      assertEquals(
        chatUiMessageSchema.safeParse({
          id: "message-1",
          role: "user",
          parts: [{ type: "file", mediaType: "application/pdf", url }],
        }).success,
        false,
      );
    }
    assertEquals(
      chatUiMessageSchema.safeParse({
        id: "message-1",
        role: "user",
        parts: [{
          type: "file",
          mediaType: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
        }],
      }).success,
      true,
    );
    assertEquals(
      messageMetadataSchema.safeParse({ usage: { inputTokens: -1 } }).success,
      false,
    );
    assertEquals(
      messageMetadataSchema.safeParse({ usage: { outputTokens: 1.5 } }).success,
      false,
    );
    assertEquals(
      messageMetadataSchema.safeParse({ costCredits: Number.POSITIVE_INFINITY }).success,
      false,
    );
  });
});
