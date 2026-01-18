/**
 * Process Compat Tests
 *
 * These tests verify the cross-runtime process abstractions work correctly.
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
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
      let threw = false;
      try {
        requireEnv("__DEFINITELY_NOT_SET__");
      } catch (e) {
        threw = true;
        assertEquals(e instanceof Error, true);
      }
      assertEquals(threw, true);
    });
  });

  describe("env", () => {
    it("should return all environment variables", () => {
      const envVars = env();
      assertExists(envVars);
      assertEquals(typeof envVars, "object");
      // PATH is almost always set
      assertExists(envVars["PATH"] || envVars["Path"]);
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
      // Should be one of the common OS types
      const validTypes = ["darwin", "linux", "windows", "freebsd", "netbsd", "aix", "solaris"];
      assertEquals(validTypes.includes(os) || os === "unknown", true);
    });
  });

  describe("getRuntimeVersion", () => {
    it("should return a runtime version string", () => {
      const version = getRuntimeVersion();
      assertExists(version);
      assertEquals(typeof version, "string");
      // Should start with one of the known runtimes
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
      // Should return default or actual values
      assertEquals(size.columns > 0, true);
      assertEquals(size.rows > 0, true);
    });
  });

  describe("isInteractive / isStdoutTTY", () => {
    it("should return boolean for isInteractive", () => {
      const interactive = isInteractive();
      assertEquals(typeof interactive, "boolean");
    });

    it("should return boolean for isStdoutTTY", () => {
      const tty = isStdoutTTY();
      assertEquals(typeof tty, "boolean");
    });
  });

  describe("getStdout", () => {
    it("should return stdout object with write method", () => {
      const stdout = getStdout();
      assertExists(stdout);
      assertEquals(typeof stdout.write, "function");
    });
  });

  describe("writeStdout", () => {
    it("should write to stdout without throwing", () => {
      // Should not throw
      writeStdout("");
    });
  });
});
