import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fileFromBytes } from "./file.ts";

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
    for (
      const change of [
        { filename: " " },
        { mediaType: "application/pdf;base64,secret" },
        { maxBytes: 0 },
        { maxBytes: NaN },
        { maxBytes: 0.5 },
        { bytes: new Uint8Array() },
      ]
    ) {
      assertThrows(() => fileFromBytes({ ...input, ...change }));
    }
    assertThrows(() => fileFromBytes({ ...input, bytes: new Uint8Array(2), maxBytes: 1 }));
  });
});
