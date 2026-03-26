import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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

  describe("worker extraction (kreuzberg)", () => {
    // Worker tests need sanitizer exceptions because Worker threads hold
    // resources that Deno's sanitizer cannot track across thread boundaries.

    it("extracts text from HTML via kreuzberg worker", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, async () => {
      const html = "<html><body><h1>Hello</h1><p>World paragraph.</p></body></html>";
      const result = await loadUpload(toBuffer(html), "text/html");
      assertStringIncludes(result, "Hello", "should extract heading text");
      assertStringIncludes(result, "World paragraph", "should extract paragraph text");
    });

    it("extracts text from XML via kreuzberg worker", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, async () => {
      const xml = '<?xml version="1.0"?><root><item>Test content</item></root>';
      const result = await loadUpload(toBuffer(xml), "text/xml");
      assertStringIncludes(result, "Test content");
    });

    it("extracts text from JSON via kreuzberg worker", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, async () => {
      const json = JSON.stringify({ title: "Report", summary: "Quarterly results" });
      const result = await loadUpload(toBuffer(json), "application/json");
      assertStringIncludes(result, "Report");
      assertStringIncludes(result, "Quarterly results");
    });
  });
});
