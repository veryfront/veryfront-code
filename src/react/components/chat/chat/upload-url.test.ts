import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  isSafeUploadId,
  isSafeUploadUrl,
  openSafeUploadUrl,
  resolveSafeUploadUrl,
} from "./upload-url.ts";

Deno.test("upload IDs use the storage-safe token contract", () => {
  assertEquals(isSafeUploadId("custom_blob-1"), true);
  assertEquals(isSafeUploadId("x".repeat(128)), true);
  assertEquals(isSafeUploadId("x".repeat(129)), false);
  assertEquals(isSafeUploadId(" spaced "), false);
  assertEquals(isSafeUploadId("../unsafe"), false);
  assertEquals(isSafeUploadId("résumé"), false);
});

Deno.test("upload URLs allow web resources and reject nondurable or executable values", () => {
  assertEquals(isSafeUploadUrl("https://cdn.example.com/report.pdf"), true);
  assertEquals(isSafeUploadUrl("/api/uploads?id=report"), true);
  assertEquals(isSafeUploadUrl("blob:https://example.com/1234"), false);
  assertEquals(isSafeUploadUrl("blob:javascript:alert(1)"), false);
  assertEquals(isSafeUploadUrl("https://user:secret@example.com/report"), false);
  assertEquals(isSafeUploadUrl("javascript:alert(1)"), false);
  assertEquals(isSafeUploadUrl("data:text/html,<script>alert(1)</script>"), false);
  assertEquals(isSafeUploadUrl("vbscript:msgbox(1)"), false);
  assertEquals(isSafeUploadUrl("file:///etc/passwd"), false);
});

Deno.test("upload URL opening resolves against and uses the owning document", () => {
  const calls: unknown[][] = [];
  const ownerDocument = {
    baseURI: "https://iframe.example.com/workspace/",
    defaultView: {
      open: (...args: unknown[]) => {
        calls.push(args);
        return null;
      },
    },
  };

  assertEquals(
    resolveSafeUploadUrl("../uploads/report.pdf", ownerDocument.baseURI),
    "https://iframe.example.com/uploads/report.pdf",
  );
  assertEquals(openSafeUploadUrl("../uploads/report.pdf", ownerDocument), true);
  assertEquals(calls, [[
    "https://iframe.example.com/uploads/report.pdf",
    "_blank",
    "noopener,noreferrer",
  ]]);

  assertEquals(openSafeUploadUrl("javascript:alert(1)", ownerDocument), false);
  assertEquals(calls.length, 1, "unsafe URLs must never reach window.open");

  assertEquals(
    openSafeUploadUrl("../uploads/report.pdf", {
      baseURI: ownerDocument.baseURI,
      defaultView: null,
    }),
    false,
    "a document with no browsing context cannot open an upload",
  );

  const blocked = {
    baseURI: ownerDocument.baseURI,
    defaultView: {
      open: () => {
        throw new Error("blocked");
      },
    },
  };
  assertEquals(
    openSafeUploadUrl("../uploads/report.pdf", blocked),
    false,
    "a rejected window.open returns false instead of throwing",
  );
  assertEquals(calls.length, 1, "the blocked attempt does not reach the original view");
});
