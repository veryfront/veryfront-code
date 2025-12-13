import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createDataInstruments } from "./data-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("data-instruments", () => {
  describe("createDataInstruments", () => {
    it("should create data instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createDataInstruments(meter, config);

      assertExists(instruments.dataFetchDuration);
      assertExists(instruments.dataFetchCounter);
      assertExists(instruments.dataFetchErrorCounter);
    });

    it("should return all required data instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createDataInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("dataFetchDuration" in instruments, true);
      assertEquals("dataFetchCounter" in instruments, true);
      assertEquals("dataFetchErrorCounter" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createDataInstruments(meter, config);

      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createDataInstruments(meter, config);

      assertExists(instruments.dataFetchDuration);
      assertExists(instruments.dataFetchCounter);
      assertExists(instruments.dataFetchErrorCounter);
    });
  });
});
