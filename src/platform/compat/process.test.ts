import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import {
  chdir,
  cwd,
  deleteEnv,
  env,
  execPath,
  getArgs,
  getEnv,
  getNetworkInterfaces,
  getRuntimeVersion,
  getStdout,
  isInteractive,
  memoryUsage,
  onGlobalError,
  onSignal,
  pid,
  ppid,
  requireEnv,
  setEnv,
  unrefTimer,
  uptime,
} from "./process.ts";

describe("process.ts", () => {
  describe("getArgs", () => {
    it("should export getArgs function", () => {
      assertExists(getArgs);
      assertEquals(typeof getArgs, "function");
    });

    it("should return an array", () => {
      const args = getArgs();
      assertEquals(Array.isArray(args), true);
    });
  });

  describe("cwd", () => {
    it("should export cwd function", () => {
      assertExists(cwd);
      assertEquals(typeof cwd, "function");
    });

    it("should return current directory", () => {
      const dir = cwd();
      assertEquals(typeof dir, "string");
      assertEquals(dir.length > 0, true);
    });
  });

  describe("chdir", () => {
    it("should export chdir function", () => {
      assertExists(chdir);
      assertEquals(typeof chdir, "function");
    });

    it("should change directory", () => {
      const originalDir = cwd();
      chdir("/tmp");
      const newDir = cwd();
      chdir(originalDir); // Restore

      // On macOS, /tmp is a symlink to /private/tmp
      assertEquals(newDir === "/tmp" || newDir === "/private/tmp", true);
    });
  });

  describe("env", () => {
    it("should export env function", () => {
      assertExists(env);
      assertEquals(typeof env, "function");
    });

    it("should return object", () => {
      const envObj = env();
      assertEquals(typeof envObj, "object");
    });
  });

  describe("getEnv/setEnv/deleteEnv", () => {
    it("should export getEnv function", () => {
      assertExists(getEnv);
      assertEquals(typeof getEnv, "function");
    });

    it("should export setEnv function", () => {
      assertExists(setEnv);
      assertEquals(typeof setEnv, "function");
    });

    it("should export deleteEnv function", () => {
      assertExists(deleteEnv);
      assertEquals(typeof deleteEnv, "function");
    });

    it("should set and get environment variable", () => {
      const key = "TEST_VAR_" + Math.random().toString(36).substring(7);
      const value = "test_value";

      setEnv(key, value);
      assertEquals(getEnv(key), value);

      deleteEnv(key);
      assertEquals(getEnv(key), undefined);
    });
  });

  describe("requireEnv", () => {
    it("should export requireEnv function", () => {
      assertExists(requireEnv);
      assertEquals(typeof requireEnv, "function");
    });

    it("should return value for existing env var", () => {
      const key = "TEST_REQUIRE_" + Math.random().toString(36).substring(7);
      setEnv(key, "exists");
      assertEquals(requireEnv(key), "exists");
      deleteEnv(key);
    });

    it("should throw for non-existent env var", () => {
      assertThrows(
        () => requireEnv("NON_EXISTENT_VAR_XYZ123"),
        Error,
        'Required environment variable "NON_EXISTENT_VAR_XYZ123" is not set',
      );
    });
  });

  describe("pid", () => {
    it("should export pid function", () => {
      assertExists(pid);
      assertEquals(typeof pid, "function");
    });

    it("should return number", () => {
      const p = pid();
      assertEquals(typeof p, "number");
      assertEquals(p > 0, true);
    });
  });

  describe("ppid", () => {
    it("should export ppid function", () => {
      assertExists(ppid);
      assertEquals(typeof ppid, "function");
    });

    it("should return number", () => {
      const p = ppid();
      assertEquals(typeof p, "number");
    });
  });

  describe("memoryUsage", () => {
    it("should export memoryUsage function", () => {
      assertExists(memoryUsage);
      assertEquals(typeof memoryUsage, "function");
    });

    it("should return memory stats", () => {
      const usage = memoryUsage();
      assertEquals(typeof usage.rss, "number");
      assertEquals(typeof usage.heapTotal, "number");
      assertEquals(typeof usage.heapUsed, "number");
      assertEquals(typeof usage.external, "number");
    });
  });

  describe("isInteractive", () => {
    it("should export isInteractive function", () => {
      assertExists(isInteractive);
      assertEquals(typeof isInteractive, "function");
    });

    it("should return boolean", () => {
      const result = isInteractive();
      assertEquals(typeof result, "boolean");
    });
  });

  describe("getNetworkInterfaces", () => {
    it("should export getNetworkInterfaces function", () => {
      assertExists(getNetworkInterfaces);
      assertEquals(typeof getNetworkInterfaces, "function");
    });

    it("should return network interfaces", async () => {
      const interfaces = await getNetworkInterfaces();
      assertEquals(Array.isArray(interfaces), true);
    });
  });

  describe("getRuntimeVersion", () => {
    it("should export getRuntimeVersion function", () => {
      assertExists(getRuntimeVersion);
      assertEquals(typeof getRuntimeVersion, "function");
    });

    it("should return runtime version string", () => {
      const version = getRuntimeVersion();
      assertEquals(typeof version, "string");
      assertEquals(version.startsWith("Deno"), true);
    });
  });

  describe("onSignal", () => {
    it("should export onSignal function", () => {
      assertExists(onSignal);
      assertEquals(typeof onSignal, "function");
    });
  });

  describe("onGlobalError", () => {
    it("should export onGlobalError function", () => {
      assertExists(onGlobalError);
      assertEquals(typeof onGlobalError, "function");
    });
  });

  describe("unrefTimer", () => {
    it("should export unrefTimer function", () => {
      assertExists(unrefTimer);
      assertEquals(typeof unrefTimer, "function");
    });
  });

  describe("execPath", () => {
    it("should export execPath function", () => {
      assertExists(execPath);
      assertEquals(typeof execPath, "function");
    });

    it("should return path to executable", () => {
      const path = execPath();
      assertEquals(typeof path, "string");
      assertEquals(path.length > 0, true);
    });
  });

  describe("uptime", () => {
    it("should export uptime function", () => {
      assertExists(uptime);
      assertEquals(typeof uptime, "function");
    });

    it("should return uptime in seconds", () => {
      const time = uptime();
      assertEquals(typeof time, "number");
      assertEquals(time >= 0, true);
    });
  });

  describe("getStdout", () => {
    it("should export getStdout function", () => {
      assertExists(getStdout);
      assertEquals(typeof getStdout, "function");
    });

    it("should return stdout writer or null", () => {
      const stdout = getStdout();
      if (stdout !== null) {
        assertExists(stdout.write);
        assertEquals(typeof stdout.write, "function");
      }
    });
  });
});
