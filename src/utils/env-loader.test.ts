import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  getEnv,
  getEnvOverlayStorage,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import {
  __resetEnvLoaderForTests,
  getEnvSource,
  hasEnvLoaded,
  loadEnv,
  supportsEnvFiles,
} from "./env-loader.ts";
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

    it("should not override an existing empty env var by default", async () => {
      const key = createKey("EMPTY_NOOVERRIDE");
      setEnv(key, "");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir });
      assertEquals(getEnv(key), "");

      cleanupKeys(key);
    });

    it("should expand from the authoritative host value when a file assignment is skipped", async () => {
      const hostKey = createKey("EXPANSION_HOST");
      const derivedKey = createKey("EXPANSION_DERIVED");
      setEnv(hostKey, "from_host");
      await writeEnvFile(
        ".env",
        `${hostKey}=from_file\n${derivedKey}=\${${hostKey}}_derived`,
      );

      try {
        await loadEnv({ cwd: tempDir });
        assertEquals(getEnv(hostKey), "from_host");
        assertEquals(getEnv(derivedKey), "from_host_derived");
      } finally {
        cleanupKeys(hostKey, derivedKey);
      }
    });

    it("should not print environment values in debug logs", async () => {
      const key = createKey("SECRET_LOG");
      const secret = "highly-sensitive-value";
      const previousLogLevel = getEnv("LOG_LEVEL");
      const previousLogFormat = getEnv("LOG_FORMAT");
      const originalDebug = console.debug;
      const output: string[] = [];

      try {
        setEnv("LOG_LEVEL", "DEBUG");
        setEnv("LOG_FORMAT", "json");
        __resetLoggerConfigForTests();
        console.debug = (message: string) => output.push(message);
        await writeEnvFile(".env", `${key}=${secret}`);

        await loadEnv({ cwd: tempDir, override: true, debug: true });

        assertEquals(output.join("\n").includes("highly-sensitive"), false);
        assertEquals(output.join("\n").includes(key), true);
      } finally {
        console.debug = originalDebug;
        cleanupKeys(key);
        if (previousLogLevel === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", previousLogLevel);
        if (previousLogFormat === undefined) deleteEnv("LOG_FORMAT");
        else setEnv("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
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

    it("should load .env.local with higher priority", async () => {
      const key = createKey("LOCAL");
      await writeEnvFile(".env", `${key}=from_env`);
      await writeEnvFile(".env.local", `${key}=from_local`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "from_local");

      cleanupKeys(key);
    });

    it("should apply file precedence by default without overriding the host environment", async () => {
      const loadedKey = createKey("DEFAULT_PRECEDENCE");
      const hostKey = createKey("HOST_PRECEDENCE");
      const mode = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
      setEnv(hostKey, "from_host");

      try {
        await writeEnvFile(
          ".env",
          `${loadedKey}=from_env\n${hostKey}=from_env`,
        );
        await writeEnvFile(
          `.env.${mode}`,
          `${loadedKey}=from_mode\n${hostKey}=from_mode`,
        );
        await writeEnvFile(
          ".env.local",
          `${loadedKey}=from_local\n${hostKey}=from_local`,
        );

        await loadEnv({ cwd: tempDir });

        assertEquals(getEnv(loadedKey), "from_local");
        assertEquals(getEnv(hostKey), "from_host");
        assertEquals(getEnvSource(loadedKey), {
          source: "env-file",
          file: `${tempDir}/.env.local`,
        });
        assertEquals(getEnvSource(hostKey), { source: "process" });
      } finally {
        cleanupKeys(loadedKey, hostKey);
      }
    });

    it("should join concurrent first loads to the first caller's transaction", async () => {
      const secondDir = await Deno.makeTempDir({ prefix: "env-loader-second-" });
      const firstKey = createKey("CONCURRENT_FIRST");
      const secondKey = createKey("CONCURRENT_SECOND");

      try {
        await writeEnvFile(".env", `${firstKey}=from_first`);
        await Deno.writeTextFile(`${secondDir}/.env`, `${secondKey}=from_second`);

        const firstLoad = loadEnv({ cwd: tempDir, override: true });
        const joinedLoad = loadEnv({ cwd: secondDir, override: true });
        await Promise.all([firstLoad, joinedLoad]);

        assertEquals(getEnv(firstKey), "from_first");
        assertEquals(getEnv(secondKey), undefined);
        assertEquals(getEnvSource(firstKey), {
          source: "env-file",
          file: `${tempDir}/.env`,
        });
        assertEquals(getEnvSource(secondKey), { source: "unset" });
      } finally {
        cleanupKeys(firstKey, secondKey);
        await Deno.remove(secondDir, { recursive: true });
      }
    });

    it("should reject joined callers and allow retry after the first transaction fails", async () => {
      const secondDir = await Deno.makeTempDir({ prefix: "env-loader-retry-" });
      const invalidKey = createKey("CONCURRENT_INVALID");
      const retryKey = createKey("CONCURRENT_RETRY");

      try {
        await writeEnvFile(".env", `${invalidKey}="unterminated`);
        await Deno.writeTextFile(`${secondDir}/.env`, `${retryKey}=recovered`);

        const results = await Promise.allSettled([
          loadEnv({ cwd: tempDir, override: true }),
          loadEnv({ cwd: secondDir, override: true }),
        ]);

        assertEquals(results.map((result) => result.status), [
          "rejected",
          "rejected",
        ]);
        assertEquals(getEnv(invalidKey), undefined);
        assertEquals(getEnv(retryKey), undefined);
        assertEquals(hasEnvLoaded(), false);

        await loadEnv({ cwd: secondDir, override: true });
        assertEquals(getEnv(retryKey), "recovered");
        assertEquals(hasEnvLoaded(), true);
      } finally {
        cleanupKeys(invalidKey, retryKey);
        await Deno.remove(secondDir, { recursive: true });
      }
    });

    it("should reject a test reset while an environment load is in progress", async () => {
      const key = createKey("RESET_IN_FLIGHT");
      await writeEnvFile(".env", `${key}=loaded`);

      const loadPromise = loadEnv({ cwd: tempDir, override: true });
      let resetError: unknown;
      try {
        __resetEnvLoaderForTests();
      } catch (error) {
        resetError = error;
      }
      await loadPromise;

      assertEquals(resetError instanceof Error, true);
      assertEquals(getEnv(key), "loaded");
      cleanupKeys(key);
    });

    it("should not expand inherited record property names", async () => {
      const constructorKey = createKey("INHERITED_CONSTRUCTOR");
      const prototypeKey = createKey("INHERITED_PROTO");

      try {
        await writeEnvFile(
          ".env",
          `${constructorKey}=\${constructor}\n${prototypeKey}=\${__proto__}`,
        );

        await loadEnv({ cwd: tempDir, override: true });

        assertEquals(getEnv(constructorKey), "");
        assertEquals(getEnv(prototypeKey), "");
      } finally {
        cleanupKeys(constructorKey, prototypeKey);
      }
    });

    it("should reject invalid keys before applying any file values", async () => {
      const validKey = createKey("BEFORE_INVALID_KEY");
      const invalidKey = `${createKey("INVALID")}-NAME`;

      try {
        await writeEnvFile(
          ".env",
          `${validKey}=must_not_apply\n${invalidKey}=invalid`,
        );

        await assertRejects(() => loadEnv({ cwd: tempDir, override: true }));

        assertEquals(getEnv(validKey), undefined);
        assertEquals(getEnv(invalidKey), undefined);
        assertEquals(hasEnvLoaded(), false);
      } finally {
        cleanupKeys(validKey, invalidKey);
      }
    });

    it("should reject empty keys before applying any file values", async () => {
      const validKey = createKey("BEFORE_EMPTY_KEY");

      try {
        await writeEnvFile(".env", `${validKey}=must_not_apply\n=value`);

        await assertRejects(() => loadEnv({ cwd: tempDir, override: true }));

        assertEquals(getEnv(validKey), undefined);
        assertEquals(hasEnvLoaded(), false);
      } finally {
        cleanupKeys(validKey);
      }
    });

    it("should roll back parsed files and remain retryable after an unterminated quote", async () => {
      const baseKey = createKey("PARSE_ROLLBACK_BASE");
      const localKey = createKey("PARSE_ROLLBACK_LOCAL");

      try {
        await writeEnvFile(".env", `${baseKey}=base`);
        await writeEnvFile(".env.local", `${localKey}="unterminated`);

        await assertRejects(() => loadEnv({ cwd: tempDir, override: true }));

        assertEquals(getEnv(baseKey), undefined);
        assertEquals(getEnv(localKey), undefined);
        assertEquals(getEnvSource(baseKey), { source: "unset" });
        assertEquals(hasEnvLoaded(), false);

        await writeEnvFile(".env.local", `${localKey}=recovered`);
        await loadEnv({ cwd: tempDir, override: true });

        assertEquals(getEnv(baseKey), "base");
        assertEquals(getEnv(localKey), "recovered");
        assertEquals(hasEnvLoaded(), true);
      } finally {
        cleanupKeys(baseKey, localKey);
      }
    });

    it("should roll back process mutations when applying a value fails", async () => {
      const appliedKey = createKey("APPLY_ROLLBACK");
      const failingKey = createKey("APPLY_FAILURE");
      const storage = getEnvOverlayStorage();
      if (!storage?.enterWith) {
        throw new Error("Environment overlay storage is unavailable");
      }

      const previousStore = storage.getStore();
      let shouldFail = true;
      const failingStore = new Map<string, string | null>();
      const setValue = failingStore.set.bind(failingStore);
      failingStore.set = (key: string, value: string | null): typeof failingStore => {
        if (key === failingKey && value !== null && shouldFail) {
          shouldFail = false;
          throw new Error("Injected environment write failure");
        }
        setValue(key, value);
        return failingStore;
      };

      storage.enterWith(failingStore);
      try {
        await writeEnvFile(
          ".env",
          `${appliedKey}=must_be_rolled_back\n${failingKey}=fails`,
        );

        await assertRejects(() => loadEnv({ cwd: tempDir, override: true }));

        assertEquals(getEnv(appliedKey), undefined);
        assertEquals(getEnv(failingKey), undefined);
        assertEquals(getEnvSource(appliedKey), { source: "unset" });
        assertEquals(hasEnvLoaded(), false);
      } finally {
        storage.enterWith(previousStore);
        cleanupKeys(appliedKey, failingKey);
      }
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
  });
});
