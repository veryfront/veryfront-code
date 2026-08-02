import { assertEquals } from "#veryfront/testing/assert.ts";
import { attachmentsToFileParts } from "./chat-attachments.ts";
import { parseChatUploadResponse } from "./hooks/use-upload.ts";

Deno.test("chat attachments retain the storage-issued upload id", () => {
  assertEquals(
    attachmentsToFileParts([
      {
        id: "local-ui-id",
        uploadId: "custom_blob-1",
        name: "brief.pdf",
        type: "application/pdf",
        size: 42,
        state: "uploaded",
        url: "https://example.com/api/uploads?id=custom_blob-1",
      },
    ]),
    [{
      type: "file",
      mediaType: "application/pdf",
      url: "https://example.com/api/uploads?id=custom_blob-1",
      filename: "brief.pdf",
      size: 42,
      uploadId: "custom_blob-1",
    }],
  );
});

Deno.test("chat upload responses require a URL and retain a returned id", () => {
  assertEquals(
    parseChatUploadResponse(
      '{"id":"custom_blob-1","url":"https://example.com/api/uploads?id=custom_blob-1"}',
    ),
    {
      uploadId: "custom_blob-1",
      url: "https://example.com/api/uploads?id=custom_blob-1",
    },
  );
  assertEquals(
    parseChatUploadResponse(
      '{"id":"custom_blob-1","url":"../files/custom_blob-1"}',
      "https://example.com/api/uploads",
    ),
    {
      uploadId: "custom_blob-1",
      url: "https://example.com/files/custom_blob-1",
    },
  );
  assertEquals(parseChatUploadResponse('{"id":"custom_blob-1"}'), null);
  assertEquals(parseChatUploadResponse("not json"), null);
  assertEquals(parseChatUploadResponse('{"id":42,"url":"/uploads/42"}'), null);
  assertEquals(parseChatUploadResponse('{"id":" spaced ","url":"/uploads/42"}'), null);
  assertEquals(parseChatUploadResponse('{"id":"../unsafe","url":"/uploads/42"}'), null);
  assertEquals(
    parseChatUploadResponse(`{"id":"${"x".repeat(129)}","url":"/uploads/42"}`),
    null,
  );
  assertEquals(parseChatUploadResponse('{"url":"javascript:alert(1)"}'), null);
  assertEquals(
    parseChatUploadResponse('{"url":"data:text/html,<script>alert(1)</script>"}'),
    null,
  );
});
