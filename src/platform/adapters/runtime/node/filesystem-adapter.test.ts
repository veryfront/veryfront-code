import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { isNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
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
  it("constructs exact snapshot and exclusive-create capabilities independently", async () => {
    const root = await Deno.makeTempDir({ prefix: "vf-node-snapshot-factory-" });
    try {
      const empty = join(root, "empty.bin");
      const exact = join(root, "exact.bin");
      const oversized = join(root, "oversized.bin");
      const directory = join(root, "directory");
      const link = join(root, "link.bin");
      await Deno.writeFile(empty, new Uint8Array());
      await Deno.writeFile(exact, new Uint8Array([1, 2, 3]));
      await Deno.writeFile(oversized, new Uint8Array([1, 2, 3, 4]));
      await Deno.mkdir(directory);
      await Deno.symlink(exact, link);
      const adapter = new NodeFileSystemAdapter();

      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
      const readSnapshot = adapter.readFileSnapshotWithinLimit;
      if (readSnapshot === undefined) return;
      assertExists(readSnapshot);
      assertEquals([...await readSnapshot(empty, root, 1)], []);
      assertEquals([...await readSnapshot(exact, root, 3)], [1, 2, 3]);
      await assertRejects(
        () => readSnapshot(oversized, root, 3),
        RangeError,
      );
      for (const limit of [0, Number.MAX_SAFE_INTEGER + 1]) {
        await assertRejects(
          () => readSnapshot(exact, root, limit),
          RangeError,
        );
      }
      await assertRejects(
        () => readSnapshot(directory, root, 3),
        TypeError,
      );
      await assertRejects(
        () => readSnapshot(link, root, 3),
        TypeError,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("requires O_NOFOLLOW on POSIX and actual Node provenance on Windows", () => {
    const TestableAdapter = NodeFileSystemAdapter as unknown as new (
      options: { noFollow?: number; platform?: "posix" | "windows" },
    ) => NodeFileSystemAdapter;
    for (const noFollow of [undefined, 0]) {
      const adapter = new TestableAdapter({ noFollow, platform: "posix" });
      assertEquals(Object.hasOwn(adapter, "readFileSnapshotWithinLimit"), false);
      assertEquals(Object.hasOwn(adapter, "createFileBytesExclusive"), true);
    }
    const windowsAdapter = new TestableAdapter({ noFollow: 1, platform: "windows" });
    // Tests run under Deno; changing path semantics must not forge Node runtime
    // provenance for a Node-compatible filesystem implementation.
    assertEquals(Object.hasOwn(windowsAdapter, "readFileSnapshotWithinLimit"), false);
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
      await assertRejects(() => adapter.exists("\0"), TypeError);
      assertEquals(
        logs.entries.some((entry) => entry.message.includes("File access check failed")),
        true,
      );
    } finally {
      logs.restore();
    }
  });

  it("marks only direct built-in instances as native", () => {
    class DerivedAdapter extends NodeFileSystemAdapter {}

    assertEquals(isNativeFileSystemAdapter(new NodeFileSystemAdapter()), true);
    assertEquals(isNativeFileSystemAdapter(new DerivedAdapter()), false);
  });

  it("refuses a subclass that hides its own prototype.constructor", () => {
    class ConstructorDeletingAdapter extends NodeFileSystemAdapter {}
    Reflect.deleteProperty(ConstructorDeletingAdapter.prototype, "constructor");

    class ConstructorSpoofingAdapter extends NodeFileSystemAdapter {}
    Object.defineProperty(ConstructorSpoofingAdapter.prototype, "constructor", {
      configurable: true,
      value: NodeFileSystemAdapter,
    });

    assertEquals(
      isNativeFileSystemAdapter(new ConstructorDeletingAdapter()),
      false,
    );
    assertEquals(
      isNativeFileSystemAdapter(new ConstructorSpoofingAdapter()),
      false,
    );
  });
});
