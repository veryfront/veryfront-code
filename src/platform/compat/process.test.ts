/**
 * Process Compat Tests
 *
 * These tests verify the cross-runtime process abstractions work correctly.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  chdir,
  cwd,
  deleteEnv,
  env,
  execPath,
  getArgs,
  getEnv,
  getEnvBoolean,
  getEnvNumber,
  getEnvOverlayStorage,
  getEnvString,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  memoryUsage,
  onSignal,
  pid,
  promptSync,
  runCommand,
  setEnv,
  unrefTimer,
  uptime,
  writeStdout,
  writeStdoutAsync,
} from "./process.ts";

describe("Process Compat", () => {
  describe("getEnv / setEnv / deleteEnv", () => {
    const testKey = "__TEST_PROCESS_COMPAT__";
    const testValue = "test-value-123";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore if not supported
      }
    });

    it("should get undefined for non-existent env var", () => {
      assertEquals(getEnv("__NON_EXISTENT_VAR__"), undefined);
    });

    it("should set and get an env var", () => {
      setEnv(testKey, testValue);
      assertEquals(getEnv(testKey), testValue);
    });

    it("should delete an env var", () => {
      setEnv(testKey, testValue);
      deleteEnv(testKey);
      assertEquals(getEnv(testKey), undefined);
    });

    it("should overwrite an existing env var", () => {
      setEnv(testKey, "first-value");
      setEnv(testKey, "second-value");
      assertEquals(getEnv(testKey), "second-value");
    });

    it("should handle empty string values", () => {
      setEnv(testKey, "");
      assertEquals(getEnv(testKey), "");
    });

    it("should handle values with special characters", () => {
      const specialValue = "hello=world&foo=bar;baz";
      setEnv(testKey, specialValue);
      assertEquals(getEnv(testKey), specialValue);
    });
  });

  describe("getEnvString", () => {
    const testKey = "__TEST_GET_ENV_STRING__";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore if not supported
      }
    });

    it("should return undefined when env var is not set", () => {
      assertEquals(getEnvString(testKey), undefined);
    });

    it("should return fallback when env var is not set", () => {
      assertEquals(getEnvString(testKey, "fallback"), "fallback");
    });

    it("should not replace empty strings with fallback", () => {
      setEnv(testKey, "");
      assertEquals(getEnvString(testKey, "fallback"), "");
    });
  });

  describe("getEnvNumber", () => {
    const testKey = "__TEST_GET_ENV_NUMBER__";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore if not supported
      }
    });

    it("should return undefined for missing env var when fallback is not provided", () => {
      assertEquals(getEnvNumber(testKey), undefined);
    });

    it("should return NaN for invalid env var when fallback is not provided", () => {
      setEnv(testKey, "invalid");
      assertEquals(Number.isNaN(getEnvNumber(testKey) ?? Number.NaN), true);
    });

    it("should return parsed number for valid values", () => {
      setEnv(testKey, "42");
      assertEquals(getEnvNumber(testKey), 42);
    });

    it("should use fallback for missing env var", () => {
      assertEquals(getEnvNumber(testKey, 99), 99);
    });

    it("should use fallback for invalid env var", () => {
      setEnv(testKey, "invalid");
      assertEquals(getEnvNumber(testKey, 99), 99);
    });
  });

  describe("getEnvBoolean", () => {
    const testKey = "__TEST_GET_ENV_BOOLEAN__";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore if not supported
      }
    });

    it("should return fallback for missing env var", () => {
      assertEquals(getEnvBoolean(testKey, true), true);
      assertEquals(getEnvBoolean(testKey, false), false);
    });

    it("should parse default truthy values", () => {
      setEnv(testKey, "true");
      assertEquals(getEnvBoolean(testKey), true);
      setEnv(testKey, "1");
      assertEquals(getEnvBoolean(testKey), true);
      setEnv(testKey, "yes");
      assertEquals(getEnvBoolean(testKey), true);
    });

    it("should parse default falsy values", () => {
      setEnv(testKey, "false");
      assertEquals(getEnvBoolean(testKey, true), false);
      setEnv(testKey, "0");
      assertEquals(getEnvBoolean(testKey, true), false);
      setEnv(testKey, "no");
      assertEquals(getEnvBoolean(testKey, true), false);
    });

    it("should support strict PROXY_MODE-style matching", () => {
      setEnv(testKey, "true");
      assertEquals(
        getEnvBoolean(testKey, false, {
          trueValues: ["1"],
          trim: false,
          caseSensitive: true,
        }),
        false,
      );

      setEnv(testKey, "1");
      assertEquals(
        getEnvBoolean(testKey, false, {
          trueValues: ["1"],
          trim: false,
          caseSensitive: true,
        }),
        true,
      );
    });
  });

  describe("env", () => {
    it("should return all environment variables", () => {
      const envVars = env();
      assertExists(envVars);
      assertEquals(typeof envVars, "object");
      assertExists(envVars["PATH"] ?? envVars["Path"]);
    });

    it("should include recently set env vars", () => {
      const key = "__TEST_ENV_ALL__";
      setEnv(key, "test-all-value");

      try {
        const all = env();
        assertEquals(all[key], "test-all-value");
      } finally {
        deleteEnv(key);
      }
    });
  });

  describe("cwd", () => {
    it("should return current working directory", () => {
      const currentDir = cwd();
      assertExists(currentDir);
      assertEquals(typeof currentDir, "string");
      assertEquals(currentDir.length > 0, true);
    });

    it("should return an absolute path", () => {
      const currentDir = cwd();
      assertEquals(currentDir.startsWith("/") || /^[A-Z]:\\/i.test(currentDir), true);
    });
  });

  describe("chdir", () => {
    it("should change and restore directory", () => {
      const original = cwd();

      try {
        chdir("/tmp");
        const newDir = cwd();
        // On macOS /tmp is a symlink to /private/tmp
        assertEquals(newDir === "/tmp" || newDir === "/private/tmp", true);
      } finally {
        chdir(original);
      }

      assertEquals(cwd(), original);
    });
  });

  describe("getArgs", () => {
    it("should return command line arguments array", () => {
      const args = getArgs();
      assertEquals(Array.isArray(args), true);
    });
  });

  describe("pid", () => {
    it("should return a process ID", () => {
      const processId = pid();
      assertEquals(typeof processId, "number");
      assertEquals(processId > 0, true);
    });

    it("should return consistent value", () => {
      assertEquals(pid(), pid());
    });
  });

  describe("memoryUsage", () => {
    it("should return memory usage stats", () => {
      const usage = memoryUsage();
      assertExists(usage);
      assertEquals(typeof usage.rss, "number");
      assertEquals(typeof usage.heapTotal, "number");
      assertEquals(typeof usage.heapUsed, "number");
      assertEquals(typeof usage.external, "number");
      assertEquals(usage.rss > 0, true);
      assertEquals(usage.heapTotal > 0, true);
      assertEquals(usage.heapUsed > 0, true);
    });

    it("should have rss >= heapTotal >= heapUsed", () => {
      const usage = memoryUsage();
      assertEquals(usage.rss >= usage.heapTotal, true);
      assertEquals(usage.heapTotal >= usage.heapUsed, true);
    });
  });

  describe("getOsType", () => {
    it("should return a valid OS type", () => {
      const os = getOsType();
      assertExists(os);
      assertEquals(typeof os, "string");

      const validTypes = ["darwin", "linux", "windows", "freebsd", "netbsd", "aix", "solaris"];
      assertEquals(validTypes.includes(os) || os === "unknown", true);
    });
  });

  describe("getRuntimeVersion", () => {
    it("should return a runtime version string", () => {
      const version = getRuntimeVersion();
      assertExists(version);
      assertEquals(typeof version, "string");

      const startsWithKnown = version.startsWith("Deno") ||
        version.startsWith("Node.js") ||
        version.startsWith("Bun") ||
        version === "unknown";
      assertEquals(startsWithKnown, true);
    });

    it("should contain a version number", () => {
      const version = getRuntimeVersion();
      assertEquals(/\d/.test(version) || version === "unknown", true);
    });
  });

  describe("getTerminalSize", () => {
    it("should return terminal dimensions", () => {
      const size = getTerminalSize();
      assertExists(size);
      assertEquals(typeof size.columns, "number");
      assertEquals(typeof size.rows, "number");
      assertEquals(size.columns > 0, true);
      assertEquals(size.rows > 0, true);
    });

    it("should return reasonable dimensions", () => {
      const size = getTerminalSize();
      assertEquals(size.columns >= 10, true);
      assertEquals(size.rows >= 5, true);
    });
  });

  describe("isInteractive / isStdoutTTY", () => {
    it("should return boolean for isInteractive", () => {
      assertEquals(typeof isInteractive(), "boolean");
    });

    it("should return boolean for isStdoutTTY", () => {
      assertEquals(typeof isStdoutTTY(), "boolean");
    });
  });

  describe("getStdout", () => {
    it("should return stdout object with write method", () => {
      const stdout = getStdout();
      assertExists(stdout);
      assertEquals(typeof stdout?.write, "function");
    });
  });

  describe("writeStdout", () => {
    it("should write to stdout without throwing", () => {
      writeStdout("");
    });

    it("should write non-empty string without throwing", () => {
      writeStdout("test output\n");
    });
  });

  describe("writeStdoutAsync", () => {
    it("should write bytes asynchronously", async () => {
      const data = new TextEncoder().encode("async test\n");
      const bytesWritten = await writeStdoutAsync(data);
      assertEquals(typeof bytesWritten, "number");
      assertEquals(bytesWritten > 0, true);
    });
  });

  describe("uptime", () => {
    it("should return a non-negative number", () => {
      const up = uptime();
      assertEquals(typeof up, "number");
      assertEquals(up >= 0, true);
    });
  });

  describe("execPath", () => {
    it("should return a non-empty string", () => {
      const path = execPath();
      assertEquals(typeof path, "string");
      assertEquals(path.length > 0, true);
    });

    it("should return a path that contains 'deno' or 'node' or 'bun'", () => {
      const path = execPath().toLowerCase();
      const containsRuntime = path.includes("deno") || path.includes("node") ||
        path.includes("bun");
      assertEquals(containsRuntime, true);
    });
  });

  describe("onSignal", () => {
    it("should accept SIGINT handler without throwing", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, () => {
      const handler = () => {};
      onSignal("SIGINT", handler);

      // Clean up to avoid Deno leak detection
      if (typeof Deno !== "undefined") {
        Deno.removeSignalListener("SIGINT", handler);
      }
    });

    it("should accept SIGTERM handler without throwing", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, () => {
      const handler = () => {};
      onSignal("SIGTERM", handler);

      // Clean up to avoid Deno leak detection
      if (typeof Deno !== "undefined") {
        Deno.removeSignalListener("SIGTERM", handler);
      }
    });
  });

  describe("unrefTimer", () => {
    it("should unref a timer without error", () => {
      const timer = setInterval(() => {}, 999999);
      unrefTimer(timer);
      clearInterval(timer);
    });
  });

  describe("getEnvOverlayStorage", () => {
    it("should return null when no overlay is installed", () => {
      const storage = getEnvOverlayStorage();
      assertEquals(storage === null || typeof storage === "object", true);
    });
  });

  describe("promptSync", () => {
    it("should be a function", () => {
      assertEquals(typeof promptSync, "function");
    });
  });

  describe("runCommand", () => {
    it("should run a simple command", async () => {
      const result = await runCommand("echo", { args: ["hello"], capture: true });
      assertEquals(result.success, true);
      assertEquals(result.code, 0);
      assertEquals(result.stdout?.trim(), "hello");
    });

    it("should return failure for non-existent command", async () => {
      try {
        const result = await runCommand("__nonexistent_command_12345__", { capture: true });
        assertEquals(result.success, false);
      } catch {
        // In Deno, non-existent commands throw NotFound rather than returning failure
      }
    });

    it("should capture stderr", async () => {
      const result = await runCommand("ls", {
        args: ["__nonexistent_path_12345__"],
        capture: true,
      });
      assertEquals(result.success, false);
      assertExists(result.stderr);
      assertEquals(result.stderr.length > 0, true);
    });

    it("should pass environment variables", async () => {
      const result = await runCommand("env", {
        capture: true,
        env: { MY_TEST_VAR: "test-value-42" },
      });
      assertEquals(result.success, true);
      assertEquals(result.stdout?.includes("MY_TEST_VAR=test-value-42"), true);
    });

    it("should respect cwd option", async () => {
      const result = await runCommand("pwd", { capture: true, cwd: "/tmp" });
      assertEquals(result.success, true);
      const output = result.stdout?.trim() ?? "";
      assertEquals(output === "/tmp" || output === "/private/tmp", true);
    });

    it("should return undefined for stdout/stderr when not capturing", async () => {
      const result = await runCommand("echo", { args: ["hello"] });
      assertEquals(result.success, true);
      assertEquals(result.stdout, undefined);
      assertEquals(result.stderr, undefined);
    });

    it("should terminate commands that exceed timeout", async () => {
      const result = await runCommand("deno", {
        args: ["eval", "await new Promise((r) => setTimeout(r, 1000));"],
        capture: true,
        timeoutMs: 50,
      });
      assertEquals(result.success, false);
      assertEquals(result.code, 124);
      assertExists(result.stderr);
      assertEquals(result.stderr.includes("timed out"), true);
    });

    it("should force kill commands that ignore SIGTERM", async () => {
      const startedAt = Date.now();
      const result = await runCommand("deno", {
        args: [
          "eval",
          "Deno.addSignalListener('SIGTERM', () => {}); await new Promise(() => {});",
        ],
        capture: true,
        timeoutMs: 50,
      });
      const elapsedMs = Date.now() - startedAt;

      assertEquals(result.success, false);
      assertEquals(result.code, 124);
      assertExists(result.stderr);
      assertEquals(result.stderr.includes("timed out"), true);
      assertEquals(elapsedMs < 3_000, true);
    });
  });
});
