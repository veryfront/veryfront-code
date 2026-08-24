import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_STRING_DISPLAY_LENGTH } from "#veryfront/utils/constants/index.ts";
import { MAX_FILE_LOG_FILES } from "#veryfront/utils/config-resource-limits.ts";
import { FileLogSubscriber, parseMaxSize, writeAll } from "./file-log-subscriber.ts";
import {
  MAX_FILE_LOG_PENDING_WRITES,
  MAX_FILE_LOG_RETAINED_FAILURES,
  MAX_OBSERVABILITY_NAME_LENGTH,
} from "./limits.ts";
import { LogBuffer, type LogEntry } from "./log-buffer.ts";
import type { FileLogConfig } from "./file-log-subscriber.ts";

function makeConfig(overrides: Partial<FileLogConfig> & { path: string }): FileLogConfig {
  return {
    enabled: true,
    maxSize: "1mb",
    maxFiles: 3,
    level: "debug",
    format: "json",
    ...overrides,
  };
}

describe("observability/file-log-subscriber", () => {
  const tempDirs: string[] = [];

  async function makeTempDir(): Promise<string> {
    const dir = await Deno.makeTempDir({ prefix: "vf-file-log-test-" });
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tempDirs) {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch { /* already cleaned */ }
    }
    tempDirs.length = 0;
  });

  describe("parseMaxSize", () => {
    it("should parse plain numbers", () => {
      assertEquals(parseMaxSize(1024), 1024);
    });

    it("should parse kb suffix", () => {
      assertEquals(parseMaxSize("10kb"), 10 * 1024);
    });

    it("should parse mb suffix", () => {
      assertEquals(parseMaxSize("5mb"), 5 * 1024 * 1024);
    });

    it("should parse gb suffix", () => {
      assertEquals(parseMaxSize("1gb"), 1024 * 1024 * 1024);
    });

    it("should parse bare number strings", () => {
      assertEquals(parseMaxSize("512"), 512);
    });

    it("should reject invalid strings", () => {
      try {
        parseMaxSize("abc");
        throw new Error("should have thrown");
      } catch (err) {
        assertEquals((err as Error).message.includes("Invalid maxSize"), true);
      }
    });

    it("should reject non-positive and non-finite sizes", () => {
      assertThrows(() => parseMaxSize(0), RangeError, "maxSize");
      assertThrows(() => parseMaxSize(-1), RangeError, "maxSize");
      assertThrows(() => parseMaxSize(Number.POSITIVE_INFINITY), RangeError, "maxSize");
    });
  });

  describe("writeAll", () => {
    it("retries partial writes until every byte is persisted", async () => {
      const writes: number[] = [];
      const writer = {
        write(bytes: Uint8Array): Promise<number> {
          const written = Math.min(2, bytes.length);
          writes.push(written);
          return Promise.resolve(written);
        },
      };

      await writeAll(writer, new Uint8Array([1, 2, 3, 4, 5]));

      assertEquals(writes, [2, 2, 1]);
    });

    it("rejects a zero-progress write instead of looping forever", async () => {
      await assertRejects(
        () => writeAll({ write: () => Promise.resolve(0) }, new Uint8Array([1])),
        Error,
        "zero bytes",
      );
    });
  });

  describe("FileLogSubscriber", () => {
    it("should reject invalid rotation counts and empty paths", () => {
      assertThrows(
        () => new FileLogSubscriber(makeConfig({ path: "test.log", maxFiles: 0 })),
        RangeError,
        "maxFiles",
      );
      assertThrows(
        () =>
          new FileLogSubscriber({
            ...makeConfig({ path: "test.log" }),
            maxFiles: MAX_FILE_LOG_FILES + 1,
          }),
        RangeError,
        "maxFiles",
      );
      assertThrows(
        () => new FileLogSubscriber(makeConfig({ path: "  " })),
        TypeError,
        "path",
      );
      assertThrows(
        () =>
          new FileLogSubscriber({
            ...makeConfig({ path: "test.log" }),
            level: "toString" as never,
          }),
        TypeError,
        "level",
      );
    });

    it("should not create or write a file when disabled", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/disabled.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, enabled: false }));
      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("must not be written");
      await sub.close();

      assertEquals(await fileExists(logPath), false);
    });

    it("should write log entries as JSON", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, format: "json" }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("hello world", "test");
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      const parsed = JSON.parse(content.trim());
      assertEquals(parsed.message, "hello world");
      assertEquals(parsed.level, "info");
      assertEquals(parsed.source, "test");

      await sub.close();
    });

    it("should redact direct subscriber entries before writing", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/direct.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, format: "json" }));

      sub.getSubscriber()({
        id: "direct",
        level: "error" as const,
        message: "failed https://example.test/path?token=secret",
        data: { apiKey: "secret", safe: "value" },
        timestamp: 1,
        source: "test",
      });
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes("secret"), false);
      assertEquals(content.includes("[REDACTED]"), true);

      await sub.close();
    });

    it("bounds and projects direct entries before queueing them", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/bounded-direct.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      sub.getSubscriber()(
        {
          id: "i".repeat(MAX_OBSERVABILITY_NAME_LENGTH + 100),
          level: "info",
          message: "m".repeat(MAX_STRING_DISPLAY_LENGTH + 100),
          timestamp: Date.now(),
          source: "s".repeat(MAX_OBSERVABILITY_NAME_LENGTH + 100),
          undeclared: "must not be retained",
        } as LogEntry & { undeclared: string },
      );
      await sub.flush();

      const entry = JSON.parse(
        (await Deno.readTextFile(logPath)).trim(),
      ) as Record<string, unknown>;
      assertEquals((entry.id as string).length, MAX_OBSERVABILITY_NAME_LENGTH);
      assertEquals(
        (entry.message as string).length,
        MAX_STRING_DISPLAY_LENGTH,
      );
      assertEquals(
        (entry.source as string).length,
        MAX_OBSERVABILITY_NAME_LENGTH,
      );
      assertEquals(Object.hasOwn(entry, "undeclared"), false);

      await sub.close();
    });

    it("should write log entries as text", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, format: "text" }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.warn("something bad", "myapp");
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes("WARN"), true);
      assertEquals(content.includes("[myapp]"), true);
      assertEquals(content.includes("something bad"), true);

      await sub.close();
    });

    it("should filter entries below minimum level", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, level: "warn" }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.debug("d");
      buf.info("i");
      buf.warn("w");
      buf.error("e");
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 2);

      const messages = lines.map((l) => JSON.parse(l).message);
      assertEquals(messages, ["w", "e"]);

      await sub.close();
    });

    it("should rotate when file exceeds maxSize", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      // Comfortably above three records so a rotated file must retain a run,
      // not a single entry.
      const sub = new FileLogSubscriber(makeConfig({
        path: logPath,
        maxSize: 400,
        maxFiles: 3,
      }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      for (let i = 0; i < 10; i++) {
        buf.info(`message-${i}`, "test");
      }
      await sub.flush();

      const mainExists = await fileExists(logPath);
      assertEquals(mainExists, true);

      const rotated1Exists = await fileExists(`${logPath}.1`);
      assertEquals(rotated1Exists, true);

      const rotated1 = await readLoggedMessages(`${logPath}.1`);
      assertEquals(
        rotated1.length > 1,
        true,
        "a rotated file must hold every record written before the size limit, not one per entry",
      );

      const combined = [
        ...(await fileExists(`${logPath}.2`) ? await readLoggedMessages(`${logPath}.2`) : []),
        ...rotated1,
        ...await readLoggedMessages(logPath),
      ];
      const oldestIndex = Number(combined[0]?.slice("message-".length));
      assertEquals(
        combined,
        Array.from({ length: combined.length }, (_, offset) => `message-${oldestIndex + offset}`),
        "rotation must not drop records mid-run",
      );
      assertEquals(
        combined.at(-1),
        "message-9",
        "rotation must retain the newest record in the active file",
      );

      await sub.close();
    });

    it("should limit rotated files to maxFiles", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({
        path: logPath,
        maxSize: 50,
        maxFiles: 2,
      }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      for (let i = 0; i < 20; i++) {
        buf.info(`msg-${i}`, "test");
      }
      await sub.flush();

      const rotated1 = await fileExists(`${logPath}.1`);
      assertEquals(rotated1, true);

      const rotated2 = await fileExists(`${logPath}.2`);
      assertEquals(rotated2, false);

      await sub.close();
    });

    it("should create parent directories if needed", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/nested/deep/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("nested test");
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes("nested test"), true);

      await sub.close();
    });

    it("should flush pending writes on close", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("before close");
      await sub.close();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes("before close"), true);
    });

    it("should not write after close", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("before");
      await sub.close();

      buf.info("after");
      await delay(50);

      const content = await Deno.readTextFile(logPath);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 1);
      assertEquals(JSON.parse(lines[0] ?? "").message, "before");
    });

    it("should include data field in text format", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, format: "text" }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());

      buf.info("with data", "test", { key: "value" });
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes('"key":"value"'), true);

      await sub.close();
    });

    it("reports non-permission write failures to both diagnostics and flush callers", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: dir }));
      const originalError = console.error;
      const errors: string[] = [];
      console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      };

      try {
        const buf = new LogBuffer();
        buf.subscribe(sub.getSubscriber());

        buf.info("cannot write to a directory", "test");
        await assertRejects(() => sub.flush(), Error);
      } finally {
        console.error = originalError;
      }

      assertEquals(
        errors.some((line) =>
          line.includes("FileLogSubscriber: failed writing to") &&
          line.includes("file logging will continue")
        ),
        true,
      );
    });

    for (const stage of ["directory", "open/stat", "rotation", "write"] as const) {
      it(`atomically disables file logging after a ${stage} permission denial`, async () => {
        const dir = await makeTempDir();
        const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/permission.log` }));
        const internals = sub as unknown as {
          file: {
            write(bytes: Uint8Array): Promise<number>;
            truncate(length: number): Promise<void>;
            seek(offset: number, whence: number): Promise<number>;
            sync(): Promise<void>;
            close(): void;
          } | null;
          currentSize: number;
          maxSizeBytes: number;
          ensureDir(): Promise<void>;
          openFile(): Promise<void>;
          rotate(): Promise<void>;
        };
        const denial = new Deno.errors.PermissionDenied(`${stage} denied`);
        let filesystemCalls = 0;
        const fakeFile = {
          write(bytes: Uint8Array): Promise<number> {
            filesystemCalls++;
            return stage === "write" ? Promise.reject(denial) : Promise.resolve(bytes.length);
          },
          truncate(): Promise<void> {
            filesystemCalls++;
            return Promise.resolve();
          },
          seek(offset: number): Promise<number> {
            filesystemCalls++;
            return Promise.resolve(offset);
          },
          sync(): Promise<void> {
            filesystemCalls++;
            return Promise.resolve();
          },
          close(): void {
            filesystemCalls++;
          },
        };

        if (stage === "directory") {
          internals.ensureDir = () => {
            filesystemCalls++;
            return Promise.reject(denial);
          };
        } else if (stage === "open/stat") {
          internals.openFile = () => {
            filesystemCalls++;
            return Promise.reject(denial);
          };
        } else {
          internals.file = fakeFile;
          if (stage === "rotation") {
            internals.currentSize = 1;
            internals.maxSizeBytes = 1;
            internals.rotate = () => {
              filesystemCalls++;
              return Promise.reject(denial);
            };
          }
        }

        const originalError = console.error;
        console.error = () => {};
        try {
          const subscriber = sub.getSubscriber();
          subscriber({
            id: "denied",
            level: "error",
            message: "first",
            timestamp: Date.now(),
            source: "test",
          });
          await assertRejects(() => sub.flush(), Deno.errors.PermissionDenied);
          const callsAfterDenial = filesystemCalls;

          subscriber({
            id: "ignored",
            level: "error",
            message: "second",
            timestamp: Date.now(),
            source: "test",
          });
          await sub.flush();

          assertEquals(filesystemCalls, callsAfterDenial);
        } finally {
          console.error = originalError;
          await sub.close();
        }
      });
    }

    it("truncates a partial record and keeps a recovered handle retryable", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/partial.log` }));
      let writeCalls = 0;
      let closeCalls = 0;
      const truncations: number[] = [];
      let fail = true;
      const internals = sub as unknown as {
        file: {
          write(bytes: Uint8Array): Promise<number>;
          truncate(length: number): Promise<void>;
          seek(offset: number, whence: number): Promise<number>;
          sync(): Promise<void>;
          close(): void;
        } | null;
        currentSize: number;
      };
      internals.file = {
        write(bytes) {
          writeCalls++;
          if (fail && writeCalls === 1) return Promise.resolve(Math.min(1, bytes.length));
          if (fail) {
            fail = false;
            return Promise.reject(new Error("device unavailable"));
          }
          return Promise.resolve(bytes.length);
        },
        truncate(length) {
          truncations.push(length);
          return Promise.resolve();
        },
        seek(offset) {
          return Promise.resolve(offset);
        },
        sync() {
          return Promise.resolve();
        },
        close() {
          closeCalls++;
        },
      };
      internals.currentSize = 100;
      const originalError = console.error;
      console.error = () => {};

      try {
        sub.getSubscriber()({
          id: "partial",
          level: "error",
          message: "partial write",
          timestamp: Date.now(),
          source: "test",
        });
        await assertRejects(() => sub.flush(), Error, "device unavailable");
        sub.getSubscriber()({
          id: "recovered",
          level: "error",
          message: "complete record",
          timestamp: Date.now(),
          source: "test",
        });
        await sub.flush();
      } finally {
        console.error = originalError;
        await sub.close();
      }

      assertEquals(writeCalls, 3);
      assertEquals(truncations, [100]);
      assertEquals(closeCalls, 1);
      assertEquals(internals.file, null);
      assertEquals(internals.currentSize > 100, true);
    });

    it("preserves the write failure when failure reporting itself throws", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: dir }));
      const originalError = console.error;
      console.error = () => {
        throw new Error("console unavailable");
      };

      try {
        sub.getSubscriber()({
          id: "failure",
          level: "error",
          message: "cannot write",
          timestamp: Date.now(),
          source: "test",
        });
        await assertRejects(() => sub.flush(), Error);
      } finally {
        console.error = originalError;
        await sub.close();
      }
    });

    it("bounds queued entries when the filesystem stops making progress", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/bounded.log` }));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const internals = sub as unknown as {
        pendingWrites: number;
        queueGeneration: number;
        writeEntry(entry: unknown): Promise<void>;
      };
      internals.writeEntry = () => gate;
      const subscriber = sub.getSubscriber();
      const entry = {
        id: "queued",
        level: "info" as const,
        message: "queued",
        timestamp: Date.now(),
        source: "test",
      };

      for (let index = 0; index <= MAX_FILE_LOG_PENDING_WRITES; index++) {
        subscriber({ ...entry, id: `queued-${index}` });
      }

      assertEquals(internals.pendingWrites, MAX_FILE_LOG_PENDING_WRITES);
      assertEquals(internals.queueGeneration, MAX_FILE_LOG_PENDING_WRITES);
      release();
      await assertRejects(() => sub.flush(), Error, "capacity");
      await sub.close();
    });

    it("retains only a bounded sample of repeated file-log failures", () => {
      const sub = new FileLogSubscriber(makeConfig({ path: "ignored.log" }));
      const internals = sub as unknown as {
        pendingFailures: unknown[];
        omittedFailureCount: number;
        recordFailure(error: unknown): void;
      };

      for (let index = 0; index < MAX_FILE_LOG_RETAINED_FAILURES + 10; index++) {
        internals.recordFailure(new Error(`failure-${index}`));
      }

      assertEquals(internals.pendingFailures.length, MAX_FILE_LOG_RETAINED_FAILURES);
      assertEquals(internals.omittedFailureCount, 10);
    });

    it("shares one recorded failure across concurrent flush callers", async () => {
      const sub = new FileLogSubscriber(makeConfig({ path: "ignored.log" }));
      const internals = sub as unknown as {
        recordFailure(error: unknown): void;
      };
      internals.recordFailure(new Error("shared failure"));

      const first = sub.flush();
      const second = sub.flush();

      assertStrictEquals(second, first);
      const results = await Promise.allSettled([first, second]);
      assertEquals(
        results.map((result) => result.status),
        ["rejected", "rejected"],
      );
      await sub.close();
    });

    it("waits for writes queued during an active flush before a later flush resolves", async () => {
      const sub = new FileLogSubscriber(makeConfig({ path: "ignored.log" }));
      let signalFirstSyncStarted!: () => void;
      let releaseFirstSync!: () => void;
      let signalWriteStarted!: () => void;
      let releaseWrite!: () => void;
      const firstSyncStarted = new Promise<void>((resolve) => {
        signalFirstSyncStarted = resolve;
      });
      const firstSyncGate = new Promise<void>((resolve) => {
        releaseFirstSync = resolve;
      });
      const writeStarted = new Promise<void>((resolve) => {
        signalWriteStarted = resolve;
      });
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let syncCalls = 0;
      const internals = sub as unknown as {
        file: { sync(): Promise<void>; close(): void } | null;
        writeEntry(entry: LogEntry): Promise<void>;
      };
      internals.file = {
        sync() {
          syncCalls++;
          if (syncCalls === 1) {
            signalFirstSyncStarted();
            return firstSyncGate;
          }
          return Promise.resolve();
        },
        close() {},
      };
      internals.writeEntry = () => {
        signalWriteStarted();
        return writeGate;
      };

      const firstFlush = sub.flush();
      await firstSyncStarted;
      sub.getSubscriber()({
        id: "queued-during-flush",
        level: "info",
        message: "queued during flush",
        timestamp: Date.now(),
        source: "test",
      });
      const laterFlush = sub.flush();

      try {
        releaseFirstSync();
        await writeStarted;
        const settlement = laterFlush.then(
          () => "settled",
          () => "settled",
        );
        assertEquals(
          await Promise.race([
            settlement,
            delay(0).then(() => "pending"),
          ]),
          "pending",
        );

        releaseWrite();
        await Promise.all([firstFlush, laterFlush]);
        assertEquals(syncCalls, 2);
      } finally {
        releaseFirstSync();
        releaseWrite();
        await Promise.allSettled([firstFlush, laterFlush]);
        await sub.close();
      }
    });

    it("closes and clears the file even when flushing rejects", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/close.log` }));
      let closeCalls = 0;
      const internals = sub as unknown as {
        file: { close(): void } | null;
        writeQueue: Promise<void>;
      };
      internals.file = { close: () => closeCalls++ };
      internals.writeQueue = Promise.reject(new Error("flush failed"));

      await assertRejects(() => sub.close(), Error, "flush failed");

      assertEquals(closeCalls, 1);
      assertEquals(internals.file, null);
    });

    it("surfaces durability sync failures from flush", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/sync.log` }));
      const internals = sub as unknown as {
        file: { sync(): Promise<void>; close(): void } | null;
      };
      internals.file = {
        sync: () => Promise.reject(new Error("sync unavailable")),
        close: () => {},
      };

      await assertRejects(() => sub.flush(), Error, "sync unavailable");
      await assertRejects(() => sub.close(), Error, "sync unavailable");
    });

    it("shares a transient close failure, then retries cleanup exactly once", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/close-error.log` }));
      let closeCalls = 0;
      const internals = sub as unknown as {
        file: { sync(): Promise<void>; close(): void } | null;
      };
      const file = {
        sync: () => Promise.resolve(),
        close: () => {
          closeCalls++;
          if (closeCalls === 1) throw new Error("close temporarily unavailable");
        },
      };
      internals.file = file;

      const concurrentResults = await Promise.allSettled([
        sub.close(),
        sub.close(),
      ]);

      assertEquals(
        concurrentResults.map((result) => result.status),
        ["rejected", "rejected"],
      );
      assertEquals(closeCalls, 1);
      assertEquals(internals.file, file);

      await Promise.all([sub.close(), sub.close()]);

      assertEquals(closeCalls, 2);
      assertEquals(internals.file, null);

      await sub.close();
      assertEquals(closeCalls, 2);
    });

    it("shares one successful close attempt across concurrent callers", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: `${dir}/close-once.log` }));
      let closeCalls = 0;
      let signalSyncStarted!: () => void;
      let releaseSync!: () => void;
      const syncStarted = new Promise<void>((resolve) => {
        signalSyncStarted = resolve;
      });
      const syncGate = new Promise<void>((resolve) => {
        releaseSync = resolve;
      });
      const internals = sub as unknown as {
        file: { sync(): Promise<void>; close(): void } | null;
      };
      internals.file = {
        sync: () => {
          signalSyncStarted();
          return syncGate;
        },
        close: () => {
          closeCalls++;
        },
      };

      const firstClose = sub.close();
      await syncStarted;
      const secondClose = sub.close();
      releaseSync();
      await Promise.all([firstClose, secondClose]);

      assertEquals(closeCalls, 1);
      assertEquals(internals.file, null);

      await sub.close();
      assertEquals(closeCalls, 1);
    });

    it("keeps the passive subscriber callback fail-open for hostile entries", () => {
      const sub = new FileLogSubscriber(makeConfig({ path: "ignored.log" }));
      const entry = {
        id: "hostile",
        level: "error" as const,
        get message(): string {
          throw new Error("message unavailable");
        },
        timestamp: Date.now(),
        source: "test",
      };

      sub.getSubscriber()(entry);
    });
  });
});

async function readLoggedMessages(path: string): Promise<string[]> {
  const content = await Deno.readTextFile(path);
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { message: string }).message);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
