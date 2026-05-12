import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
  });

  describe("worker extraction (requires NodeCompat extension)", () => {
    // End-to-end kreuzberg extraction tests live in
    // extensions/ext-node-compatibility/tests/integration.test.ts where the
    // extension is registered and @kreuzberg/wasm is available. Core-side,
    // we only assert that `loadUpload` surfaces a clear error when the
    // extension isn't installed — this is the documented fallback behavior.

    it("throws an actionable error when NodeCompat extension is not registered", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, async () => {
      const html = "<html><body>Hello</body></html>";
      const err = await assertRejects(
        () => loadUpload(toBuffer(html), "text/html"),
        Error,
      ) as Error;
      assertEquals(
        err.message.includes("NodeCompat") || err.message.includes("ext-node-compatibility"),
        true,
        `expected actionable NodeCompat error, got: ${err.message}`,
      );
    });
  });
});
