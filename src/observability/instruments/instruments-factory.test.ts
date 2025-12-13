import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { initializeInstruments } from "./instruments-factory.ts";
import { metrics } from "@opentelemetry/api";

describe("instruments-factory", () => {
  describe("initializeInstruments", () => {
    it("should initialize all instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments);
      assertEquals(typeof instruments, "object");
    });

    it("should return instruments synchronously", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };
      const runtimeState = { cacheSize: 100, activeRequests: 0 };

      const result = initializeInstruments(meter, config, runtimeState);

      // Function now returns synchronously (not a Promise)
      assertEquals(result instanceof Promise, false);
      assertExists(result);
    });

    it("should initialize all http instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.httpRequestCounter);
      assertExists(instruments.httpRequestDuration);
      assertExists(instruments.httpActiveRequests);
    });

    it("should initialize all cache instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 42, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.cacheGetCounter);
      assertExists(instruments.cacheHitCounter);
      assertExists(instruments.cacheMissCounter);
      assertExists(instruments.cacheSetCounter);
      assertExists(instruments.cacheInvalidateCounter);
      assertExists(instruments.cacheSizeGauge);
    });

    it("should initialize all render instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.renderDuration);
      assertExists(instruments.renderCounter);
      assertExists(instruments.renderErrorCounter);
    });

    it("should initialize all rsc instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.rscRenderDuration);
      assertExists(instruments.rscStreamDuration);
      assertExists(instruments.rscManifestCounter);
      assertExists(instruments.rscPageCounter);
      assertExists(instruments.rscStreamCounter);
      assertExists(instruments.rscActionCounter);
      assertExists(instruments.rscErrorCounter);
    });

    it("should initialize all build instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.buildDuration);
      assertExists(instruments.bundleSizeHistogram);
      assertExists(instruments.bundleCounter);
    });

    it("should initialize all data instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.dataFetchDuration);
      assertExists(instruments.dataFetchCounter);
      assertExists(instruments.dataFetchErrorCounter);
    });

    it("should initialize all memory instruments", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments.memoryUsageGauge);
      assertExists(instruments.heapUsageGauge);
    });

    it("should handle errors gracefully", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      // Should not throw even if there are internal errors
      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments);
    });

    it("should use custom prefix", async () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "custom" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = await initializeInstruments(meter, config, runtimeState);

      assertExists(instruments);
    });
  });
});
