import { assertEquals } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetAutoInstrumentForTests,
  initAutoInstrumentation,
  isAutoInstrumentEnabled,
} from "./orchestrator.ts";

describe("observability/auto-instrument/orchestrator", () => {
  beforeEach(() => {
    __resetAutoInstrumentForTests();
  });

  describe("isAutoInstrumentEnabled", () => {
    it("should return false before initialization", () => {
      assertEquals(isAutoInstrumentEnabled(), false);
    });

    it("should return true after initialization", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });

  describe("initAutoInstrumentation", () => {
    it("should initialize with default config", async () => {
      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize with empty config", async () => {
      await initAutoInstrumentation({});
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize with tracing disabled", async () => {
      await initAutoInstrumentation({
        tracing: { enabled: false },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize with metrics disabled", async () => {
      await initAutoInstrumentation({
        metrics: { enabled: false },
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize with all options", async () => {
      await initAutoInstrumentation({
        tracing: { enabled: false, exporter: "console" },
        metrics: { enabled: false, exporter: "console" },
        instrumentHttp: true,
        instrumentFetch: true,
        instrumentReact: true,
        captureErrors: true,
      });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should not reinitialize if already initialized", async () => {
      await initAutoInstrumentation({
        tracing: { enabled: false },
      });
      assertEquals(isAutoInstrumentEnabled(), true);

      // Second call should be a no-op
      await initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
      });
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

    it("should allow re-initialization after reset", async () => {
      await initAutoInstrumentation();
      __resetAutoInstrumentForTests();
      assertEquals(isAutoInstrumentEnabled(), false);

      await initAutoInstrumentation();
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });
});
