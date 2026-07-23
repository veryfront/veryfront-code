import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FileLogSubscriber, parseMaxSize } from "./file-log-subscriber.ts";
import { LogBuffer } from "./log-buffer.ts";
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

    it("does not echo invalid size input", () => {
      try {
        parseMaxSize("token=private-value");
        throw new Error("should have thrown");
      } catch (error) {
        assertEquals((error as Error).message.includes("private-value"), false);
      }
    });

    it("rejects non-positive and unsafe sizes", () => {
      for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "0kb", "999999999gb"]) {
        assertThrows(() => parseMaxSize(value));
      }
    });
  });

  describe("FileLogSubscriber", () => {
    it("rejects invalid file logging configuration", () => {
      assertThrows(() => new FileLogSubscriber(makeConfig({ path: "" })));
      assertThrows(() => new FileLogSubscriber(makeConfig({ path: "test.log", maxFiles: 0 })));
      assertThrows(() => new FileLogSubscriber(makeConfig({ path: "test.log", maxFiles: 101 })));
      assertThrows(() =>
        new FileLogSubscriber(makeConfig({
          path: "test.log",
          level: "trace" as unknown as FileLogConfig["level"],
        }))
      );
    });

    it("does not write when file logging is disabled", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/disabled.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath, enabled: false }));
      sub.getSubscriber()({
        id: "1",
        level: "info",
        message: "disabled",
        source: "test",
        timestamp: Date.now(),
      });

      await sub.flush();

      assertEquals(await fileExists(logPath), false);
      await sub.close();
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
      const sub = new FileLogSubscriber(makeConfig({
        path: logPath,
        maxSize: 100,
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

      const rotated1 = await fileExists(`${logPath}.1`);
      assertEquals(rotated1, true);

      await sub.close();
    });

    it("does not create an empty rotation for one oversized entry", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({
        path: logPath,
        maxSize: 10,
        maxFiles: 3,
      }));

      const buf = new LogBuffer();
      buf.subscribe(sub.getSubscriber());
      buf.info("one oversized entry", "test");
      await sub.flush();

      assertEquals(await fileExists(logPath), true);
      assertEquals(await fileExists(`${logPath}.1`), false);
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

    it("sanitizes entries received without a LogBuffer", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      sub.getSubscriber()({
        id: "1",
        level: "error",
        message: "token=secret-value at /private/workspace/app.ts",
        source: "test",
        timestamp: Date.now(),
        data: { apiKey: "secret-value" },
      });
      await sub.flush();

      const content = await Deno.readTextFile(logPath);
      assertEquals(content.includes("secret-value"), false);
      assertEquals(content.includes("/private/workspace"), false);
      assertEquals(content.includes("[REDACTED]"), true);
      await sub.close();
    });

    it("normalizes invalid direct-entry timestamps", async () => {
      const dir = await makeTempDir();
      const logPath = `${dir}/test.log`;
      const sub = new FileLogSubscriber(makeConfig({ path: logPath }));

      sub.getSubscriber()({
        id: "1",
        level: "info",
        message: "timestamp",
        source: "test",
        timestamp: Number.MAX_VALUE,
      });
      await sub.flush();

      const parsed = JSON.parse((await Deno.readTextFile(logPath)).trim());
      assertEquals(Number.isSafeInteger(parsed.timestamp), true);
      await sub.close();
    });

    it("should log non-permission write queue failures", async () => {
      const dir = await makeTempDir();
      const sub = new FileLogSubscriber(makeConfig({ path: dir }));
      const originalError = console.error;
      const errors: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };

      try {
        const buf = new LogBuffer();
        buf.subscribe(sub.getSubscriber());

        buf.info("cannot write to a directory", "test");
        await sub.flush();
      } finally {
        console.error = originalError;
      }

      assertEquals(
        errors.some((args) =>
          args[0] === "[FileLogSubscriber] File write failed. File logging will continue." &&
          JSON.stringify(args[1]) === JSON.stringify({ failure_category: "error" })
        ),
        true,
      );
      assertEquals(JSON.stringify(errors).includes(dir), false);
    });
  });
});

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
