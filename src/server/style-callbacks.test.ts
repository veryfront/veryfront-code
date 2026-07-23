import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
  refreshLoggerConfig,
} from "#veryfront/utils/logger/logger.ts";
import { createServerStyleCallbacks } from "./style-callbacks.ts";

describe("server/style-callbacks", () => {
  it("does not log project identity when style pre-generation has no directory", async () => {
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    refreshLoggerConfig();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      const result = await createServerStyleCallbacks().pregenerateStyles?.([], {
        projectSlug: "PRIVATE_STYLE_PROJECT_CANARY",
        contentContext: null,
      });

      assertEquals(result, undefined);
      assertEquals(JSON.stringify(entries).includes("PRIVATE_STYLE_PROJECT_CANARY"), false);
    } finally {
      __resetLogRecordEmitterForTests();
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      refreshLoggerConfig();
    }
  });
});
