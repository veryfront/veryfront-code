import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
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
    for (const key of keys) deleteEnv(key);
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
      assertEquals(getEnv(key), "hello");

      cleanupKeys(key);
    });

    it("should skip comments and blank lines", async () => {
      const key = createKey("COMMENTS");
      await writeEnvFile(
        ".env",
        `# This is a comment\n\n// Also a comment\n${key}=value\n`,
      );

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "value");

      cleanupKeys(key);
    });

    it("should handle quoted values with double quotes", async () => {
      const key = createKey("DQ");
      await writeEnvFile(".env", `${key}="hello world"`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "hello world");

      cleanupKeys(key);
    });

    it("should handle quoted values with single quotes", async () => {
      const key = createKey("SQ");
      await writeEnvFile(".env", `${key}='hello world'`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "hello world");

      cleanupKeys(key);
    });

    it("handles escaped quotes and backslashes in quoted values", async () => {
      const doubleKey = createKey("ESCAPED_DQ");
      const singleKey = createKey("ESCAPED_SQ");
      await writeEnvFile(
        ".env",
        `${doubleKey}="say \\"hello\\" at C:\\\\temp"\n${singleKey}='it\\'s \\\\safe'`,
      );

      await loadEnv({ cwd: tempDir, override: true });

      assertEquals(getEnv(doubleKey), 'say "hello" at C:\\temp');
      assertEquals(getEnv(singleKey), "it's \\safe");
      cleanupKeys(doubleKey, singleKey);
    });

    it("should strip inline comments from unquoted values", async () => {
      const key = createKey("INLINE");
      await writeEnvFile(".env", `${key}=value # comment`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "value");

      cleanupKeys(key);
    });

    it("should preserve a '#' that is part of the value (no leading whitespace)", async () => {
      const key = createKey("FRAGMENT");
      await writeEnvFile(".env", `${key}=rediss://host:6379/0#pool=5`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "rediss://host:6379/0#pool=5");

      cleanupKeys(key);
    });

    it("should expand variables with ${VAR} syntax", async () => {
      const key1 = createKey("BASE");
      const key2 = createKey("EXPANDED");
      await writeEnvFile(".env", `${key1}=hello\n${key2}=\${${key1}}_world`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key2), "hello_world");

      cleanupKeys(key1, key2);
    });

    it("should not override existing env vars by default", async () => {
      const key = createKey("NOOVERRIDE");
      setEnv(key, "existing");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir });
      assertEquals(getEnv(key), "existing");

      cleanupKeys(key);
    });

    it("preserves an existing empty process value by default", async () => {
      const key = createKey("EMPTY_EXISTING");
      setEnv(key, "");
      await writeEnvFile(".env", `${key}=replacement`);

      await loadEnv({ cwd: tempDir });
      assertEquals(getEnv(key), "");

      cleanupKeys(key);
    });

    it("lets later env files override earlier files without overriding the process", async () => {
      const layeredKey = createKey("LAYERED");
      const protectedKey = createKey("PROTECTED_LAYERED");
      setEnv(protectedKey, "from-process");
      await writeEnvFile(
        ".env",
        `${layeredKey}=from-env\n${protectedKey}=from-env`,
      );
      await writeEnvFile(
        ".env.local",
        `${layeredKey}=from-local\n${protectedKey}=from-local`,
      );

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(layeredKey), "from-local");
      assertEquals(getEnv(protectedKey), "from-process");
      cleanupKeys(layeredKey, protectedKey);
    });

    it("should override existing env vars when override is true", async () => {
      const key = createKey("OVERRIDE");
      setEnv(key, "existing");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "new");

      cleanupKeys(key);
    });

    it("should handle multiline values in double quotes", async () => {
      const key = createKey("MULTI");
      await writeEnvFile(".env", `${key}="line1\nline2"`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "line1\nline2");

      cleanupKeys(key);
    });

    it("does not treat an escaped quote as the end of a multiline value", async () => {
      const key = createKey("ESCAPED_MULTI");
      await writeEnvFile(".env", `${key}="line1 \\"quoted\\"\nline2"`);

      await loadEnv({ cwd: tempDir, override: true });

      assertEquals(getEnv(key), 'line1 "quoted"\nline2');
      cleanupKeys(key);
    });

    it("rejects trailing garbage after a quoted value", async () => {
      const key = createKey("TRAILING_QUOTE_GARBAGE");
      await writeEnvFile(".env", `${key}="safe" unexpected`);

      const error = await assertRejects(
        () => loadEnv({ cwd: tempDir, override: true }),
        Error,
        "Failed to load an environment file",
      );

      assertEquals((error as { slug?: unknown }).slug, "config-parse-error");
      assertEquals(getEnv(key), undefined);
      cleanupKeys(key);
    });

    it("should load .env.local with higher priority", async () => {
      const key = createKey("LOCAL");
      await writeEnvFile(".env", `${key}=from_env`);
      await writeEnvFile(".env.local", `${key}=from_local`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "from_local");

      cleanupKeys(key);
    });

    it("should handle lines without equals sign", async () => {
      const key = createKey("NOEQ");
      await writeEnvFile(".env", `noequalssign\n${key}=valid`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "valid");

      cleanupKeys(key);
    });

    it("should not throw when no env files exist", async () => {
      await loadEnv({ cwd: tempDir });
    });

    it("should handle empty values", async () => {
      const key = createKey("EMPTY");
      await writeEnvFile(".env", `${key}=`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "");

      cleanupKeys(key);
    });

    it("should handle values with equals signs", async () => {
      const key = createKey("EQ");
      await writeEnvFile(".env", `${key}=a=b=c`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "a=b=c");

      cleanupKeys(key);
    });

    it("should trim key names", async () => {
      const key = createKey("TRIM");
      await writeEnvFile(".env", `  ${key}  =value`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "value");

      cleanupKeys(key);
    });

    it("should refresh logger format after loading NODE_ENV from .env", async () => {
      const previousNodeEnv = getEnv("NODE_ENV");
      const previousLogFormat = getEnv("LOG_FORMAT");
      const { getOutput, reset, restore } = captureConsoleLog();

      try {
        deleteEnv("NODE_ENV");
        deleteEnv("LOG_FORMAT");
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
        if (previousNodeEnv === undefined) deleteEnv("NODE_ENV");
        else setEnv("NODE_ENV", previousNodeEnv);
        if (previousLogFormat === undefined) deleteEnv("LOG_FORMAT");
        else setEnv("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
    });

    it("does not include variable names, values, or local paths in debug output", async () => {
      const key = createKey("PRIVATE_NAME");
      const value = "private-env-value-canary";
      const previousLogLevel = getEnv("LOG_LEVEL");
      const originalDebug = console.debug;
      const output: string[] = [];

      try {
        setEnv("LOG_LEVEL", "DEBUG");
        __resetLoggerConfigForTests();
        console.debug = (...args: unknown[]) => output.push(args.map(String).join(" "));
        await writeEnvFile(".env", `${key}=${value}`);

        await loadEnv({ cwd: tempDir, override: true, debug: true });

        const emitted = output.join("\n");
        assertEquals(emitted.includes(key), false);
        assertEquals(emitted.includes(value), false);
        assertEquals(emitted.includes(tempDir), false);
      } finally {
        console.debug = originalDebug;
        if (previousLogLevel === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", previousLogLevel);
        __resetLoggerConfigForTests();
        cleanupKeys(key);
      }
    });

    it("rejects unsafe environment names before constructing an env file path", async () => {
      const previousNodeEnv = getEnv("NODE_ENV");

      try {
        setEnv("NODE_ENV", "../../private");

        const error = await assertRejects(
          () => loadEnv({ cwd: tempDir }),
          Error,
          "Environment name must use letters, numbers, underscores, or hyphens",
        );
        assertEquals((error as { slug?: unknown }).slug, "config-invalid");
      } finally {
        if (previousNodeEnv === undefined) deleteEnv("NODE_ENV");
        else setEnv("NODE_ENV", previousNodeEnv);
      }
    });

    it("does not partially apply variables when a later env file cannot be read", async () => {
      const key = createKey("ATOMIC");
      const environment = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
      const failingPath = `${tempDir}/.env.${environment}`;
      await writeEnvFile(".env", `${key}=partial-value`);
      await Deno.mkdir(failingPath);

      const error = await assertRejects(
        () => loadEnv({ cwd: tempDir, override: true }),
        Error,
        "Failed to load an environment file",
      );

      assertEquals((error as { slug?: unknown }).slug, "config-parse-error");
      assertEquals(getEnv(key), undefined);

      await Deno.remove(failingPath);
      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "partial-value");
      cleanupKeys(key);
    });
  });
});
