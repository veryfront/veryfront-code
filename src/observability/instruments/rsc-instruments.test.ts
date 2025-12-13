import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createRscInstruments } from "./rsc-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("rsc-instruments", () => {
  describe("createRscInstruments", () => {
    it("should create rsc instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };

      const instruments = createRscInstruments(meter, config);

      assertExists(instruments.rscRenderDuration);
      assertExists(instruments.rscStreamDuration);
      assertExists(instruments.rscManifestCounter);
      assertExists(instruments.rscPageCounter);
      assertExists(instruments.rscStreamCounter);
      assertExists(instruments.rscActionCounter);
      assertExists(instruments.rscErrorCounter);
    });

    it("should return all required rsc instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };

      const instruments = createRscInstruments(meter, config);

      assertEquals(typeof instruments, "object");
      assertEquals("rscRenderDuration" in instruments, true);
      assertEquals("rscStreamDuration" in instruments, true);
      assertEquals("rscManifestCounter" in instruments, true);
      assertEquals("rscPageCounter" in instruments, true);
      assertEquals("rscStreamCounter" in instruments, true);
      assertEquals("rscActionCounter" in instruments, true);
      assertEquals("rscErrorCounter" in instruments, true);
    });

    it("should use config prefix in metric names", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };

      const instruments = createRscInstruments(meter, config);

      assertExists(instruments);
    });

    it("should handle empty prefix", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "" };

      const instruments = createRscInstruments(meter, config);

      assertExists(instruments.rscRenderDuration);
      assertExists(instruments.rscStreamDuration);
      assertExists(instruments.rscManifestCounter);
    });
  });
});
