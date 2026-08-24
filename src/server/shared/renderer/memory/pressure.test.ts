import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  classifyMemoryPressure,
  getMemoryPressureLevel,
  parseEnvThreshold,
  shouldRejectDueToMemory,
} from "./pressure.ts";

const DEFAULT_THRESHOLDS = { WARNING: 65, HIGH: 75, CRITICAL: 80 };

function withHeapUsedPercent(heapUsedPercent: number): void {
  __injectDepsForTests({ getHeapStats: () => ({ heapUsedPercent }) });
}

describe("server/shared/renderer/memory/pressure", () => {
  afterEach(() => {
    __injectDepsForTests(null);
  });

  describe("shouldRejectDueToMemory", () => {
    it("rejects at exactly the CRITICAL threshold and above", () => {
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL);
      assertEquals(shouldRejectDueToMemory(), true, "heap at CRITICAL (80) must reject");
      withHeapUsedPercent(99.5);
      assertEquals(shouldRejectDueToMemory(), true, "heap above CRITICAL (80) must reject");
    });

    it("does not reject just below the CRITICAL threshold", () => {
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL - 0.1);
      assertEquals(shouldRejectDueToMemory(), false, "heap at CRITICAL - 0.1 must not reject");
      withHeapUsedPercent(79);
      assertEquals(shouldRejectDueToMemory(), false, "heap at 79 must not reject");
    });

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

  describe("getMemoryPressureLevel", () => {
    it("walks the level ladder at the default thresholds", () => {
      withHeapUsedPercent(64.9);
      assertEquals(getMemoryPressureLevel(), "normal", "below WARNING (65) is normal");
      withHeapUsedPercent(DEFAULT_THRESHOLDS.WARNING);
      assertEquals(getMemoryPressureLevel(), "warning", "exactly WARNING (65) is warning");
      withHeapUsedPercent(DEFAULT_THRESHOLDS.HIGH);
      assertEquals(getMemoryPressureLevel(), "high", "exactly HIGH (75) is high");
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL);
      assertEquals(getMemoryPressureLevel(), "critical", "exactly CRITICAL (80) is critical");
    });

    it("classifies against explicit thresholds", () => {
      const thresholds = { WARNING: 10, HIGH: 20, CRITICAL: 30 };
      assertEquals(classifyMemoryPressure(9.9, thresholds), "normal", "below WARNING is normal");
      assertEquals(classifyMemoryPressure(10, thresholds), "warning", "at WARNING is warning");
      assertEquals(classifyMemoryPressure(20, thresholds), "high", "at HIGH is high");
      assertEquals(classifyMemoryPressure(30, thresholds), "critical", "at CRITICAL is critical");
    });
  });

  describe("parseEnvThreshold", () => {
    const readerFor = (value: string | undefined) => (name: string) =>
      name === "MEMORY_CRITICAL_THRESHOLD" ? value : undefined;

    it("uses the configured value when it is a valid percentage", () => {
      assertEquals(
        parseEnvThreshold("MEMORY_CRITICAL_THRESHOLD", 80, readerFor("90")),
        90,
        "MEMORY_CRITICAL_THRESHOLD=90 must be honored",
      );
    });

    it("falls back to the default when the variable is unset", () => {
      assertEquals(
        parseEnvThreshold("MEMORY_CRITICAL_THRESHOLD", 80, readerFor(undefined)),
        80,
        "an unset MEMORY_CRITICAL_THRESHOLD must use the default 80",
      );
    });

    it("falls back to the default for out-of-range or non-integer values", () => {
      for (const value of ["150", "-1", "abc", "79.5"]) {
        assertEquals(
          parseEnvThreshold("MEMORY_CRITICAL_THRESHOLD", 80, readerFor(value)),
          80,
          `MEMORY_CRITICAL_THRESHOLD=${value} must fall back to the default 80`,
        );
      }
    });
  });
});
