import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { parseSseChunk } from "./provider-sse.ts";

describe("provider/runtime-loader/provider-sse", () => {
  it("drops malformed events without logging provider payload content", () => {
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
      const parsed = parseSseChunk(`data: ${payload}\n\n`);
      assertEquals(parsed.events, []);
      assertEquals(parsed.remainder, "");
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
});
