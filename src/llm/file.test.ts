import { Buffer } from "node:buffer";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { fileFromBytes, planFileParts } from "./file.ts";

function assertInvalidArgument(fn: () => unknown, message: string): void {
  const error = assertThrows(fn, VeryfrontError, message);
  assertEquals(error instanceof VeryfrontError && error.slug, INVALID_ARGUMENT.slug);
}

describe("fileFromBytes", () => {
  it("preserves binary views and JSON serialization", () => {
    const bytes = new Uint8Array([99, 0, 255, 128, 99]).subarray(1, 4);
    const file = fileFromBytes({ bytes, filename: "report.pdf", mediaType: "application/pdf" });
    assertEquals(JSON.parse(JSON.stringify(file)), {
      type: "file",
      url: "data:application/pdf;base64,AP+A",
      filename: "report.pdf",
      mediaType: "application/pdf",
    });
  });
  it("encodes only the viewed bytes of a Node Buffer with a non-zero byteOffset", () => {
    // Pooled Buffers share one ArrayBuffer; model that with an explicit offset view.
    const pool = new Uint8Array([9, 0x25, 0x50, 0x44, 0x46, 9]).buffer;
    const bytes = Buffer.from(pool, 1, 4);
    assertEquals([bytes.byteOffset, bytes.buffer.byteLength], [1, 6]);
    const file = fileFromBytes({ bytes, filename: "request.pdf", mediaType: "application/pdf" });
    assertEquals(file.url, "data:application/pdf;base64,JVBERg==");
  });
  it("preserves bytes across encoding chunks", () => {
    const bytes = Uint8Array.from({ length: 50001 }, (_, i) => i % 256);
    const file = fileFromBytes({
      bytes,
      filename: "report.pdf",
      mediaType: "application/pdf",
      maxBytes: bytes.length,
    });
    const decoded = Uint8Array.from(
      atob(file.url.slice(file.url.indexOf(",") + 1)),
      (c) => c.charCodeAt(0),
    );
    assertEquals(decoded, bytes);
  });
  it("rejects invalid metadata and budgets without exposing file content", () => {
    const input = {
      bytes: new Uint8Array([1]),
      filename: "report.pdf",
      mediaType: "application/pdf",
    };
    const cases: Array<[Partial<typeof input> & { maxBytes?: number }, string]> = [
      [{ filename: " " }, "File filename must be non-empty"],
      [{ filename: "a\nb.pdf" }, "control characters (CR, LF, NUL)"],
      [{ filename: ".." }, "File filename must be a base name"],
      [{ filename: "." }, "File filename must be a base name"],
      [{ filename: "C:private.pdf" }, "File filename must be a base name"],
      [{ filename: " report.pdf" }, "File filename must not start or end with whitespace"],
      [{ filename: "/home/user/report.pdf" }, "File filename must be a base name"],
      [{ filename: "C:\\Users\\report.pdf" }, "File filename must be a base name"],
      [{ mediaType: "application/pdf;base64,secret" }, "File mediaType must be a MIME type"],
      [{ maxBytes: 0 }, "File maxBytes must be a positive safe integer"],
      [{ maxBytes: NaN }, "File maxBytes must be a positive safe integer"],
      [{ maxBytes: 0.5 }, "File maxBytes must be a positive safe integer"],
      [{ bytes: new Uint8Array() }, "File bytes must be a non-empty Uint8Array"],
      [{ bytes: new Uint8Array(2), maxBytes: 1 }, "File exceeds maxBytes"],
    ];
    for (const [change, message] of cases) {
      assertInvalidArgument(() => fileFromBytes({ ...input, ...change }), message);
    }
  });
});

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d];

function pdf(filename: string, size: number) {
  const bytes = new Uint8Array(size);
  bytes.set(PDF_HEADER);
  return { bytes, filename, mediaType: "application/pdf" };
}

