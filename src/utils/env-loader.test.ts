import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { makeTempDir, remove, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  __resetEnvLoaderForTests,
  __setEnvLoaderExistingEnvReaderForTests,
  __setEnvLoaderOsTypeForTests,
  getEnvSource,
  isVeryfrontApiTokenFromKey,
  loadAdditionalEnv,
  loadEnv,
  markConfigFileSource,
  markEnvLoaded,
  markProcessEnvSource,
  supportsEnvFiles,
} from "./env-loader.ts";
import { __resetLoggerConfigForTests, type LogEntry, serverLogger } from "./logger/logger.ts";

describe("env-loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir({ prefix: "env-loader-test-" });
    __resetEnvLoaderForTests();
  });

  afterEach(async () => {
    __resetEnvLoaderForTests();
    await remove(tempDir, { recursive: true });
  });

  function createKey(suffix: string): string {
    return `TEST_ENV_LOADER_${Date.now()}_${suffix}`;
  }

  async function writeEnvFile(name: string, content: string): Promise<void> {
    await writeTextFile(`${tempDir}/${name}`, content);
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

  /**
   * Run `fn` with the reported OS type replaced.
   *
   * The test seam lets one case-sensitive host exercise both provenance rules.
   * Windows is the case-insensitive one, and it is the host where a lowercase
   * `.env` key sets the real uppercase variable.
   */
  function withOsType<T>(os: string, fn: () => T): T {
    __setEnvLoaderOsTypeForTests(os);
    try {
      return fn();
    } finally {
      __setEnvLoaderOsTypeForTests(undefined);
    }
  }

  async function withOsTypeAsync<T>(os: string, fn: () => Promise<T>): Promise<T> {
    __setEnvLoaderOsTypeForTests(os);
    try {
      return await fn();
    } finally {
      __setEnvLoaderOsTypeForTests(undefined);
    }
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

    it("should load a second directory's files without overriding the first", async () => {
      // `veryfront dev --project <dir>` loads the cwd first, then the project.
      const shared = createKey("SHARED");
      const projectOnly = createKey("PROJECT_ONLY");
      const projectDir = await makeTempDir({ prefix: "env-loader-project-" });
      try {
        await writeEnvFile(".env", `${shared}=cwd`);
        await writeTextFile(`${projectDir}/.env`, `${shared}=project\n${projectOnly}=project`);

        await loadEnv({ cwd: tempDir });
        markEnvLoaded();
        await loadAdditionalEnv({ cwd: projectDir });

        assertEquals(getEnv(shared), "cwd");
        assertEquals(getEnv(projectOnly), "project");
        assertEquals(getEnvSource(projectOnly)?.source, "env-file");
      } finally {
        cleanupKeys(shared, projectOnly);
        await remove(projectDir, { recursive: true });
      }
    });

    it("should keep a value the first directory set to empty", async () => {
      const shared = createKey("EMPTY_SHARED");
      const projectDir = await makeTempDir({ prefix: "env-loader-project-" });
      try {
        await writeEnvFile(".env", `${shared}=`);
        await writeTextFile(`${projectDir}/.env`, `${shared}=project`);

        await loadEnv({ cwd: tempDir });
        await loadAdditionalEnv({ cwd: projectDir });

        assertEquals(getEnv(shared), "");
      } finally {
        cleanupKeys(shared);
        await remove(projectDir, { recursive: true });
      }
    });

    it("should let a later file of one load outrank an earlier one", async () => {
      const key = createKey("LATER_FILE");
      const projectDir = await makeTempDir({ prefix: "env-loader-project-" });
      try {
        await writeEnvFile(".env", `${key}=base`);
        await writeEnvFile(".env.local", `${key}=local`);
        await loadEnv({ cwd: tempDir });
        assertEquals(getEnv(key), "local", "primary load");

        deleteEnv(key);
        await writeTextFile(`${projectDir}/.env`, `${key}=project-base`);
        await writeTextFile(`${projectDir}/.env.local`, `${key}=project-local`);
        await loadAdditionalEnv({ cwd: projectDir });
        assertEquals(getEnv(key), "project-local", "additional load");
      } finally {
        cleanupKeys(key);
        await remove(projectDir, { recursive: true });
      }
    });

    it("should let a later file outrank a differently-cased key on Windows", async () => {
      const key = createKey("LATER_FILE_CASE");
      const lowerKey = key.toLowerCase();
      await writeEnvFile(".env", `${key}=base`);
      await writeEnvFile(".env.local", `${lowerKey}=local`);
      // Windows reads the environment case-insensitively.
      __setEnvLoaderExistingEnvReaderForTests((name) => getEnv(name) ?? getEnv(name.toUpperCase()));
      try {
        await withOsTypeAsync("windows", () => loadAdditionalEnv({ cwd: tempDir }));

        assertEquals(getEnv(lowerKey), "local");
      } finally {
        cleanupKeys(key, lowerKey);
      }
    });

    describe("when a later file replaces a differently-cased key on Windows", () => {
      let previousNodeEnv: string | undefined;

      beforeEach(() => {
        previousNodeEnv = getEnv("NODE_ENV");
        setEnv("NODE_ENV", "production");
        // Windows reads the environment case-insensitively.
        __setEnvLoaderExistingEnvReaderForTests((name) =>
          getEnv(name) ?? getEnv(name.toUpperCase())
        );
      });

      afterEach(() => {
        if (previousNodeEnv === undefined) deleteEnv("NODE_ENV");
        else setEnv("NODE_ENV", previousNodeEnv);
      });

      it("should drop the earlier spelling's provenance", async () => {
        const key = createKey("ALIAS_SOURCE");
        const lowerKey = key.toLowerCase();
        const shellKey = createKey("ALIAS_SHELL");
        setEnv(shellKey, "shell-secret");
        await writeEnvFile(".env", `${key}=repository-literal`);
        await writeEnvFile(".env.local", `${lowerKey}=\${${shellKey}}`);
        try {
          await withOsTypeAsync("windows", () => loadEnv({ cwd: tempDir }));

          assertEquals(getEnvSource(lowerKey), {
            source: "env-file",
            file: `${tempDir}/.env.local`,
            expandedFromProcessEnv: true,
          });
          assertNotEquals(
            withOsType("windows", () => getEnvSource(key)),
            { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
            "the replaced .env record must not describe the live value",
          );
        } finally {
          cleanupKeys(key, lowerKey, shellKey);
        }
      });

      it("should clear the earlier spelling's expansion taint", async () => {
        const key = createKey("ALIAS_TAINT");
        const lowerKey = key.toLowerCase();
        const shellKey = createKey("ALIAS_TAINT_SHELL");
        const dependent = createKey("ALIAS_TAINT_DEPENDENT");
        setEnv(shellKey, "shell-secret");
        await writeEnvFile(".env", `${key}=\${${shellKey}}`);
        await writeEnvFile(".env.production", `${lowerKey}=repository-literal`);
        await writeEnvFile(".env.local", `${dependent}=\${${key}}`);
        try {
          await withOsTypeAsync("windows", () => loadEnv({ cwd: tempDir }));

          assertEquals(getEnv(dependent), "repository-literal");
          assertEquals(getEnvSource(dependent), {
            source: "env-file",
            file: `${tempDir}/.env.local`,
            expandedFromProcessEnv: false,
          });
        } finally {
          cleanupKeys(key, lowerKey, shellKey, dependent);
        }
      });

      it("should expand later references to the winning value", async () => {
        const key = createKey("ALIAS_VALUE");
        const lowerKey = key.toLowerCase();
        const dependent = createKey("ALIAS_VALUE_DEPENDENT");
        await writeEnvFile(".env", `${key}=first\n${lowerKey}=second`);
        await writeEnvFile(".env.production", `${key}=winner`);
        await writeEnvFile(".env.local", `${dependent}=\${${key}}`);
        try {
          await withOsTypeAsync("windows", () => loadEnv({ cwd: tempDir }));

          assertEquals(getEnv(dependent), "winner");
        } finally {
          cleanupKeys(key, lowerKey, dependent);
        }
      });
    });

    it("should read an additional directory only once", async () => {
      const key = createKey("ADDITIONAL_ONCE");
      await writeEnvFile(".env", `${key}=first`);
      try {
        await loadAdditionalEnv({ cwd: tempDir });
        deleteEnv(key);
        await loadAdditionalEnv({ cwd: tempDir });

        assertEquals(getEnv(key), undefined);
      } finally {
        cleanupKeys(key);
      }
    });

    it("should skip loading once markEnvLoaded was called", async () => {
      const key = createKey("MARKED");
      await writeEnvFile(".env", `${key}=from-file`);
      try {
        markEnvLoaded();
        await loadEnv({ cwd: tempDir, override: true });

        assertEquals(getEnv(key), undefined);
      } finally {
        cleanupKeys(key);
      }
    });

    it("should make a concurrent caller await the in-flight load", async () => {
      const key = createKey("CONCURRENT");
      await writeEnvFile(".env", `${key}=loaded`);
      try {
        const first = loadEnv({ cwd: tempDir });
        await loadEnv({ cwd: tempDir });

        assertEquals(getEnv(key), "loaded");
        await first;
      } finally {
        cleanupKeys(key);
      }
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
        await remove(`${tempDir}/.env.local`);

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

  describe("VERYFRONT_API_KEY as the user-facing credential name", () => {
    const TOKEN = "VERYFRONT_API_TOKEN";
    const KEY = "VERYFRONT_API_KEY";
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = { [TOKEN]: getEnv(TOKEN), [KEY]: getEnv(KEY) };
      deleteEnv(TOKEN);
      deleteEnv(KEY);
    });

    afterEach(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) deleteEnv(name);
        else setEnv(name, value);
      }
    });

    it("uses a .env VERYFRONT_API_KEY as the token, with the file's provenance", async () => {
      await writeEnvFile(".env", `${KEY}=<KEY_FROM_FILE>`);

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), "<KEY_FROM_FILE>", "the key becomes the CLI credential");
      assertEquals(
        getEnvSource(TOKEN),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
        "trust rules see the same origin as the key",
      );
      assertEquals(isVeryfrontApiTokenFromKey(), true, "messages can name the key variable");
    });

    it("uses an exported VERYFRONT_API_KEY as the token with process provenance", async () => {
      setEnv(KEY, "<KEY_FROM_SHELL>");

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), "<KEY_FROM_SHELL>");
      assertEquals(getEnvSource(TOKEN), { source: "process" }, "a shell key is a shell credential");
    });

    it("keeps an exported VERYFRONT_API_TOKEN when both names are set", async () => {
      setEnv(TOKEN, "<TOKEN_FROM_SHELL>");
      setEnv(KEY, "<KEY_FROM_SHELL>");

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), "<TOKEN_FROM_SHELL>", "VERYFRONT_API_TOKEN wins");
      assertEquals(isVeryfrontApiTokenFromKey(), false);
    });

    it("keeps a .env VERYFRONT_API_TOKEN over a shell VERYFRONT_API_KEY", async () => {
      setEnv(KEY, "<KEY_FROM_SHELL>");
      await writeEnvFile(".env", `${TOKEN}=<TOKEN_FROM_FILE>`);

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), "<TOKEN_FROM_FILE>", "an explicit token is never replaced");
    });

    it("treats a blank VERYFRONT_API_TOKEN as unset", async () => {
      setEnv(TOKEN, "   ");
      setEnv(KEY, "<KEY_FROM_SHELL>");

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), "<KEY_FROM_SHELL>", "a blank export does not block the key");
    });

    it("ignores a blank VERYFRONT_API_KEY", async () => {
      setEnv(KEY, "  ");

      await loadEnv({ cwd: tempDir });

      assertEquals(getEnv(TOKEN), undefined, "a blank key is not a credential");
    });

    it("carries the expansion taint of a key that names a shell variable", async () => {
      const outer = createKey("OUTER_SECRET");
      setEnv(outer, "<SHELL_SECRET>");
      await writeEnvFile(".env", `${KEY}=$${outer}`);

      await loadEnv({ cwd: tempDir });

      assertEquals(
        getEnvSource(TOKEN),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: true },
        "a repository that only names a shell secret does not own it",
      );
      cleanupKeys(outer);
    });

    it("applies to a project directory loaded after startup", async () => {
      const projectDir = await makeTempDir({ prefix: "env-loader-project-" });
      try {
        await writeTextFile(`${projectDir}/.env`, `${KEY}=<KEY_FROM_PROJECT>`);
        await loadEnv({ cwd: tempDir });
        assertEquals(getEnv(TOKEN), undefined, "the startup directory has no key");

        await loadAdditionalEnv({ cwd: projectDir });

        assertEquals(getEnv(TOKEN), "<KEY_FROM_PROJECT>");
        assertEquals(getEnvSource(TOKEN).source, "env-file");
      } finally {
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not bring back a token the CLI removed after loading", async () => {
      setEnv(KEY, "<KEY_FROM_SHELL>");
      await loadEnv({ cwd: tempDir });

      // Trust rules delete the token when it must not reach a repository-steered API URL.
      deleteEnv(TOKEN);
      markProcessEnvSource(TOKEN);

      assertEquals(getEnv(TOKEN), undefined);
      assertEquals(getHostEnv(TOKEN), undefined, "host reads do not fall back to the key");
      assertEquals(isVeryfrontApiTokenFromKey(), false);
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

    it("keeps env-file attribution when Map.prototype.get is replaced", async () => {
      const key = createKey("SOURCE_TAMPERED_MAP");
      await writeEnvFile(".env", `${key}=from-file`);
      await loadEnv({ cwd: tempDir, override: true });

      const originalGet = Map.prototype.get;
      Map.prototype.get = function () {
        return undefined;
      };
      try {
        assertEquals(getEnvSource(key), {
          source: "env-file",
          file: `${tempDir}/.env`,
          expandedFromProcessEnv: false,
        });
      } finally {
        Map.prototype.get = originalGet;
        cleanupKeys(key);
      }
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

    it("case-folds prior file references on Windows", async () => {
      const baseKey = createKey("SOURCE_WINDOWS_PRIOR");
      const lowerBaseKey = baseKey.toLowerCase();
      const key = createKey("SOURCE_WINDOWS_LEAF");
      setEnv(baseKey, "repository-value");
      await writeEnvFile(".env", `${lowerBaseKey}=repository-value`);
      await writeEnvFile(".env.local", `${key}=\${${baseKey}}`);

      await withOsTypeAsync("windows", () => loadEnv({ cwd: tempDir, override: true }));

      assertEquals(getEnv(key), "repository-value");
      assertEquals(
        getEnvSource(key),
        { source: "env-file", file: `${tempDir}/.env.local`, expandedFromProcessEnv: false },
      );

      cleanupKeys(key, baseKey, lowerBaseKey);
    });

    it("should attribute a differently-cased env-file entry to the file", async () => {
      const key = createKey("SOURCE_CASE");
      const lowerKey = key.toLowerCase();
      await writeEnvFile(".env", `${lowerKey}=https://project-controlled.example/api`);

      await loadEnv({ cwd: tempDir, override: true });
      // Windows aliases the differently-cased names, so there the lowercase
      // line above sets the real uppercase variable. The alias is stubbed
      // because this host is case-sensitive, and both rules are asserted so a
      // case-sensitive runner still proves the case-insensitive one.
      setEnv(key, "https://project-controlled.example/api");

      assertEquals(
        withOsType("windows", () => getEnvSource(key)),
        { source: "env-file", file: `${tempDir}/.env`, expandedFromProcessEnv: false },
        "a case-insensitive host must not launder repository content into a process value",
      );
      assertEquals(
        withOsType("linux", () => getEnvSource(key)),
        { source: "process" },
        "a case-sensitive host keeps the explicitly set uppercase value independent",
      );

      cleanupKeys(key, lowerKey);
    });

    it("clears a differently-cased Windows env-file source after a process write", async () => {
      const key = createKey("SOURCE_CASE_PROCESS_REPLACEMENT");
      const lowerKey = key.toLowerCase();
      await writeEnvFile(".env", `${lowerKey}=shared-value`);
      await loadEnv({ cwd: tempDir, override: true });
      setEnv(key, "shared-value");

      withOsType("windows", () => {
        markProcessEnvSource(key);
        assertEquals(getEnvSource(key), { source: "process" });
      });

      cleanupKeys(key, lowerKey);
    });

    it("replaces a differently-cased Windows env-file source with config provenance", async () => {
      const key = createKey("SOURCE_CASE_CONFIG_REPLACEMENT");
      const lowerKey = key.toLowerCase();
      const configFile = `${tempDir}/veryfront.json`;
      await writeEnvFile(".env", `${lowerKey}=shared-value`);
      await loadEnv({ cwd: tempDir, override: true });
      setEnv(key, "shared-value");

      withOsType("windows", () => {
        markConfigFileSource(key, configFile);
        assertEquals(getEnvSource(key), { source: "config-file", file: configFile });
        assertEquals(
          getEnvSource(lowerKey),
          { source: "config-file", file: configFile },
          "the stale lowercase env-file record must not mask the replacement",
        );
      });

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
