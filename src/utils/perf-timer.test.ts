import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { refreshLoggerConfig } from "./logger/logger.ts";
import { runWithProjectEnv } from "../server/project-env/storage.ts";
import {
  __getActivePerfRequestCountForTests,
  __resetPerfTimerForTests,
  endRequest,
  isEnabled,
  startRequest,
  startTimer,
  timeAsync,
} from "./perf-timer.ts";

describe("perf-timer", () => {
  describe("isEnabled", () => {
    it("should return a boolean", () => {
      assertEquals(typeof isEnabled(), "boolean");
    });
  });

  describe("startRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      startRequest("test-request-1");
    });
  });

  describe("endRequest (disabled mode)", () => {
    it("should not throw when called", () => {
      endRequest("test-request-1");
    });

    it("should not throw for unknown request ID", () => {
      endRequest("nonexistent-request");
    });
  });

  describe("startTimer (disabled mode)", () => {
    it("should return a no-op function", () => {
      const stop = startTimer("test-label");
      assertEquals(typeof stop, "function");
      stop();
    });

    it("should accept optional parent parameter", () => {
      const stop = startTimer("child-label", "parent-label");
      assertEquals(typeof stop, "function");
      stop();
    });
  });

  describe("timeAsync", () => {
    it("should execute and return the result of the async function", async () => {
      assertEquals(await timeAsync("test", () => Promise.resolve(42)), 42);
    });

    it("should propagate errors from the async function", async () => {
      try {
        await timeAsync("test", () => {
          throw new Error("test error");
        });
        assertEquals(true, false);
      } catch (e) {
        assertEquals((e as Error).message, "test error");
      }
    });

    it("should accept optional parent parameter", async () => {
      assertEquals(await timeAsync("child", () => Promise.resolve("ok"), "parent"), "ok");
    });

    it("should handle promises that resolve after delay", async () => {
      const result = await timeAsync("delayed", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return "delayed-result";
      });
      assertEquals(result, "delayed-result");
    });
  });

  describe("enabled request isolation", () => {
    it("uses host configuration instead of a project env overlay", () => {
      const previousPerf = Deno.env.get("VERYFRONT_PERF");
      try {
        Deno.env.set("VERYFRONT_PERF", "1");
        __resetPerfTimerForTests();
        runWithProjectEnv({}, () => startRequest("host-enabled"));
        assertEquals(__getActivePerfRequestCountForTests(), 1);
        endRequest("host-enabled");

        Deno.env.delete("VERYFRONT_PERF");
        __resetPerfTimerForTests();
        runWithProjectEnv({ VERYFRONT_PERF: "1" }, () => startRequest("project-enabled"));
        assertEquals(__getActivePerfRequestCountForTests(), 0);
      } finally {
        if (previousPerf === undefined) Deno.env.delete("VERYFRONT_PERF");
        else Deno.env.set("VERYFRONT_PERF", previousPerf);
        __resetPerfTimerForTests();
      }
    });

    it("keeps concurrent and nested timings attached to their own request", async () => {
      const previousPerf = Deno.env.get("VERYFRONT_PERF");
      const previousLevel = Deno.env.get("LOG_LEVEL");
      const previousFormat = Deno.env.get("LOG_FORMAT");
      const originalDebug = console.debug;
      const lines: string[] = [];

      Deno.env.set("VERYFRONT_PERF", "1");
      Deno.env.set("LOG_LEVEL", "DEBUG");
      Deno.env.set("LOG_FORMAT", "json");
      console.debug = (line: unknown) => lines.push(String(line));
      __resetPerfTimerForTests();
      refreshLoggerConfig();

      const runRequest = (requestId: string, label: string): Promise<void> =>
        new Promise((resolve) => {
          queueMicrotask(async () => {
            startRequest(requestId);
            const stop = startTimer(label);
            await Promise.resolve();
            stop();
            endRequest(requestId);
            resolve();
          });
        });

      try {
        await Promise.all([
          runRequest("request-a", "only-a"),
          runRequest("request-b", "only-b"),
        ]);

        const entries = lines.map((line) =>
          JSON.parse(line) as {
            message: string;
            context?: { breakdown?: Array<{ label: string }> };
          }
        );
        const requestA = entries.find((entry) => entry.message === "Request request-a");
        const requestB = entries.find((entry) => entry.message === "Request request-b");

        assertEquals(requestA?.context?.breakdown?.map((entry) => entry.label), ["only-a"]);
        assertEquals(requestB?.context?.breakdown?.map((entry) => entry.label), ["only-b"]);
        assertEquals(__getActivePerfRequestCountForTests(), 0);
      } finally {
        console.debug = originalDebug;
        if (previousPerf === undefined) Deno.env.delete("VERYFRONT_PERF");
        else Deno.env.set("VERYFRONT_PERF", previousPerf);
        if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLevel);
        if (previousFormat === undefined) Deno.env.delete("LOG_FORMAT");
        else Deno.env.set("LOG_FORMAT", previousFormat);
        __resetPerfTimerForTests();
        refreshLoggerConfig();
      }
    });

    it("removes requests that contain no timing entries", () => {
      const previousPerf = Deno.env.get("VERYFRONT_PERF");
      Deno.env.set("VERYFRONT_PERF", "1");
      __resetPerfTimerForTests();
      try {
        startRequest("empty-request");
        assertEquals(__getActivePerfRequestCountForTests(), 1);
        endRequest("empty-request");
        assertEquals(__getActivePerfRequestCountForTests(), 0);
      } finally {
        if (previousPerf === undefined) Deno.env.delete("VERYFRONT_PERF");
        else Deno.env.set("VERYFRONT_PERF", previousPerf);
        __resetPerfTimerForTests();
      }
    });
  });
});
