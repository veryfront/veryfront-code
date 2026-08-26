/**
 * Unit tests for the shared native extraction routines.
 *
 * Verifies the whole-file mode performs a single native parse (no page
 * splitting) while progress mode parses PDFs page-by-page.
 *
 * @module extensions/ext-document-kreuzberg/native-extraction.test
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { PDFDocument } from "pdf-lib";
import type { DocumentExtractionProgressEvent } from "veryfront/extensions/compat";
import { extractNativeDocument } from "./native-extraction.ts";

async function buildTwoPagePdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  const bytes = await doc.save({ useObjectStreams: false });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function stubNativeLoader(calls: Array<{ byteLength: number; mimeType: string }>) {
  return () =>
    Promise.resolve({
      extractBytes: (bytes: Uint8Array, mimeType: string) => {
        calls.push({ byteLength: bytes.byteLength, mimeType });
        return Promise.resolve({ content: `parsed ${calls.length}` });
      },
      // deno-lint-ignore no-explicit-any
    } as any);
}

describe("native-extraction", () => {
  it("whole-file mode parses a PDF with a single native call on the full buffer", async () => {
    const buffer = await buildTwoPagePdf();
    const calls: Array<{ byteLength: number; mimeType: string }> = [];
    const events: DocumentExtractionProgressEvent[] = [];

    const content = await extractNativeDocument(buffer, "application/pdf", {
      mode: "whole-file",
      emitProgress: (event) => {
        events.push(event);
      },
      loadNative: stubNativeLoader(calls),
    });

    assertEquals(content, "parsed 1");
    assertEquals(calls.length, 1);
    assertEquals(calls[0], { byteLength: buffer.byteLength, mimeType: "application/pdf" });
    assertEquals(events, [{ unit: "file", current: 1, total: 1, characters: 8 }]);
  });

  it("progress mode parses a PDF page-by-page with per-page progress", async () => {
    const buffer = await buildTwoPagePdf();
    const calls: Array<{ byteLength: number; mimeType: string }> = [];
    const events: DocumentExtractionProgressEvent[] = [];

    const content = await extractNativeDocument(buffer, "application/pdf", {
      mode: "progress",
      emitProgress: (event) => {
        events.push(event);
      },
      loadNative: stubNativeLoader(calls),
    });

    assertEquals(content, "parsed 1\n\nparsed 2");
    assertEquals(calls.length, 2);
    assertEquals(
      events.map((event) => ({ unit: event.unit, current: event.current, total: event.total })),
      [
        { unit: "page", current: 1, total: 2 },
        { unit: "page", current: 2, total: 2 },
      ],
    );
  });
});
