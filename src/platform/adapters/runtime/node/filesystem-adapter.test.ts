import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { NodeFileSystemAdapter } from "./filesystem-adapter.ts";

function captureDebugLogs(): { entries: LogEntry[]; restore: () => void } {
  const originalLogLevel = Deno.env.get("LOG_LEVEL");
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const entries: LogEntry[] = [];

  console.debug =
    console.error =
    console.log =
    console.warn =
      () => {};
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));

  return {
    entries,
    restore: () => {
      __resetLogRecordEmitterForTests();
      console.debug = originalConsole.debug;
      console.error = originalConsole.error;
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      if (originalLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", originalLogLevel);
      __resetLoggerConfigForTests();
    },
  };
}

describe("NodeFileSystemAdapter", () => {
  it("does not log an expected missing path as an access failure", async () => {
    const adapter = new NodeFileSystemAdapter();
    const tempDir = await adapter.makeTempDir("vf-node-fs-exists-");
    const logs = captureDebugLogs();

    try {
      assertEquals(await adapter.exists(`${tempDir}/missing`), false);
      assertEquals(
        logs.entries.some((entry) => entry.message.includes("File access check failed")),
        false,
      );
    } finally {
      logs.restore();
      await adapter.remove(tempDir, { recursive: true });
    }
  });

  it("keeps unexpected access failures visible in debug logs", async () => {
    const adapter = new NodeFileSystemAdapter();
    const logs = captureDebugLogs();

    try {
      await assertRejects(() => adapter.exists("\0"), TypeError);
      assertEquals(
        logs.entries.some((entry) => entry.message.includes("File access check failed")),
        true,
      );
    } finally {
      logs.restore();
    }
  });
});
