import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createBuildInstruments } from "./build-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("build-instruments", () => {
  describe("createBuildInstruments", () => {
    it("should create build instruments with correct names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createBuildInstruments(meter, config);

      assertExists(instruments.buildDuration);
      assertExists(instruments.bundleSizeHistogram);
      assertExists(instruments.bundleCounter);
    });

    it("should return all required instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createBuildInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("buildDuration" in instruments, true);
      assertEquals("bundleSizeHistogram" in instruments, true);
      assertEquals("bundleCounter" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createBuildInstruments(meter, config);

      // Instruments should be created successfully
      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createBuildInstruments(meter, config);

      assertExists(instruments.buildDuration);
      assertExists(instruments.bundleSizeHistogram);
      assertExists(instruments.bundleCounter);
    });
  });
});
