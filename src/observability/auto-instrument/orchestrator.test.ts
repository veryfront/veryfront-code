import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetAutoInstrumentForTests,
  initAutoInstrumentation,
  isAutoInstrumentEnabled,
} from "./orchestrator.ts";
import { getTracingState, shutdownTracing } from "../tracing/index.ts";

describe("observability/auto-instrument/orchestrator", () => {
  beforeEach(() => {
    __resetAutoInstrumentForTests();
    shutdownTracing();
  });

  afterEach(() => {
    shutdownTracing();
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
      await initAutoInstrumentation({ tracing: { enabled: false } });
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("should initialize with metrics disabled", async () => {
      await initAutoInstrumentation({ metrics: { enabled: false } });
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

    it("should start the tracing runtime when tracing is enabled", async () => {
      await initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
        metrics: { enabled: false },
      });

      assertEquals(
        getTracingState().initialized,
        true,
        "enabled tracing config must reach initTracing",
      );
    });

    it("should leave the tracing runtime down when tracing is disabled", async () => {
      await initAutoInstrumentation({ tracing: { enabled: false } });

      assertEquals(
        getTracingState().initialized,
        false,
        "disabled tracing config must not start the tracer",
      );
    });

    it("should not reinitialize if already initialized", async () => {
      await initAutoInstrumentation({ tracing: { enabled: false } });
      assertEquals(isAutoInstrumentEnabled(), true);
      shutdownTracing();
      assertEquals(
        getTracingState().initialized,
        false,
        "precondition: the tracing runtime is down",
      );

      await initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
      });

      assertEquals(
        getTracingState().initialized,
        false,
        "a duplicate initAutoInstrumentation must not start tracing",
      );
      assertEquals(isAutoInstrumentEnabled(), true);
    });

    it("shares one readiness promise across concurrent initialization", async () => {
      const first = initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
      });
      const second = initAutoInstrumentation({
        tracing: { enabled: false },
      });

      assertStrictEquals(second, first);
      await first;
      assertEquals(isAutoInstrumentEnabled(), true);
    });
  });

  describe("__resetAutoInstrumentForTests", () => {
    it("prevents an in-flight initialization from restoring stale state", async () => {
      const initializing = initAutoInstrumentation({
        tracing: { enabled: true, exporter: "console" },
      });
      __resetAutoInstrumentForTests();

      await initializing;

      assertEquals(isAutoInstrumentEnabled(), false);
    });

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
