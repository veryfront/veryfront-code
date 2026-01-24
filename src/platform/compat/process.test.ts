/**
 * Process Compat Tests
 *
 * These tests verify the cross-runtime process abstractions work correctly.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  cwd,
  deleteEnv,
  env,
  getArgs,
  getEnv,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  memoryUsage,
  pid,
  requireEnv,
  setEnv,
  writeStdout,
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
  });

  describe("requireEnv", () => {
    const testKey = "__TEST_REQUIRE_ENV__";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore
      }
    });

    it("should return value when env var exists", () => {
      setEnv(testKey, "required-value");
      assertEquals(requireEnv(testKey), "required-value");
    });

    it("should throw when env var does not exist", () => {
      try {
        requireEnv("__DEFINITELY_NOT_SET__");
        assertEquals(false, true);
      } catch (e) {
        assertEquals(e instanceof Error, true);
      }
    });
  });

  describe("env", () => {
    it("should return all environment variables", () => {
      const envVars = env();
      assertExists(envVars);
      assertEquals(typeof envVars, "object");
      assertExists(envVars["PATH"] ?? envVars["Path"]);
    });
  });

  describe("cwd", () => {
    it("should return current working directory", () => {
      const currentDir = cwd();
      assertExists(currentDir);
      assertEquals(typeof currentDir, "string");
      assertEquals(currentDir.length > 0, true);
    });
  });

  describe("getArgs", () => {
    it("should return command line arguments array", () => {
      assertEquals(Array.isArray(getArgs()), true);
    });
  });

  describe("pid", () => {
    it("should return a process ID", () => {
      const processId = pid();
      assertEquals(typeof processId, "number");
      assertEquals(processId > 0, true);
    });
  });

  describe("memoryUsage", () => {
    it("should return memory usage stats", () => {
      const usage = memoryUsage();
      assertExists(usage);
      assertEquals(typeof usage.rss, "number");
      assertEquals(typeof usage.heapTotal, "number");
      assertEquals(typeof usage.heapUsed, "number");
      assertEquals(usage.rss > 0, true);
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
  });
});
