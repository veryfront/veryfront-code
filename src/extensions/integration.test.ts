/**
 * Integration tests for the veryfront extension system.
 *
 * Exercises the end-to-end flow: load → resolve → use.
 *
 * @module extensions/integration.test
 */

import { assert, assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { detectConflicts, ExtensionLoader, resolve, tryResolve } from "./index.ts";
import type { Extension, ResolvedExtension } from "./index.ts";
import { register, reset } from "./contracts.ts";
import { AIProviderRegistryName } from "./interfaces/index.ts";
import type { AIProviderRegistry } from "./interfaces/index.ts";
import { createAIProviderRegistry } from "./registries/ai-provider-registry.ts";
import extOpenAI from "../../extensions/ext-openai/src/index.ts";
import extAnthropic from "../../extensions/ext-anthropic/src/index.ts";
import {
  _resetShimForTests,
  getTracer,
  setGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { TracingExporter } from "./interfaces/tracing-exporter.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeExt(name: string, overrides: Partial<Extension> = {}): Extension {
  return { name, version: "1.0.0", capabilities: [], ...overrides };
}

function makeResolved(
  ext: Extension,
  source: "config" | "package" | "project" | "local-file" = "config",
): ResolvedExtension {
  return { extension: ext, source, origin: ext.name };
}

describe("extensions/integration", () => {
  afterEach(() => {
    reset();
  });

  it("load extension → resolve contract → use it", async () => {
    const store = new Map<string, unknown>();
    const cacheExt = makeExt("cache-map", {
      provides: {
        CacheStore: {
          get: (k: string) => store.get(k),
          set: (k: string, v: unknown) => store.set(k, v),
        },
      },
    });

    const loader = new ExtensionLoader(noopLogger);
    await loader.setupAll([makeResolved(cacheExt)], {});

    const cache = resolve<{ get(k: string): unknown; set(k: string, v: unknown): void }>(
      "CacheStore",
    );
    cache.set("key", 42);
    assertEquals(cache.get("key"), 42);

    await loader.teardownAll();
  });

  it("resolve() throws for missing contract", () => {
    assertThrows(
      () => resolve("Nonexistent"),
      Error,
      "Missing extension for contract",
    );
  });

  it("dependency ordering via topologicalSort + setupAll", async () => {
    const order: string[] = [];

    const provider = makeExt("db-provider", {
      provides: { DatabaseClient: { query: () => [] } },
      setup: () => {
        order.push("db-provider");
      },
    });

    const consumer = makeExt("repo-layer", {
      capabilities: [{ type: "contract", name: "DatabaseClient" }],
      setup: () => {
        order.push("repo-layer");
      },
    });

    const loader = new ExtensionLoader(noopLogger);
    const sorted = loader.topologicalSort([
      makeResolved(consumer),
      makeResolved(provider),
    ]);

    await loader.setupAll(sorted, {});
    assertEquals(order, ["db-provider", "repo-layer"]);

    await loader.teardownAll();
  });

  it("preset flattening", () => {
    const child1 = makeExt("child1");
    const child2 = makeExt("child2");
    const preset = makeExt("my-preset", { extends: [child1, child2] });

    const loader = new ExtensionLoader(noopLogger);
    const flat = loader.flattenPresets([makeResolved(preset)]);

    assertEquals(flat.length, 2);
    assertEquals(flat[0]?.extension.name, "child1");
    assertEquals(flat[1]?.extension.name, "child2");
  });

  it("conflict detection", () => {
    const extA = makeExt("ext-a", { provides: { CacheStore: {} } });
    const extB = makeExt("ext-b", { provides: { CacheStore: {} } });

    const conflicts = detectConflicts([
      makeResolved(extA, "config"),
      makeResolved(extB, "config"),
    ]);

    assertEquals(conflicts.length, 1);
    assertEquals(conflicts[0]?.contract, "CacheStore");
    assertEquals(conflicts[0]?.providers.length, 2);
  });

  it("reverse teardown order", async () => {
    const order: string[] = [];

    const a = makeExt("ext-a", {
      setup: () => {
        register("A", true);
      },
      teardown: () => {
        order.push("a");
      },
    });

    const b = makeExt("ext-b", {
      setup: () => {
        register("B", true);
      },
      teardown: () => {
        order.push("b");
      },
    });

    const c = makeExt("ext-c", {
      teardown: () => {
        order.push("c");
      },
    });

    const loader = new ExtensionLoader(noopLogger);
    await loader.setupAll(
      [makeResolved(a), makeResolved(b), makeResolved(c)],
      {},
    );
    await loader.teardownAll();

    assertEquals(order, ["c", "b", "a"]);
  });

  it("ext-openai registers into the primed AIProviderRegistry", async () => {
    const registry = createAIProviderRegistry();
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ [AIProviderRegistryName]: registry });
    await loader.setupAll(
      [
        {
          source: "local-file",
          origin: "virtual://ext-openai",
          extension: extOpenAI(),
        } satisfies ResolvedExtension,
      ],
      {},
    );
    const resolved = resolve<AIProviderRegistry>(AIProviderRegistryName);
    assertEquals(resolved, registry);
    assert(registry.has("openai"));
    await loader.teardownAll();
  });

  it("ext-opentelemetry: TracingExporter registers and returns a real tracer", async () => {
    _resetShimForTests();

    let shimProvider: { getTracer(name: string): unknown } | null = null;

    const noopSpan = {
      setAttribute: () => noopSpan,
      setAttributes: () => noopSpan,
      setStatus: () => noopSpan,
      recordException: () => {},
      addEvent: () => noopSpan,
      end: () => {},
      spanContext: () => ({ traceId: "aabbcc", spanId: "112233", traceFlags: 1 }),
      updateName: () => {},
    };

    const testProvider = {
      getTracer: (name: string) => ({
        startSpan: () => noopSpan,
        startActiveSpan: (_: string, fn: (s: typeof noopSpan) => unknown) => fn(noopSpan),
        _name: name,
      }),
    };

    const exporterStub: TracingExporter = {
      async start(_cfg: Record<string, unknown>) {
        shimProvider = testProvider;
        setGlobalTracerProvider(testProvider);
      },
      async export(_spans) {},
      async shutdown() {
        shimProvider = null;
      },
      getProvider() {
        return testProvider;
      },
      getMetricsAPI() {
        return null;
      },
    };

    const otelExt = makeExt("ext-opentelemetry", {
      provides: { TracingExporter: exporterStub },
      async setup(ctx) {
        await exporterStub.start(ctx.config);
        ctx.provide("TracingExporter", exporterStub);
      },
      async teardown() {
        await exporterStub.shutdown();
      },
    });

    const loader = new ExtensionLoader(noopLogger);
    await loader.setupAll([makeResolved(otelExt)], {});

    const tracing = tryResolve<TracingExporter>("TracingExporter");
    assertExists(tracing);
    setGlobalTracerProvider(tracing.getProvider() as Parameters<typeof setGlobalTracerProvider>[0]);

    const tracer = getTracer("test-service");
    assertExists(tracer);
    assertEquals((tracer as unknown as { _name?: string })._name, "test-service");

    assertExists(shimProvider);

    await loader.teardownAll();
    _resetShimForTests();
  });

  it("ext-anthropic registers into the primed AIProviderRegistry", async () => {
    const registry = createAIProviderRegistry();
    const loader = new ExtensionLoader(noopLogger);
    loader.primeContracts({ [AIProviderRegistryName]: registry });
    await loader.setupAll(
      [
        {
          source: "local-file",
          origin: "virtual://ext-anthropic",
          extension: extAnthropic(),
        } satisfies ResolvedExtension,
      ],
      {},
    );
    const resolved = resolve<AIProviderRegistry>(AIProviderRegistryName);
    assertEquals(resolved, registry);
    assert(registry.has("anthropic"));
    await loader.teardownAll();
  });
});
