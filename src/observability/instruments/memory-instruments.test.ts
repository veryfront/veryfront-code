import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createMemoryInstruments } from "./memory-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("memory-instruments", () => {
  describe("createMemoryInstruments", () => {
    it("should create memory instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createMemoryInstruments(meter, config);

      assertExists(instruments.memoryUsageGauge);
      assertExists(instruments.heapUsageGauge);
    });

    it("should return all required memory instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createMemoryInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("memoryUsageGauge" in instruments, true);
      assertEquals("heapUsageGauge" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createMemoryInstruments(meter, config);

      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createMemoryInstruments(meter, config);

      assertExists(instruments.memoryUsageGauge);
      assertExists(instruments.heapUsageGauge);
    });
  });
});
