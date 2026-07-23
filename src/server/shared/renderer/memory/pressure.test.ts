import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { shouldRejectDueToMemory } from "./pressure.ts";

describe("server/shared/renderer/memory/pressure", () => {
  describe("shouldRejectDueToMemory", () => {
    it("should return a boolean", () => {
      const result = shouldRejectDueToMemory();
      assertEquals(typeof result, "boolean");
    });

    it("should return false under normal memory conditions", () => {
      // In a test environment, memory should not be critical
      const result = shouldRejectDueToMemory();
      assertEquals(result, false);
    });

    it("should be callable multiple times without error", () => {
      // Ensure no state corruption between calls
      const r1 = shouldRejectDueToMemory();
      const r2 = shouldRejectDueToMemory();
      assertEquals(typeof r1, "boolean");
      assertEquals(typeof r2, "boolean");
    });
  });

  it("does not expose invalid threshold values in warnings", async () => {
    const environmentNames = [
      "MEMORY_WARNING_THRESHOLD",
      "MEMORY_HIGH_THRESHOLD",
      "MEMORY_CRITICAL_THRESHOLD",
      "LOG_LEVEL",
    ] as const;
    const previous = new Map(environmentNames.map((name) => [name, Deno.env.get(name)]));
    const entries: LogEntry[] = [];

    try {
      Deno.env.set("MEMORY_WARNING_THRESHOLD", "private-threshold-canary\nforged-log-line");
      Deno.env.set("MEMORY_HIGH_THRESHOLD", "75");
      Deno.env.set("MEMORY_CRITICAL_THRESHOLD", "80");
      Deno.env.set("LOG_LEVEL", "WARN");
      __resetLoggerConfigForTests();
      __registerLogRecordEmitter((entry) => entries.push(entry));

      await import(`./pressure.ts?privacy=${crypto.randomUUID()}`);

      const serialized = JSON.stringify(entries);
      assertEquals(serialized.includes("private-threshold-canary"), false);
      assertEquals(serialized.includes("forged-log-line"), false);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
      __resetLogRecordEmitterForTests();
      __resetLoggerConfigForTests();
    }
  });
});
