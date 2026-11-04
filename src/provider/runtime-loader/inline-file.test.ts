import { assert, assertEquals, assertThrows } from "#std/assert";
import { readInlineFileData, unsupportedFileInputError } from "./inline-file.ts";

Deno.test("unsupportedFileInputError replaces an invalid media type with a fixed label", () => {
  const error = unsupportedFileInputError("Chat Completions", {
    url: "https://example.test/report.pdf",
    mediaType: "application/pdf\r\nX-Injected: 1",
  }, "Use another transport.");

  assert(!error.message.includes("X-Injected"), error.message);
  assert(!/[\r\n]/.test(error.message), error.message);
  assert(error.message.includes("(invalid media type)"), error.message);
});

Deno.test("readInlineFileData accepts data URL parameters before base64", () => {
  assertEquals(
    readInlineFileData({ url: "data:image/png;name=a.png;base64,iVBO", mediaType: "image/png" }),
    "iVBO",
  );
});

Deno.test("readInlineFileData treats image/jpg as image/jpeg", () => {
  assertEquals(
    readInlineFileData({ url: "data:image/jpeg;base64,/9j/", mediaType: "image/jpg" }),
    "/9j/",
  );
});

Deno.test("readInlineFileData still rejects a mismatched MIME type", () => {
  assertThrows(
    () => readInlineFileData({ url: "data:image/png;base64,iVBO", mediaType: "application/pdf" }),
    TypeError,
    "must be base64 data with a matching MIME type",
  );
});
