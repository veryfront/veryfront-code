import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __resetEnvLoaderForTests, loadEnv, supportsEnvFiles } from "./env-loader.ts";
import { __resetLoggerConfigForTests, type LogEntry, serverLogger } from "./logger/index.ts";

describe("env-loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "env-loader-test-" });
    __resetEnvLoaderForTests();
  });

  afterEach(async () => {
    __resetEnvLoaderForTests();
    await Deno.remove(tempDir, { recursive: true });
  });

  function createKey(suffix: string): string {
    return `TEST_ENV_LOADER_${Date.now()}_${suffix}`;
  }

  async function writeEnvFile(name: string, content: string): Promise<void> {
    await Deno.writeTextFile(`${tempDir}/${name}`, content);
  }

  function captureConsoleLog(): {
    getOutput: () => string;
    reset: () => void;
    restore: () => void;
  } {
    const originalLog = console.log;
    let capturedOutput = "";

    console.log = (message: string) => {
      capturedOutput = message;
    };

    return {
      getOutput: () => capturedOutput,
      reset: () => {
        capturedOutput = "";
      },
      restore: () => {
        console.log = originalLog;
      },
    };
  }

  function cleanupKeys(...keys: string[]): void {
    for (const key of keys) Deno.env.delete(key);
  }

  describe("supportsEnvFiles", () => {
    it("should return true in Deno environment", () => {
      assertEquals(supportsEnvFiles(), true);
    });
  });

  describe("loadEnv", () => {
    it("should load variables from .env file", async () => {
      const key = createKey("BASIC");
      await writeEnvFile(".env", `${key}=hello`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello");

      cleanupKeys(key);
    });

    it("should skip comments and blank lines", async () => {
      const key = createKey("COMMENTS");
      await writeEnvFile(
        ".env",
        `# This is a comment\n\n// Also a comment\n${key}=value\n`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      cleanupKeys(key);
    });

    it("should handle quoted values with double quotes", async () => {
      const key = createKey("DQ");
      await writeEnvFile(".env", `${key}="hello world"`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello world");

      cleanupKeys(key);
    });

    it("should handle quoted values with single quotes", async () => {
      const key = createKey("SQ");
      await writeEnvFile(".env", `${key}='hello world'`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "hello world");

      cleanupKeys(key);
    });

    it("should strip inline comments from unquoted values", async () => {
      const key = createKey("INLINE");
      await writeEnvFile(".env", `${key}=value # comment`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      cleanupKeys(key);
    });

    it("should expand variables with ${VAR} syntax", async () => {
      const key1 = createKey("BASE");
      const key2 = createKey("EXPANDED");
      await writeEnvFile(".env", `${key1}=hello\n${key2}=\${${key1}}_world`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key2), "hello_world");

      cleanupKeys(key1, key2);
    });

    it("should not override existing env vars by default", async () => {
      const key = createKey("NOOVERRIDE");
      Deno.env.set(key, "existing");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir });
      assertEquals(Deno.env.get(key), "existing");

      cleanupKeys(key);
    });

    it("should override existing env vars when override is true", async () => {
      const key = createKey("OVERRIDE");
      Deno.env.set(key, "existing");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "new");

      cleanupKeys(key);
    });

    it("should handle multiline values in double quotes", async () => {
      const key = createKey("MULTI");
      await writeEnvFile(".env", `${key}="line1\nline2"`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "line1\nline2");

      cleanupKeys(key);
    });

    it("should load .env.local with higher priority", async () => {
      const key = createKey("LOCAL");
      await writeEnvFile(".env", `${key}=from_env`);
      await writeEnvFile(".env.local", `${key}=from_local`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "from_local");

      cleanupKeys(key);
    });

    it("should handle lines without equals sign", async () => {
      const key = createKey("NOEQ");
      await writeEnvFile(".env", `noequalssign\n${key}=valid`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "valid");

      cleanupKeys(key);
    });

    it("should not throw when no env files exist", async () => {
      await loadEnv({ cwd: tempDir });
    });

    it("should handle empty values", async () => {
      const key = createKey("EMPTY");
      await writeEnvFile(".env", `${key}=`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "");

      cleanupKeys(key);
    });

    it("should handle values with equals signs", async () => {
      const key = createKey("EQ");
      await writeEnvFile(".env", `${key}=a=b=c`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "a=b=c");

      cleanupKeys(key);
    });

    it("should trim key names", async () => {
      const key = createKey("TRIM");
      await writeEnvFile(".env", `  ${key}  =value`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(Deno.env.get(key), "value");

      cleanupKeys(key);
    });

    it("should refresh logger format after loading NODE_ENV from .env", async () => {
      const previousNodeEnv = Deno.env.get("NODE_ENV");
      const previousLogFormat = Deno.env.get("LOG_FORMAT");
      const { getOutput, reset, restore } = captureConsoleLog();

      try {
        Deno.env.delete("NODE_ENV");
        Deno.env.delete("LOG_FORMAT");
        __resetLoggerConfigForTests();

        serverLogger.info("Text before loadEnv");
        assertEquals(getOutput().startsWith("{"), false);

        await writeEnvFile(".env", "NODE_ENV=production");
        await loadEnv({ cwd: tempDir, override: true });

        reset();
        serverLogger.info("JSON after loadEnv");

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.level, "info");
        assertEquals(entry.message, "JSON after loadEnv");
      } finally {
        restore();
        if (previousNodeEnv === undefined) Deno.env.delete("NODE_ENV");
        else Deno.env.set("NODE_ENV", previousNodeEnv);
        if (previousLogFormat === undefined) Deno.env.delete("LOG_FORMAT");
        else Deno.env.set("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
    });
  });
});
