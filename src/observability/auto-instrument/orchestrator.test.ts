import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  initAutoInstrumentation,
  isAutoInstrumentEnabled,
  __resetAutoInstrumentForTests,
} from "./orchestrator.ts";

describe("orchestrator", () => {
  beforeEach(() => {
    // Reset state before each test
    __resetAutoInstrumentForTests();
  });

  describe("initAutoInstrumentation", () => {
    it("should initialize successfully with default config", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize successfully with custom config", async () => {
      await initAutoInstrumentation({
        instrumentHttp: true,
        instrumentFetch: false,
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should not reinitialize if already initialized", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);

      // Second call should not throw and should skip initialization
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle empty config object", async () => {
      await initAutoInstrumentation({});
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle config with tracing enabled", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          serviceName: "test-service",
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle config with metrics enabled", async () => {
      await initAutoInstrumentation({
        metrics: {
          enabled: true,
          prefix: "test",
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle config with both tracing and metrics enabled", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          serviceName: "test-service",
        },
        metrics: {
          enabled: true,
          prefix: "test",
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle config with tracing disabled", async () => {
      await initAutoInstrumentation({
        tracing: {
          enabled: false,
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle config with metrics disabled", async () => {
      await initAutoInstrumentation({
        metrics: {
          enabled: false,
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should handle initialization errors gracefully", async () => {
      // Should not throw even if there are internal errors
      await initAutoInstrumentation({
        tracing: {
          enabled: true,
          // Invalid config might cause errors, but should be caught
        },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });

  describe("isAutoInstrumentEnabled", () => {
    it("should return false before initialization", () => {
      assertEquals(isAutoInstrumentEnabled(), false);
    });

    it("should return true after initialization", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should remain true after multiple calls", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });

  describe("__resetAutoInstrumentForTests", () => {
    it("should reset initialization state", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);

      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);
    });

    it("should allow reinitialization after reset", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);

      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);

      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should be safe to call when not initialized", () => {
      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);
    });

    it("should be safe to call multiple times", () => {
      __resetAutoInstrumentForTests();
      __resetAutoInstrumentForTests();
      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);
    });
  });
});
