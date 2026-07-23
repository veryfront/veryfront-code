import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseSseChunk } from "./provider-sse.ts";

describe("provider/runtime-loader/provider-sse", () => {
  it("rejects an unbounded incomplete event", () => {
    assertThrows(
      () => parseSseChunk(`data: ${"x".repeat(4 * 1_024 * 1_024 + 1)}`),
      RangeError,
      "SSE event",
    );
  });

  it("rejects malformed events without exposing provider payload content", () => {
    const secret = "private-model-output";
    const payload = `{"text":"${secret}"`;
    const error = assertThrows(
      () => parseSseChunk(`data: ${payload}\n\n`),
      SyntaxError,
      "invalid JSON",
    );

    assertEquals(error.message.includes(secret), false);
  });

  it("can explicitly ignore a malformed event and continue parsing", () => {
    assertEquals(
      parseSseChunk('data: {invalid}\n\ndata: {"ok":true}\n\n', {
        invalidEventPolicy: "ignore",
      }),
      { events: [{ ok: true }], remainder: "" },
    );
  });

  it("supports carriage-return event separators", () => {
    assertEquals(parseSseChunk('data: {"ok":true}\r\r'), {
      events: [{ ok: true }],
      remainder: "",
    });
  });

  it("supports carriage-return line separators inside an event", () => {
    assertEquals(parseSseChunk('data: {"ok":\rdata: true}\r\r'), {
      events: [{ ok: true }],
      remainder: "",
    });
  });

  it("bounds the number of events parsed from one chunk", () => {
    assertThrows(
      () => parseSseChunk('data: {"ok":true}\n\n'.repeat(4_097)),
      RangeError,
      "too many events",
    );
  });
});
