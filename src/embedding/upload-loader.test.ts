import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import type { DocumentExtractor } from "#veryfront/extensions/compat/native-services.ts";
import { loadUpload } from "./upload-loader.ts";

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

    it("normalizes MIME parameters and rejects invalid UTF-8", async () => {
      const content = "hello with charset";
      assertEquals(
        await loadUpload(toBuffer(content), "Text/Plain; charset=utf-8"),
        content,
      );

      await assertRejects(
        () => loadUpload(new Uint8Array([0xff, 0xfe]).buffer, "text/plain"),
        Error,
        "valid UTF-8",
      );
    });

    it("rejects uploads larger than the extraction boundary", async () => {
      await assertRejects(
        () => loadUpload(new ArrayBuffer(10 * 1024 * 1024 + 1), "text/plain"),
        Error,
        "exceeds the 10 MB extraction limit",
      );
    });

    it("rejects malformed loader options", async () => {
      await assertRejects(
        () => loadUpload(new ArrayBuffer(0), "text/plain", null as never),
        Error,
        "Upload load options must be an object",
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

    it("handles quoted fields containing newlines", async () => {
      const csv = 'name,notes\nAlice,"line one\nline two"\nBob,plain';
      const result = await loadUpload(toBuffer(csv), "text/csv; charset=utf-8");

      assertEquals(
        result,
        "name: Alice, notes: line one\nline two\nname: Bob, notes: plain",
      );
    });

    it("rejects malformed quoted CSV", async () => {
      const csv = 'name,notes\nAlice,"unterminated';
      await assertRejects(
        () => loadUpload(toBuffer(csv), "text/csv"),
        Error,
        "unterminated quoted field",
      );
      await assertRejects(
        () => loadUpload(toBuffer('name\n"quoted"trailing'), "text/csv"),
        Error,
        "unexpected character after a closing quote",
      );
    });

    it("preserves whitespace inside quoted fields", async () => {
      const result = await loadUpload(
        toBuffer('name,note\nAlice,"  keep me  "'),
        "text/csv",
      );

      assertEquals(result, "name: Alice, note:   keep me  ");
    });

    it("rejects CSV inputs with excessive field counts", async () => {
      const input = new TextEncoder().encode("x,".repeat(100_001)).buffer;

      await assertRejects(
        () => loadUpload(input, "text/csv"),
        Error,
        "CSV contains too many fields",
      );
    });
  });

  describe("worker extraction (requires DocumentExtractor extension)", () => {
    // End-to-end kreuzberg extraction tests live in
    // extensions/ext-document-kreuzberg/src/kreuzberg.integration.test.ts where the
    // extension is registered and @kreuzberg/wasm is available. Core-side,
    // we only assert that `loadUpload` surfaces a clear error when the
    // extension is not installed. This is the documented fallback behavior.

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
  });
});
