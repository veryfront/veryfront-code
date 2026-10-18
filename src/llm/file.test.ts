import { Buffer } from "node:buffer";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { fileFromBytes } from "./file.ts";

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
