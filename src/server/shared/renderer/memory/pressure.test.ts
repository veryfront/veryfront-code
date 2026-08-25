import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  classifyMemoryPressure,
  getMemoryPressureLevel,
  parseEnvThreshold,
  shouldRejectDueToMemory,
  THRESHOLDS,
} from "./pressure.ts";

// The module resolves its thresholds from MEMORY_*_THRESHOLD at load, so boundary
// cases must be expressed against the resolved values. Hard-coding the defaults
// would make these assertions wrong wherever those variables are configured.
const DEFAULT_THRESHOLDS = THRESHOLDS;

function withHeapUsedPercent(
  heapUsedPercent: number,
  thresholds: typeof THRESHOLDS = THRESHOLDS,
): void {
  __injectDepsForTests({ getHeapStats: () => ({ heapUsedPercent }), thresholds });
}

describe("server/shared/renderer/memory/pressure", () => {
  afterEach(() => {
    __injectDepsForTests(null);
  });

  describe("shouldRejectDueToMemory", () => {
    it("rejects at exactly the CRITICAL threshold and above", () => {
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL);
      assertEquals(
        shouldRejectDueToMemory(),
        true,
        `heap at CRITICAL (${DEFAULT_THRESHOLDS.CRITICAL}) must reject`,
      );
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL + 0.5);
      assertEquals(
        shouldRejectDueToMemory(),
        true,
        `heap above CRITICAL (${DEFAULT_THRESHOLDS.CRITICAL}) must reject`,
      );
    });

    it("does not reject just below the CRITICAL threshold", () => {
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL - 0.1);
      assertEquals(shouldRejectDueToMemory(), false, "heap at CRITICAL - 0.1 must not reject");
      withHeapUsedPercent(DEFAULT_THRESHOLDS.CRITICAL - 1);
      assertEquals(
        shouldRejectDueToMemory(),
        false,
        `heap at CRITICAL - 1 (${DEFAULT_THRESHOLDS.CRITICAL - 1}) must not reject`,
      );
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
    it("walks the level ladder against explicit ordered thresholds", () => {
      const thresholds = { WARNING: 10, HIGH: 20, CRITICAL: 30 };

      withHeapUsedPercent(thresholds.WARNING - 0.1, thresholds);
      assertEquals(
        getMemoryPressureLevel(),
        "normal",
        "below WARNING is normal",
      );
      withHeapUsedPercent(thresholds.WARNING, thresholds);
      assertEquals(
        getMemoryPressureLevel(),
        "warning",
        "exactly WARNING is warning",
      );
      withHeapUsedPercent(thresholds.HIGH, thresholds);
      assertEquals(
        getMemoryPressureLevel(),
        "high",
        "exactly HIGH is high",
      );
      withHeapUsedPercent(thresholds.CRITICAL, thresholds);
      assertEquals(
        getMemoryPressureLevel(),
        "critical",
        "exactly CRITICAL is critical",
      );
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
