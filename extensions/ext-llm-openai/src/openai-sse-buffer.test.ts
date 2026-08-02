import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  appendOpenAISseChunk,
  MAX_OPENAI_SSE_BUFFER_CODE_UNITS,
  parseOpenAISseBuffer,
} from "./openai-sse-buffer.ts";

describe("ext-llm-openai/openai-sse-buffer", () => {
  it("accepts the exact raw boundary and rejects pre-concat overflow", () => {
    const invalid = (issue: string) => new Error(issue);
    const exact = appendOpenAISseChunk(
      new TextDecoder("utf-8", { fatal: true }),
      "",
      new Uint8Array(MAX_OPENAI_SSE_BUFFER_CODE_UNITS),
      invalid,
    );
    assertEquals(exact.length, MAX_OPENAI_SSE_BUFFER_CODE_UNITS);

    assertThrows(
      () =>
        appendOpenAISseChunk(
          new TextDecoder("utf-8", { fatal: true }),
          exact,
          new Uint8Array([0]),
          invalid,
        ),
      Error,
      `SSE buffer exceeded ${MAX_OPENAI_SSE_BUFFER_CODE_UNITS} code units`,
    );
  });

  it("contextualizes fatal UTF-8 decoding failures", () => {
    assertThrows(
      () =>
        appendOpenAISseChunk(
          new TextDecoder("utf-8", { fatal: true }),
          "",
          new Uint8Array([0xff]),
          (issue) => new Error(`context: ${issue}`),
        ),
      Error,
      "context: stream contained invalid UTF-8",
    );
  });

  it("parses an unterminated final record at the exact decoded boundary", () => {
    const event = 'data: {"ok":true}';
    const trailing = `${"x".repeat(MAX_OPENAI_SSE_BUFFER_CODE_UNITS - event.length - 1)}\n${event}`;
    assertEquals(trailing.length, MAX_OPENAI_SSE_BUFFER_CODE_UNITS);
    assertEquals(
      parseOpenAISseBuffer(trailing, (issue) => new Error(issue), true),
      { events: [{ ok: true }], remainder: "" },
    );
  });
});
