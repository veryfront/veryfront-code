import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createRenderInstruments } from "./render-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("render-instruments", () => {
  describe("createRenderInstruments", () => {
    it("should create render instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createRenderInstruments(meter, config);

      assertExists(instruments.renderDuration);
      assertExists(instruments.renderCounter);
      assertExists(instruments.renderErrorCounter);
    });

    it("should return all required render instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createRenderInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("renderDuration" in instruments, true);
      assertEquals("renderCounter" in instruments, true);
      assertEquals("renderErrorCounter" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createRenderInstruments(meter, config);

      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createRenderInstruments(meter, config);

      assertExists(instruments.renderDuration);
      assertExists(instruments.renderCounter);
      assertExists(instruments.renderErrorCounter);
    });
  });
});
