/**
 * End-to-end integration tests for kreuzberg extraction via the NodeCompat
 * contract. Lives inside the extension so `@kreuzberg/wasm` resolves through
 * the extension's own import map, not core's. Exercises the same surface the
 * `loadUpload` worker uses in production (extension installed + registered).
 *
 * @module extensions/ext-node-compat/test
 */

import { assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { NodeCompatImpl } from "./index.ts";

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("ext-node-compat kreuzberg integration", () => {
  // Kreuzberg's WASM init holds resources Deno's sanitizer cannot track, so
  // we disable resource/op sanitization on each test (matches the old
  // upload-loader worker tests).
  const opts = { sanitizeResources: false, sanitizeOps: false };

  it("extracts text from HTML", opts, async () => {
    const impl = new NodeCompatImpl();
    const { extractBytes } = await impl.importKreuzberg();
    const html = "<html><body><h1>Hello</h1><p>World paragraph.</p></body></html>";
    const result = await extractBytes(toBytes(html), "text/html");
    assertStringIncludes(result.content, "Hello");
    assertStringIncludes(result.content, "World paragraph");
  });

  it("extracts text from XML", opts, async () => {
    const impl = new NodeCompatImpl();
    const { extractBytes } = await impl.importKreuzberg();
    const xml = '<?xml version="1.0"?><root><item>Test content</item></root>';
    const result = await extractBytes(toBytes(xml), "text/xml");
    assertStringIncludes(result.content, "Test content");
  });

  it("extracts text from JSON", opts, async () => {
    const impl = new NodeCompatImpl();
    const { extractBytes } = await impl.importKreuzberg();
    const json = JSON.stringify({ title: "Report", summary: "Quarterly results" });
    const result = await extractBytes(toBytes(json), "application/json");
    assertStringIncludes(result.content, "Report");
    assertStringIncludes(result.content, "Quarterly results");
  });

  it("extractInWorker extracts HTML via Deno Worker", opts, async () => {
    const impl = new NodeCompatImpl();
    const html = "<html><body><h1>Worker Hello</h1></body></html>";
    const buffer = toBytes(html).buffer.slice(0) as ArrayBuffer;
    const content = await impl.extractInWorker(buffer, "text/html");
    assertStringIncludes(content, "Worker Hello");
  });
});
