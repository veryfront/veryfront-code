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
  it("renames files on the native filesystem", async () => {
    const adapter = new NodeFileSystemAdapter();
    const tempDir = await adapter.makeTempDir("vf-node-fs-rename-");
    const from = `${tempDir}/source.txt`;
    const to = `${tempDir}/destination.txt`;

    try {
      await adapter.writeFile(from, "renamed");
      await adapter.rename(from, to);
      assertEquals(await adapter.exists(from), false);
      assertEquals(await adapter.readFile(to), "renamed");
    } finally {
      await adapter.remove(tempDir, { recursive: true });
    }
  });

  it("enforces exact file limits without replacing exclusive targets", async () => {
    const adapter = new NodeFileSystemAdapter();
    const tempDir = await adapter.makeTempDir("vf-node-fs-bounded-");
    const sourcePath = `${tempDir}/source.bin`;
    const exclusivePath = `${tempDir}/exclusive.bin`;
    try {
      await adapter.writeFileBytes(sourcePath, new Uint8Array([1, 2, 3]));
      assertEquals([...await adapter.readFileBytesWithinLimit(sourcePath, 3)], [1, 2, 3]);
      assertEquals(
        [...await adapter.readFileSnapshotWithinLimit(sourcePath, tempDir, 3)],
        [1, 2, 3],
      );
      await assertRejects(
        () => adapter.readFileBytesWithinLimit(sourcePath, 2),
        RangeError,
        "exceeds byte limit",
      );

      await adapter.createFileBytesExclusive(exclusivePath, new Uint8Array([4]));
      await assertRejects(
        () => adapter.createFileBytesExclusive(exclusivePath, new Uint8Array([9])),
        Error,
      );
      assertEquals([...await adapter.readFileBytes(exclusivePath)], [4]);
    } finally {
      await adapter.remove(tempDir, { recursive: true });
    }
  });

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
      assertEquals(await adapter.exists("\0"), false);
      assertEquals(
        logs.entries.some((entry) => entry.message.includes("File access check failed")),
        true,
      );
    } finally {
      logs.restore();
    }
  });
});
