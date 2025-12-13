import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createHttpInstruments } from "./http-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("http-instruments", () => {
  describe("createHttpInstruments", () => {
    it("should create http instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createHttpInstruments(meter, config);

      assertExists(instruments.httpRequestCounter);
      assertExists(instruments.httpRequestDuration);
      assertExists(instruments.httpActiveRequests);
    });

    it("should return all required http instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createHttpInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("httpRequestCounter" in instruments, true);
      assertEquals("httpRequestDuration" in instruments, true);
      assertEquals("httpActiveRequests" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createHttpInstruments(meter, config);

      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createHttpInstruments(meter, config);

      assertExists(instruments.httpRequestCounter);
      assertExists(instruments.httpRequestDuration);
      assertExists(instruments.httpActiveRequests);
    });
  });
});
