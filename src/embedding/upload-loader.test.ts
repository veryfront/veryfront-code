import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { DocumentExtractor } from "#veryfront/extensions/compat/native-services.ts";
import { loadUpload, UploadContentError } from "./upload-loader.ts";

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe("upload-loader", () => {
  describe("text passthrough", () => {
    it("returns plain text content unchanged", async () => {
      const text = "Hello, world!\nSecond line.";
      const result = await loadUpload(toBuffer(text), "text/plain");
      assertEquals(result, text);
    });

    it("returns markdown content unchanged", async () => {
      const md = "# Title\n\nSome **bold** text.";
      const result = await loadUpload(toBuffer(md), "text/markdown");
      assertEquals(result, md);
    });

    it("returns MDX content unchanged", async () => {
      const mdx = "# Title\n\n<Component prop='value' />";
      const result = await loadUpload(toBuffer(mdx), "text/mdx");
      assertEquals(result, mdx);
    });

    it("handles empty text content", async () => {
      const result = await loadUpload(toBuffer(""), "text/plain");
      assertEquals(result, "");
    });

    it("preserves unicode characters", async () => {
      const text = "日本語テスト 🚀 émojis café";
      const result = await loadUpload(toBuffer(text), "text/plain");
      assertEquals(result, text);
    });

    it("preserves multi-line markdown with code blocks", async () => {
      const md = "# Heading\n\n```ts\nconst x = 1;\n```\n\nDone.";
      const result = await loadUpload(toBuffer(md), "text/markdown");
      assertEquals(result, md);
    });

    it("accepts normalized UTF-8 MIME parameters", async () => {
      const text = "normalized";
      const result = await loadUpload(
        toBuffer(text),
        ' Text/Plain ; Charset="UTF-8" ',
      );
      assertEquals(result, text);
    });

    it("rejects unsupported text charsets", async () => {
      await assertRejects(
        () => loadUpload(toBuffer("text"), "text/plain; charset=iso-8859-1"),
        UploadContentError,
        "Unsupported text charset",
      );
    });

    it("rejects invalid UTF-8 instead of indexing replacement characters", async () => {
      const invalid = new Uint8Array([0x61, 0xff, 0x62]).buffer;
      await assertRejects(
        () => loadUpload(invalid, "text/plain"),
        UploadContentError,
        "not valid UTF-8",
      );
    });

    it("enforces the configured input bound before decoding", async () => {
      await assertRejects(
        () =>
          loadUpload(toBuffer("three"), "text/plain", {
            maxInputBytes: 4,
          }),
        UploadContentError,
        "source exceeds",
      );
    });

    it("honors a pre-aborted extraction request", async () => {
      const controller = new AbortController();
      controller.abort(new DOMException("cancelled", "AbortError"));
      await assertRejects(
        () =>
          loadUpload(toBuffer("unused"), "text/plain", {
            abortSignal: controller.signal,
          }),
        DOMException,
        "cancelled",
      );
    });
  });

  describe("CSV extraction", () => {
    it("denormalizes CSV headers into each row", async () => {
      const csv = "Name,Age,City\nAlice,30,NYC\nBob,25,LA";
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(
        result,
        "Name: Alice, Age: 30, City: NYC\nName: Bob, Age: 25, City: LA",
      );
    });

    it("handles application/csv mime type", async () => {
      const csv = "Key,Value\nfoo,bar";
      const result = await loadUpload(toBuffer(csv), "application/csv");
      assertEquals(result, "Key: foo, Value: bar");
    });

    it("accepts case-insensitive CSV MIME parameters", async () => {
      const csv = "Key,Value\nfoo,bar";
      const result = await loadUpload(
        toBuffer(csv),
        " Text/CSV ; Charset=UTF-8 ",
      );
      assertEquals(result, "Key: foo, Value: bar");
    });

    it("returns raw text for header-only CSV", async () => {
      const csv = "Name,Age,City";
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, "Name,Age,City");
    });

    it("skips blank lines in CSV", async () => {
      const csv = "H1,H2\n\nval1,val2\n\n";
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, "H1: val1, H2: val2");
    });

    it("handles quoted fields with embedded commas", async () => {
      const csv = 'Name,Address\nAlice,"123 Main St, Apt 4"';
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, "Name: Alice, Address: 123 Main St, Apt 4");
    });

    it("handles RFC 4180 escaped quotes in fields", async () => {
      const csv = 'Col\n"She said ""hello"""';
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, 'Col: She said "hello"');
    });

    it("keeps quoted CRLF, LF, and blank lines inside one logical record", async () => {
      const csv = 'Name,Notes\r\nAlice,"line one\r\n\r\nline three"\r\nBob,"line four\nline five"';
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(
        result,
        "Name: Alice, Notes: line one\\n\\nline three\n" +
          "Name: Bob, Notes: line four\\nline five",
      );
    });

    it("handles missing trailing values", async () => {
      const csv = "A,B,C\n1";
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, "A: 1, B: , C: ");
    });

    it("returns empty string for empty CSV", async () => {
      const result = await loadUpload(toBuffer(""), "text/csv");
      assertEquals(result, "");
    });

    it("handles single-column CSV", async () => {
      const csv = "Item\napple\nbanana";
      const result = await loadUpload(toBuffer(csv), "text/csv");
      assertEquals(result, "Item: apple\nItem: banana");
    });

    it("rejects unterminated quoted fields", async () => {
      await assertRejects(
        () => loadUpload(toBuffer('Name\n"unfinished'), "text/csv"),
        UploadContentError,
        "unterminated quoted field",
      );
    });

    it("rejects quotes inside unquoted fields", async () => {
      await assertRejects(
        () => loadUpload(toBuffer('Name\nbad"value'), "text/csv"),
        UploadContentError,
        "quote inside an unquoted field",
      );
    });

    it("rejects characters after a closing quote", async () => {
      await assertRejects(
        () => loadUpload(toBuffer('Name\n"value"x'), "text/csv"),
        UploadContentError,
        "unexpected character after closing quote",
      );
    });

    it("rejects extra values instead of silently dropping them", async () => {
      await assertRejects(
        () => loadUpload(toBuffer("A,B\n1,2,3"), "text/csv"),
        UploadContentError,
        "3 values for 2 headers",
      );
    });

    it("rejects empty and duplicate headers", async () => {
      await assertRejects(
        () => loadUpload(toBuffer("A,,C\n1,2,3"), "text/csv"),
        UploadContentError,
        "must not be empty",
      );
      await assertRejects(
        () => loadUpload(toBuffer("A,A\n1,2"), "text/csv"),
        UploadContentError,
        "must be unique",
      );
    });

    it("bounds header denormalization before it can amplify output", async () => {
      const csv = `${"Header".repeat(8)}\na\nb`;
      await assertRejects(
        () =>
          loadUpload(toBuffer(csv), "text/csv", {
            maxOutputBytes: 60,
          }),
        UploadContentError,
        "configured 60-byte limit",
      );
    });
  });

  describe("worker extraction (requires DocumentExtractor extension)", () => {
    // End-to-end kreuzberg extraction tests live in
    // extensions/ext-document-kreuzberg/src/kreuzberg.integration.test.ts where the
    // extension is registered and @kreuzberg/wasm is available. Core-side,
    // we only assert that `loadUpload` surfaces a clear error when the
    // extension isn't installed — this is the documented fallback behavior.

    it("throws an actionable error when DocumentExtractor extension is not registered", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, async () => {
      const html = "<html><body>Hello</body></html>";
      const err = await assertRejects(
        () => loadUpload(toBuffer(html), "text/html"),
        Error,
      ) as Error;
      assertEquals(
        err.message.includes("DocumentExtractor") ||
          err.message.includes("ext-document-kreuzberg"),
        true,
        `expected actionable DocumentExtractor error, got: ${err.message}`,
      );
    });

    it("returns structured markdown from the DocumentExtractor unchanged", async () => {
      const extracted = "# Extracted Upload\n\n## Section\n\nBody text.";
      const calls: Array<{ bytes: string; mimeType: string }> = [];
      const extractor: DocumentExtractor = {
        extractInWorker: (buffer, mimeType) => {
          calls.push({ bytes: new TextDecoder().decode(buffer), mimeType });
          return Promise.resolve(extracted);
        },
      };

      try {
        register<DocumentExtractor>("DocumentExtractor", extractor);

        const result = await loadUpload(toBuffer("pdf bytes"), "application/pdf");

        assertEquals(result, extracted);
        assertEquals(calls, [{ bytes: "pdf bytes", mimeType: "application/pdf" }]);
      } finally {
        unregister("DocumentExtractor");
      }
    });

    it("bounds extracted document output before returning it", async () => {
      const extractor: DocumentExtractor = {
        extractInWorker: () => Promise.resolve("x".repeat(101)),
      };

      try {
        register<DocumentExtractor>("DocumentExtractor", extractor);
        await assertRejects(
          () =>
            loadUpload(toBuffer("pdf bytes"), "application/pdf", {
              maxOutputBytes: 100,
            }),
          UploadContentError,
          "configured 100-byte limit",
        );
      } finally {
        unregister("DocumentExtractor");
      }
    });
  });
});
