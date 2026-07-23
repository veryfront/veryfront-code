import "#veryfront/schemas/_test-setup.ts";
/**
 * Process Compat Tests
 *
 * These tests verify the cross-runtime process abstractions work correctly.
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { runWithProjectEnv } from "../../server/project-env/storage.ts";
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
  getHostEnv,
  getOsType,
  getRuntimeVersion,
  getStdout,
  getTerminalSize,
  isInteractive,
  isStdoutTTY,
  memoryUsage,
  onGlobalError,
  onSignal,
  pid,
  promptSync,
  runCommand,
  setEnv,
  testHasRuntimeProcess,
  unrefTimer,
  uptime,
  writeStdout,
  writeStdoutAsync,
} from "./process.ts";

describe("Process Compat", () => {
  describe("testHasRuntimeProcess", () => {
    it("should detect a real Node/Bun process object", () => {
      assertEquals(testHasRuntimeProcess(process), true);
    });

    it("should reject a version-only process shim", () => {
      assertEquals(testHasRuntimeProcess({ env: {}, versions: { node: "22.0.0" } }), false);
    });

    it("should reject a browser process shim", () => {
      assertEquals(testHasRuntimeProcess({ env: {} }), false);
    });

    it("should reject null", () => {
      assertEquals(testHasRuntimeProcess(null), false);
    });

    it("should reject undefined", () => {
      assertEquals(testHasRuntimeProcess(undefined), false);
    });

    it("should reject non-object", () => {
      assertEquals(testHasRuntimeProcess("string"), false);
      assertEquals(testHasRuntimeProcess(42), false);
      assertEquals(testHasRuntimeProcess(true), false);
    });

    it("should reject process with empty node version", () => {
      assertEquals(testHasRuntimeProcess({ versions: { node: "" } }), false);
    });

    it("should reject process with missing versions.node", () => {
      assertEquals(testHasRuntimeProcess({ versions: {} }), false);
    });

    it("should reject process with non-string versions.node", () => {
      assertEquals(testHasRuntimeProcess({ versions: { node: 22 } }), false);
    });

    it("should reject hostile process shims without propagating getter failures", () => {
      const hostileProcess = new Proxy({}, {
        get() {
          throw new Error("hostile process getter");
        },
      });

      assertEquals(testHasRuntimeProcess(hostileProcess), false);
    });

    for (
      const [property, value] of [
        ["pid", Number.NaN],
        ["off", undefined],
        ["stdout", {}],
      ] as const
    ) {
      it(`should reject a process with an invalid ${property}`, () => {
        const invalidProcess = new Proxy(process, {
          get(target, key, receiver) {
            return key === property ? value : Reflect.get(target, key, receiver);
          },
        });

        assertEquals(testHasRuntimeProcess(invalidProcess), false);
      });
    }
  });

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

    it("keeps direct env readers aligned inside the test overlay", () => {
      setEnv(testKey, testValue);

      try {
        assertEquals(getEnv(testKey), testValue);
        assertEquals(process.env[testKey], testValue);
        assertEquals(Deno.env.get(testKey), testValue);
        assertEquals(env()[testKey], testValue);
      } finally {
        deleteEnv(testKey);
      }

      assertEquals(process.env[testKey], undefined);
      assertEquals(Deno.env.get(testKey), undefined);
    });
  });

  describe("getHostEnv", () => {
    const testKey = "__TEST_HOST_ENV__";

    afterEach(() => {
      try {
        deleteEnv(testKey);
      } catch {
        // Ignore if not supported
      }
    });

    it("should bypass project env overlays", () => {
      setEnv(testKey, "host-value");

      runWithProjectEnv({ [testKey]: "project-value" }, () => {
        assertEquals(getEnv(testKey), "project-value");
        assertEquals(getHostEnv(testKey), "host-value");
      });
    });

    it("returns undefined instead of throwing when an env read is denied", () => {
      // Under a tightened env permission allowlist (project isolation workers),
      // Deno.env.get throws NotCapable for a non-allowlisted key. getHostEnv must
      // degrade to undefined rather than propagating the throw and crashing the
      // request. Simulate the denial by stubbing Deno.env.get.
      if (typeof Deno === "undefined") return;
      const original = Deno.env.get;
      try {
        Deno.env.get = () => {
          const error = new Error("Requires env access");
          error.name = "NotCapable";
          throw error;
        };
        assertEquals(getHostEnv("__DENIED_BY_ALLOWLIST__"), undefined);
      } finally {
        Deno.env.get = original;
      }
    });

    it("does not hide unexpected environment failures", () => {
      if (typeof Deno === "undefined") return;
      const original = Deno.env.get;
      try {
        Deno.env.get = () => {
          throw new Error("unexpected env failure");
        };
        assertThrows(() => getHostEnv("__UNEXPECTED_FAILURE__"), Error, "unexpected env failure");
      } finally {
        Deno.env.get = original;
      }
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

    it("should return undefined for invalid env var when fallback is not provided", () => {
      setEnv(testKey, "invalid");
      assertEquals(getEnvNumber(testKey), undefined);
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

    for (const invalidValue of ["42px", "1.5.2", "Infinity", "", "   "]) {
      it(`should reject non-numeric value ${JSON.stringify(invalidValue)}`, () => {
        setEnv(testKey, invalidValue);
        assertEquals(getEnvNumber(testKey), undefined);
      });
    }

    it("should parse finite decimal and exponent values without truncation", () => {
      setEnv(testKey, "1.5");
      assertEquals(getEnvNumber(testKey), 1.5);
      setEnv(testKey, "1e3");
      assertEquals(getEnvNumber(testKey), 1000);
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

    it("should be case-insensitive by default", () => {
      setEnv(testKey, "TRUE");
      assertEquals(getEnvBoolean(testKey), true);
      setEnv(testKey, "True");
      assertEquals(getEnvBoolean(testKey), true);
      setEnv(testKey, "FALSE");
      assertEquals(getEnvBoolean(testKey, true), false);
    });

    it("should trim whitespace by default", () => {
      setEnv(testKey, "  true  ");
      assertEquals(getEnvBoolean(testKey), true);
      setEnv(testKey, " false ");
      assertEquals(getEnvBoolean(testKey, true), false);
    });

    it("should return fallback for unrecognized values", () => {
      setEnv(testKey, "maybe");
      assertEquals(getEnvBoolean(testKey, true), true);
      assertEquals(getEnvBoolean(testKey, false), false);
    });

    it("should use custom falseValues", () => {
      setEnv(testKey, "off");
      assertEquals(getEnvBoolean(testKey, true, { falseValues: ["off"] }), false);
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
      const removeHandler = onSignal("SIGINT", handler);
      assertEquals(typeof removeHandler, "function");
      removeHandler();
    });

    it("should accept SIGTERM handler without throwing", {
      sanitizeResources: false,
      sanitizeOps: false,
    }, () => {
      const handler = () => {};
      const removeHandler = onSignal("SIGTERM", handler);
      assertEquals(typeof removeHandler, "function");
      removeHandler();
    });
  });

  describe("onGlobalError", () => {
    it("returns an idempotent cleanup function", () => {
      const removeHandlers = onGlobalError(() => true);
      assertEquals(typeof removeHandlers, "function");
      removeHandlers();
      removeHandlers();
    });

    it("stops handling errors after cleanup", () => {
      let handledErrors = 0;
      const removeHandlers = onGlobalError(() => {
        handledErrors += 1;
        return true;
      });

      const handled = globalThis.dispatchEvent(
        new ErrorEvent("error", { error: new Error("synthetic error"), cancelable: true }),
      );
      removeHandlers();
      const unhandled = globalThis.dispatchEvent(
        new ErrorEvent("error", { error: new Error("after cleanup"), cancelable: true }),
      );

      assertEquals(handled, false);
      assertEquals(unhandled, true);
      assertEquals(handledErrors, 1);
    });
  });

  describe("unrefTimer", () => {
    it("should unref a timer without error", () => {
      const timer = setInterval(() => {}, 999999);
      unrefTimer(timer);
      clearInterval(timer);
    });

    it("ignores timer-like objects without a callable unref", () => {
      const timerLike = { unref: undefined };
      unrefTimer(timerLike as unknown as ReturnType<typeof setInterval>);
    });
  });

  describe("getEnvOverlayStorage", () => {
    it("should return null when no overlay is installed", () => {
      const storage = getEnvOverlayStorage();
      assertEquals(storage === null || typeof storage === "object", true);
    });

    it("skips invalid legacy sentinels without invoking accessors", () => {
      const globalRecord = globalThis as Record<string, unknown>;
      const legacyKey = "__vfTestDenoEnvOverlay";
      const currentKey = "__vfTestEnvOverlay";
      const legacyDescriptor = Object.getOwnPropertyDescriptor(globalRecord, legacyKey);
      const currentDescriptor = Object.getOwnPropertyDescriptor(globalRecord, currentKey);
      let accessorCalls = 0;
      const expectedStorage = {
        getStore: () => undefined,
        run: <T>(_store: unknown, fn: () => T) => fn(),
      };

      Object.defineProperty(globalRecord, legacyKey, {
        configurable: true,
        get() {
          accessorCalls++;
          throw new Error("legacy sentinel accessor must not run");
        },
      });
      Object.defineProperty(globalRecord, currentKey, {
        configurable: true,
        value: { storage: expectedStorage },
        writable: true,
      });

      try {
        assertStrictEquals(getEnvOverlayStorage(), expectedStorage);
        assertEquals(accessorCalls, 0);
      } finally {
        if (legacyDescriptor) Object.defineProperty(globalRecord, legacyKey, legacyDescriptor);
        else delete globalRecord[legacyKey];
        if (currentDescriptor) Object.defineProperty(globalRecord, currentKey, currentDescriptor);
        else delete globalRecord[currentKey];
      }
    });

    it("does not invoke accessors nested inside sentinel containers", () => {
      const globalRecord = globalThis as Record<string, unknown>;
      const legacyKey = "__vfTestDenoEnvOverlay";
      const currentKey = "__vfTestEnvOverlay";
      const legacyDescriptor = Object.getOwnPropertyDescriptor(globalRecord, legacyKey);
      const currentDescriptor = Object.getOwnPropertyDescriptor(globalRecord, currentKey);
      let accessorCalls = 0;
      const hostileContainer = Object.create(null);
      Object.defineProperty(hostileContainer, "storage", {
        enumerable: true,
        get() {
          accessorCalls++;
          throw new Error("storage accessor must not run");
        },
      });
      const expectedStorage = { getStore: () => undefined };

      Object.defineProperty(globalRecord, legacyKey, {
        configurable: true,
        value: hostileContainer,
        writable: true,
      });
      Object.defineProperty(globalRecord, currentKey, {
        configurable: true,
        value: { storage: expectedStorage },
        writable: true,
      });

      try {
        assertStrictEquals(getEnvOverlayStorage(), expectedStorage);
        assertEquals(accessorCalls, 0);
      } finally {
        if (legacyDescriptor) Object.defineProperty(globalRecord, legacyKey, legacyDescriptor);
        else delete globalRecord[legacyKey];
        if (currentDescriptor) Object.defineProperty(globalRecord, currentKey, currentDescriptor);
        else delete globalRecord[currentKey];
      }
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
      const result = await runCommand("__nonexistent_command_12345__", { capture: true });
      assertEquals(result.success, false);
      assertEquals(result.code, 1);
      assertEquals(result.stderr?.includes("Unable to start command"), true);
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

    it("should let inherit take precedence over capture", async () => {
      const result = await runCommand("printf", {
        args: ["inherited-output"],
        capture: true,
        inherit: true,
      });
      assertEquals(result.success, true);
      assertEquals(result.stdout, undefined);
      assertEquals(result.stderr, undefined);
    });

    it("should honor shell command strings", async () => {
      const result = await runCommand("printf shell-ok", { shell: true, capture: true });
      assertEquals(result.success, true);
      assertEquals(result.stdout, "shell-ok");
    });

    for (const timeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      it(`should reject invalid timeout ${String(timeoutMs)}`, async () => {
        await assertRejects(
          () => runCommand("echo", { timeoutMs }),
          RangeError,
          "timeoutMs",
        );
      });
    }

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
