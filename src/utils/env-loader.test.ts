import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { __resetEnvLoaderForTests, getEnvSource, loadEnv, supportsEnvFiles } from "./env-loader.ts";
import { __resetLoggerConfigForTests, type LogEntry, serverLogger } from "./logger/logger.ts";

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

    it("should expand a bare $VAR reference", async () => {
      const key1 = createKey("BAREBASE");
      const key2 = createKey("BAREUSED");
      await writeEnvFile(".env", `${key1}=hello\n${key2}=$${key1}/db`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key2), "hello/db", "a bare $VAR reference must expand");

      cleanupKeys(key1, key2);
    });

    it("should expand a reference that resolves from the process env", async () => {
      const outer = createKey("FROMPROCESS");
      const key = createKey("USESPROCESS");
      setEnv(outer, "from-process");
      await writeEnvFile(".env", `${key}=\${${outer}}/x`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(
        getEnv(key),
        "from-process/x",
        "a reference missing from the file must fall back to the process env",
      );

      cleanupKeys(outer, key);
    });

    it("should collapse an unresolvable reference to an empty string", async () => {
      const key = createKey("UNRESOLVED");
      const missing = createKey("NEVER_DEFINED");
      await writeEnvFile(".env", `${key}=[\${${missing}}]`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(
        getEnv(key),
        "[]",
        "an unresolvable reference must collapse to an empty string, not stay literal",
      );

      cleanupKeys(key);
    });

    it("should not override existing env vars by default", async () => {
      const key = createKey("NOOVERRIDE");
      setEnv(key, "existing");
      await writeEnvFile(".env", `${key}=new`);

      await loadEnv({ cwd: tempDir });
      assertEquals(getEnv(key), "existing");

      cleanupKeys(key);
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

    it("should rank .env.local above .env.{NODE_ENV} above .env", async () => {
      const previousNodeEnv = getEnv("NODE_ENV");
      const key = createKey("ENVSPECIFIC");

      try {
        setEnv("NODE_ENV", "production");
        await writeEnvFile(".env", `${key}=base`);
        await writeEnvFile(".env.production", `${key}=env-specific`);
        await writeEnvFile(".env.local", `${key}=local`);

        await loadEnv({ cwd: tempDir, override: true });
        assertEquals(getEnv(key), "local", ".env.local outranks .env.{NODE_ENV}");

        __resetEnvLoaderForTests();
        await Deno.remove(`${tempDir}/.env.local`);

        await loadEnv({ cwd: tempDir, override: true });
        assertEquals(
          getEnv(key),
          "env-specific",
          ".env.{NODE_ENV} is loaded and outranks .env",
        );
      } finally {
        cleanupKeys(key);
        if (previousNodeEnv === undefined) deleteEnv("NODE_ENV");
        else setEnv("NODE_ENV", previousNodeEnv);
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

    it("should strip credentials from the logged VERYFRONT_API_BASE_URL", async () => {
      const previousValue = getEnv("VERYFRONT_API_BASE_URL");
      const previousLogFormat = getEnv("LOG_FORMAT");
      const { getOutput, restore } = captureConsoleLog();

      try {
        setEnv("LOG_FORMAT", "json");
        __resetLoggerConfigForTests();
        await writeEnvFile(
          ".env",
          "VERYFRONT_API_BASE_URL=https://user:hybrid-basic-secret@api.example.com/api",
        );

        await loadEnv({ cwd: tempDir, override: true });

        const output = getOutput();
        const entry = JSON.parse(output) as LogEntry;
        assertEquals(
          entry.message,
          "VERYFRONT_API_BASE_URL loaded: https://user:[REDACTED]@api.example.com/api",
        );
        assertEquals(output.includes("hybrid-basic-secret"), false);
      } finally {
        restore();
        if (previousValue === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
        else setEnv("VERYFRONT_API_BASE_URL", previousValue);
        if (previousLogFormat === undefined) deleteEnv("LOG_FORMAT");
        else setEnv("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
    });

    it("should not log process values expanded into an API URL", async () => {
      const secretKey = createKey("LOGGED_API_URL_SECRET");
      const previousValue = getEnv("VERYFRONT_API_BASE_URL");
      const previousLogFormat = getEnv("LOG_FORMAT");
      const { getOutput, restore } = captureConsoleLog();

      try {
        setEnv(secretKey, "highly-sensitive-host-label");
        setEnv("LOG_FORMAT", "json");
        __resetLoggerConfigForTests();
        await writeEnvFile(
          ".env",
          `VERYFRONT_API_BASE_URL=https://$${secretKey}.example.test/api`,
        );

        await loadEnv({ cwd: tempDir, override: true });

        const output = getOutput();
        assertEquals(output.includes("highly-sensitive-host-label"), false);
        assertEquals(
          JSON.parse(output).message,
          "VERYFRONT_API_BASE_URL loaded from an expanded project env value",
        );
      } finally {
        restore();
        cleanupKeys(secretKey);
        if (previousValue === undefined) deleteEnv("VERYFRONT_API_BASE_URL");
        else setEnv("VERYFRONT_API_BASE_URL", previousValue);
        if (previousLogFormat === undefined) deleteEnv("LOG_FORMAT");
        else setEnv("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
    });
  });

  describe("getEnvSource", () => {
    it("should attribute a value loaded from .env to that file", async () => {
      const key = createKey("SOURCE_FILE");
      await writeEnvFile(".env", `${key}=x`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
        "a value loaded from .env must be attributed to the file",
      );

      cleanupKeys(key);
    });

    it("should keep the env-file attribution when the process also carries the key", async () => {
      const key = createKey("SOURCE_BOTH");
      setEnv(key, "from-process");
      await writeEnvFile(".env", `${key}=from-file`);

      await loadEnv({ cwd: tempDir, override: true });
      // requiresProjectEnvInternalAuthorization() treats "process" as the
      // trusted origin, so a project .env must never be reported as one.
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
        "a project .env value must outrank the process env in provenance",
      );

      cleanupKeys(key);
    });

    it("should flag a value expanded from the process environment", async () => {
      const secretKey = createKey("SOURCE_SHELL_SECRET");
      const key = createKey("SOURCE_EXPANDED");
      setEnv(secretKey, "shell-secret-value");
      await writeEnvFile(".env", `${key}=$${secretKey}`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "shell-secret-value", "the shell value must be substituted in");
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: true },
        "a value the file copied out of the shell is not purely repository content",
      );

      cleanupKeys(key, secretKey);
    });

    it("should propagate expansion provenance through an in-file reference", async () => {
      const secretKey = createKey("SOURCE_CHAIN_SECRET");
      const middleKey = createKey("SOURCE_CHAIN_MIDDLE");
      const key = createKey("SOURCE_CHAIN_LEAF");
      setEnv(secretKey, "chained-shell-secret");
      await writeEnvFile(".env", `${middleKey}=$${secretKey}\n${key}=\${${middleKey}}`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "chained-shell-secret", "the chained value must resolve");
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: true },
        "referencing a tainted entry must taint the referring value too",
      );

      cleanupKeys(key, middleKey, secretKey);
    });

    it("should not flag a value expanded only from entries in the same file", async () => {
      const baseKey = createKey("SOURCE_LOCAL_BASE");
      const key = createKey("SOURCE_LOCAL_LEAF");
      await writeEnvFile(".env", `${baseKey}=local\n${key}=\${${baseKey}}-suffix`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "local-suffix", "the in-file reference must resolve");
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
        "a value assembled entirely from the file stays repository content",
      );

      cleanupKeys(key, baseKey);
    });

    it("should preserve file provenance through references across env files", async () => {
      const baseKey = createKey("SOURCE_EARLIER_FILE_BASE");
      const key = createKey("SOURCE_LATER_FILE_LEAF");
      await writeEnvFile(".env", `${baseKey}=repository-value`);
      await writeEnvFile(".env.local", `${key}=\${${baseKey}}`);

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(getEnv(key), "repository-value");
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env.local`, expandedFromProcessEnv: false },
        "a later env file that references repository content must not be attributed to the shell",
      );

      cleanupKeys(key, baseKey);
    });

    it("should attribute a differently-cased env-file entry to the file", async () => {
      const key = createKey("SOURCE_CASE");
      const lowerKey = key.toLowerCase();
      await writeEnvFile(".env", `${lowerKey}=https://project-controlled.example/api`);

      await loadEnv({ cwd: tempDir, override: true });
      // Windows aliases the differently-cased names. Case-sensitive hosts keep
      // the explicitly set uppercase process value independent from the file.
      setEnv(key, "https://project-controlled.example/api");

      assertEquals(
        getEnvSource(key),
        Deno.build.os === "windows"
          ? { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false }
          : { source: "process" },
        "case-folded provenance must follow the host environment's key semantics",
      );

      cleanupKeys(key, lowerKey);
    });

    it("should keep a distinct differently-cased process value as process", async () => {
      const key = createKey("SOURCE_CASE_DISTINCT");
      const lowerKey = key.toLowerCase();
      await writeEnvFile(".env", `${lowerKey}=from-file`);

      await loadEnv({ cwd: tempDir, override: true });
      setEnv(key, "from-shell");

      assertEquals(
        getEnvSource(key),
        { source: "process" },
        "a case-sensitive host keeps the two names apart, so the shell value stays the shell's",
      );

      cleanupKeys(key, lowerKey);
    });

    it("should report a key present only in the process env as process", async () => {
      const key = createKey("SOURCE_PROCESS");
      setEnv(key, "only-process");

      await loadEnv({ cwd: tempDir, override: true });
      assertEquals(
        getEnvSource(key),
        { source: "process" },
        "a key absent from every .env file comes from the process",
      );

      cleanupKeys(key);
    });

    it("should report an unknown key as unset", () => {
      assertEquals(
        getEnvSource(createKey("SOURCE_UNSET")),
        { source: "unset" },
        "a key present nowhere must be reported as unset",
      );
    });
  });
});
