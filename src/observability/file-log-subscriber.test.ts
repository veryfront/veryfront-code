import { assertEquals } from "#veryfront/testing/assert.ts";
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
  });

  describe("FileLogSubscriber", () => {
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
      assertEquals(JSON.parse(lines[0]).message, "before");
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
