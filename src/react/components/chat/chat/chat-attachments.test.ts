import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { attachmentsToFileParts, hasPendingAttachments } from "./chat-attachments.ts";
import { parseChatUploadResponse } from "./hooks/use-upload.ts";

describe("chat-attachments", () => {
  it("chat attachments retain the storage-issued upload id", () => {
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
      "a resolved attachment maps to a file part with its upload id",
    );
  });

  it("drops attachments that have no url yet", () => {
    assertEquals(
      attachmentsToFileParts([{ id: "a", name: "a.txt", state: "uploading" }]),
      [],
      "url-less attachments are not sent",
    );
  });

  it("falls back to application/octet-stream and omits absent size/uploadId", () => {
    assertEquals(
      attachmentsToFileParts([
        { id: "b", name: "b.bin", state: "uploaded", url: "https://x/b" },
      ]),
      [{
        type: "file",
        mediaType: "application/octet-stream",
        url: "https://x/b",
        filename: "b.bin",
      }],
      "missing type falls back to octet-stream and absent size/uploadId keys are omitted",
    );
  });

  it("hasPendingAttachments reports uploading or processing only", () => {
    assertEquals(
      hasPendingAttachments([{ id: "u", name: "u", state: "uploading" }]),
      true,
      "uploading is pending",
    );
    assertEquals(
      hasPendingAttachments([{ id: "p", name: "p", state: "processing" }]),
      true,
      "processing is pending",
    );
    assertEquals(
      hasPendingAttachments([
        { id: "d", name: "d", state: "uploaded" },
        { id: "e", name: "e", state: "error" },
      ]),
      false,
      "uploaded and error are not pending",
    );
    assertEquals(hasPendingAttachments([]), false, "no attachments means nothing pending");
  });

  it("chat upload responses require a URL and retain a returned id", () => {
    assertEquals(
      parseChatUploadResponse(
        '{"id":"custom_blob-1","url":"https://example.com/api/uploads?id=custom_blob-1"}',
      ),
      {
        uploadId: "custom_blob-1",
        url: "https://example.com/api/uploads?id=custom_blob-1",
      },
      "an absolute url and id are retained",
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
      "a relative url resolves against the upload endpoint",
    );
    assertEquals(parseChatUploadResponse('{"id":"custom_blob-1"}'), null, "a url is required");
    assertEquals(parseChatUploadResponse("not json"), null, "non-json is rejected");
    assertEquals(
      parseChatUploadResponse('{"id":42,"url":"/uploads/42"}'),
      null,
      "a numeric id is rejected",
    );
    assertEquals(
      parseChatUploadResponse('{"id":" spaced ","url":"/uploads/42"}'),
      null,
      "a padded id is rejected",
    );
    assertEquals(
      parseChatUploadResponse('{"id":"../unsafe","url":"/uploads/42"}'),
      null,
      "a path-traversal id is rejected",
    );
    assertEquals(
      parseChatUploadResponse(`{"id":"${"x".repeat(129)}","url":"/uploads/42"}`),
      null,
      "an overlong id is rejected",
    );
    assertEquals(
      parseChatUploadResponse('{"url":"javascript:alert(1)"}'),
      null,
      "javascript urls are rejected",
    );
    assertEquals(
      parseChatUploadResponse('{"url":"data:text/html,<script>alert(1)</script>"}'),
      null,
      "data urls are rejected",
    );
  });
});