describe("planFileParts", () => {
  it("sends every file and reports complete when no budget applies", () => {
    const plan = planFileParts({ files: [pdf("a.pdf", 8), pdf("b.pdf", 9)] });
    assertEquals(plan.complete, true);
    assertEquals(plan.omitted, []);
    assertEquals(plan.parts.map((part) => part.filename), ["a.pdf", "b.pdf"]);
    assertEquals(plan.parts[0], fileFromBytes(pdf("a.pdf", 8)));
  });

  it("sends a file at exactly maxFileBytes and omits one byte over", () => {
    const plan = planFileParts({
      files: [pdf("exact.pdf", 16), pdf("over.pdf", 17)],
      maxFileBytes: 16,
    });
    assertEquals(plan.complete, false);
    assertEquals(plan.parts.map((part) => part.filename), ["exact.pdf"]);
    assertEquals(plan.omitted, [
      {
        index: 1,
        filename: "over.pdf",
        mediaType: "application/pdf",
        bytes: 17,
        reason: "over_file_limit",
      },
    ]);
  });

  it("applies count and total budgets in input order to sent files only", () => {
    const plan = planFileParts({
      files: [
        pdf("a.pdf", 10),
        pdf("too-big.pdf", 50),
        pdf("b.pdf", 10),
        pdf("c.pdf", 6),
        pdf("d.pdf", 5),
        pdf("e.pdf", 5),
      ],
      maxFileBytes: 40,
      maxTotalBytes: 25,
      maxFiles: 3,
    });
    assertEquals(plan.parts.map((part) => part.filename), ["a.pdf", "b.pdf", "d.pdf"]);
    assertEquals(
      plan.omitted.map(({ index, reason }) => [index, reason]),
      [[1, "over_file_limit"], [3, "over_total_budget"], [5, "over_count_limit"]],
    );
    assertEquals(plan.complete, false);
  });

  it("sends files that exactly fill the total and count budgets", () => {
    const plan = planFileParts({
      files: [pdf("a.pdf", 10), pdf("b.pdf", 10)],
      maxTotalBytes: 20,
      maxFiles: 2,
    });
    assertEquals([plan.complete, plan.parts.length], [true, 2]);
  });

  it("omits PDFs without a PDF header and invalid metadata instead of throwing", () => {
    const text = new TextEncoder().encode("hello, not a pdf");
    const late = new Uint8Array(1100);
    late.set(PDF_HEADER, 1030);
    const leading = new Uint8Array(32);
    leading.set(PDF_HEADER, 3);
    const plan = planFileParts({
      files: [
        { bytes: text, filename: "fake.pdf", mediaType: "Application/PDF" },
        { bytes: late, filename: "late.pdf", mediaType: "application/pdf" },
        { bytes: leading, filename: "leading.pdf", mediaType: "application/pdf" },
        { bytes: new Uint8Array(), filename: "empty.pdf", mediaType: "application/pdf" },
        { bytes: text, filename: "a\nb.txt", mediaType: "text/plain" },
        { bytes: text, filename: "notes.txt", mediaType: "text/plain;charset=utf-8" },
        { bytes: text, filename: "notes.txt", mediaType: "text/plain" },
      ],
      maxFiles: 10,
    });
    assertEquals(plan.parts.map((part) => part.filename), ["leading.pdf", "notes.txt"]);
    assertEquals(
      plan.omitted.map(({ index, reason }) => [index, reason]),
      [
        [0, "invalid_content"],
        [1, "invalid_content"],
        [3, "invalid_content"],
        [4, "invalid_metadata"],
        [5, "invalid_metadata"],
      ],
    );
    assertEquals(plan.complete, false);
  });

  it("rejects invalid budget options", () => {
    const files = [pdf("a.pdf", 8)];
    for (const option of ["maxFileBytes", "maxTotalBytes", "maxFiles"]) {
      for (const value of [0, -1, 1.5, NaN]) {
        assertInvalidArgument(
          () => planFileParts({ files, [option]: value }),
          `${option} must be a positive safe integer`,
        );
      }
    }
  });
});
