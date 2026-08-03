import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { MAX_PROVIDER_SSE_BUFFER_CODE_UNITS, parseSseChunk } from "./provider-sse.ts";

function captureThrownError(
  fn: () => unknown,
  expectedType?: typeof Error,
  messageIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    if (messageIncludes && !error.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include ${messageIncludes}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

describe("provider/runtime-loader/provider-sse", () => {
  it("rejects malformed events without logging provider payload content", () => {
    const originalDebug = console.debug;
    const secret = "private-model-output";
    const payload = `{"text":"${secret}"`;
    let output = "";
    console.debug = (message: string) => {
      output = message;
    };
    const originalFormat = Deno.env.get("LOG_FORMAT");
    const originalLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_FORMAT", "json");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();

    try {
      const error = captureThrownError(
        () => parseSseChunk(`data: ${payload}\n\n`),
        SyntaxError,
        "contained malformed JSON",
      );
      assertEquals(error.message.includes(secret), false);
      assertEquals(error.cause, undefined);
    } finally {
      console.debug = originalDebug;
      if (originalFormat === undefined) Deno.env.delete("LOG_FORMAT");
      else Deno.env.set("LOG_FORMAT", originalFormat);
      if (originalLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", originalLevel);
      __resetLoggerConfigForTests();
    }

    assertEquals(output.includes(secret), false);
    const entry = JSON.parse(output) as LogEntry;
    assertEquals(entry.context?.payloadLength, payload.length);
    assertEquals("payload" in (entry.context ?? {}), false);
  });

  it("parses SSE events framed with CR-only line endings", () => {
    assertEquals(parseSseChunk('data: {"ok":true}\r\r'), {
      events: [{ ok: true }],
      remainder: "",
    });
  });

  it("bounds delimiter-free provider SSE data", () => {
    assertThrows(
      () => parseSseChunk("x".repeat(MAX_PROVIDER_SSE_BUFFER_CODE_UNITS + 1)),
      RangeError,
      "buffer exceeded",
    );
  });
});
