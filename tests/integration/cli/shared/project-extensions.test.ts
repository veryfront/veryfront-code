import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  releaseProjectCliExtensions,
  setupProjectCliExtensions,
} from "../../../../cli/shared/project-extensions.ts";
import { mergeExtensions } from "#veryfront/extensions/discovery.ts";
import type { Extension, ExtensionLoader } from "veryfront/extensions";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  getGlobalTelemetryAPISnapshot,
  installGlobalTelemetryAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  __registerLogRecordEmitter,
  logger,
  LogLevel,
  refreshLoggerConfig,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";

const discovery = {
  discoverPackageExtensions: () => Promise.resolve([]),
  discoverProjectExtensions: () => Promise.resolve([]),
  discoverLocalExtensions: () => Promise.resolve([]),
  mergeExtensions,
};
const extensionLogger = { debug() {}, info() {}, warn() {}, error() {} };
const loaders = new Set<ExtensionLoader>();

async function setup(extensions: Extension[] = []): Promise<ExtensionLoader> {
  const loader = await setupProjectCliExtensions({
    projectDir: "/synthetic-cli-project",
    config: { extensions },
    logger: extensionLogger,
    discovery,
  });
  loaders.add(loader);
  return loader;
}

function tracingFixture(options: { wiringError?: Error; cleanupError?: Error } = {}) {
  const emitted: string[] = [];
  const provider = { getTracer: () => ({}) };
  const metricsApi = { getMeter: () => ({}) };
  const contextApi = { active: () => ({}), with: <T>(_ctx: unknown, fn: () => T): T => fn() };
  const traceApi = {
    getActiveSpan: () => null,
    getSpan: () => null,
    setSpan: (ctx: unknown) => ctx,
  };
  const propagator = { inject() {}, extract: (ctx: unknown) => ctx, fields: () => [] };
  let teardowns = 0;
  const exporter: TracingExporter = {
    start: () => Promise.resolve(),
    export: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
    getProvider: () => provider,
    getMetricsAPI: () => metricsApi,
    getContextAPI: () => contextApi,
    getTraceAPI: () => traceApi,
    getPropagator: () => propagator,
    getLogRecordEmitter: () => {
      // A late getter failure catches partial installation, not just a failure
      // before any provider fields could have been installed.
      if (options.wiringError) throw options.wiringError;
      return (record) => emitted.push(record.message);
    },
  };
  const extension: Extension = {
    name: "synthetic-telemetry",
    version: "1.0.0",
    capabilities: [],
    contracts: { provides: ["TracingExporter"] },
    setup(ctx) {
      ctx.provide("TracingExporter", exporter);
    },
    teardown() {
      teardowns++;
      if (options.cleanupError && teardowns === 1) throw options.cleanupError;
    },
  };
  return {
    emitted,
    extension,
    provider,
    metricsApi,
    contextApi,
    traceApi,
    propagator,
    teardowns: () => teardowns,
  };
}

describe("CLI extension telemetry ownership", () => {
  afterEach(async () => {
    for (const loader of loaders) await releaseProjectCliExtensions(loader);
    loaders.clear();
    installGlobalTelemetryAPI({}).dispose();
    __registerLogRecordEmitter(null);
    refreshLoggerConfig();
  });

  it("releases the complete telemetry facade and starts the next command without stale exporters", async () => {
    setLogLevel(LogLevel.INFO);
    const fixture = tracingFixture();
    const loader = await setup([fixture.extension]);
    const installed = getGlobalTelemetryAPISnapshot();
    assertStrictEquals<unknown>(installed.tracerProvider, fixture.provider);
    assertStrictEquals<unknown>(installed.metricsApi, fixture.metricsApi);
    assertStrictEquals<unknown>(installed.contextAccessor, fixture.contextApi);
    assertStrictEquals<unknown>(installed.activeSpanAccessor, fixture.traceApi);
    assertStrictEquals<unknown>(installed.propagator, fixture.propagator);
    logger.info("before CLI release");
    assertEquals(fixture.emitted, ["before CLI release"]);

    await releaseProjectCliExtensions(loader);
    assertEquals(fixture.teardowns(), 1);
    const released = getGlobalTelemetryAPISnapshot();
    assertEquals(released.tracerProviderInstalled, false);
    assertEquals(released.metricsApi, null);
    assertEquals(released.contextAccessor, null);
    assertEquals(released.activeSpanAccessor, null);
    assertEquals(released.propagator, null);
    logger.info("after CLI release");
    assertEquals(fixture.emitted, ["before CLI release"], "released emitters must receive no logs");

    await setup();
    assertEquals(getGlobalTelemetryAPISnapshot().tracerProviderInstalled, false);
    logger.info("next command without telemetry");
    assertEquals(fixture.emitted, ["before CLI release"]);
  });

  it("does not let an older command release a newer provider or log emitter", async () => {
    setLogLevel(LogLevel.INFO);
    const older = tracingFixture();
    const oldLoader = await setup([older.extension]);
    const newer = tracingFixture();
    await setup([newer.extension]);
    await releaseProjectCliExtensions(oldLoader);

    assertStrictEquals<unknown>(getGlobalTelemetryAPISnapshot().tracerProvider, newer.provider);
    assertStrictEquals<unknown>(getGlobalTelemetryAPISnapshot().metricsApi, newer.metricsApi);
    logger.info("new command retains its emitter");
    assertEquals(older.emitted, []);
    assertEquals(newer.emitted, ["new command retains its emitter"]);
  });

  it("tears down initialized extensions when a late wiring getter fails without partial installation", async () => {
    const prior = installGlobalTelemetryAPI({});
    const before = getGlobalTelemetryAPISnapshot();
    const wiringError = new Error("synthetic wiring failure");
    const fixture = tracingFixture({ wiringError });
    const failure = await setup([fixture.extension]).then(() => undefined, (error) => error);

    assertStrictEquals(failure, wiringError, "startup must retain the original wiring failure");
    assertEquals(
      fixture.teardowns(),
      1,
      "the caller never receives the loader, so setup cleans up",
    );
    assertEquals(
      getGlobalTelemetryAPISnapshot(),
      before,
      "a getter must not install partial state",
    );
    prior.dispose();
  });

  it("preserves a wiring error even when its cleanup also fails", async () => {
    const wiringError = new Error("primary wiring failure");
    const fixture = tracingFixture({ wiringError, cleanupError: new Error("cleanup failure") });
    const failure = await setup([fixture.extension]).then(() => undefined, (error) => error);

    assertStrictEquals(failure, wiringError);
    assertEquals(fixture.teardowns(), 1);
    // The loader retains failed teardown hooks for a safe retry before another
    // generation starts. Let that recovery finish so this test leaves no owner.
    await setup();
    assertEquals(fixture.teardowns(), 2);
  });

  it("clears owned telemetry even if teardown reports a collector failure", async () => {
    const fixture = tracingFixture({ cleanupError: new Error("collector rejected the flush") });
    const loader = await setup([fixture.extension]);
    await releaseProjectCliExtensions(loader);
    assertEquals(fixture.teardowns(), 1);
    assertEquals(getGlobalTelemetryAPISnapshot().tracerProviderInstalled, false);
    assertEquals(getGlobalTelemetryAPISnapshot().metricsApi, null);
    await setup();
    assertEquals(fixture.teardowns(), 2);
  });
});
