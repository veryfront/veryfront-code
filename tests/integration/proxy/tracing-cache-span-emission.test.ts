import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type Span,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  _resetOTLPForTests,
  initializeOTLPWithApis,
  shutdownOTLP,
} from "#veryfront/proxy/tracing.ts";
import { TracingTokenCache } from "#veryfront/proxy/cache/tracing-cache.ts";
import type { CacheStats, TokenCache, TokenCacheEntry } from "#veryfront/proxy/cache/types.ts";

/**
 * Relocated from src/proxy/cache/tracing-cache.test.ts: the proxy's withSpan()
 * is a pass-through until initializeOTLPWithApis() caches a tracer, and that
 * initialization is gated on OTEL_* process environment with no config seam to
 * inject. Mutating the environment is a process effect the semantic
 * unit-boundary audit rejects in a colocated unit test, so the span-emission
 * cases live here. The hermetic delegation cases stay in the unit file.
 */

interface CallRecord {
  method: string;
  args: unknown[];
}

class FakeCache implements TokenCache {
  readonly calls: CallRecord[] = [];
  entry: TokenCacheEntry | null = null;
  hasResult = false;
  statsResult: CacheStats = { hits: 0, misses: 0, size: 0, type: "extension" };

  get(key: string): Promise<TokenCacheEntry | null> {
    this.calls.push({ method: "get", args: [key] });
    return Promise.resolve(this.entry);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.calls.push({ method: "set", args: [key, entry] });
    this.entry = entry;
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.calls.push({ method: "delete", args: [key] });
    this.entry = null;
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.calls.push({ method: "clear", args: [] });
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    this.calls.push({ method: "has", args: [key] });
    return Promise.resolve(this.hasResult);
  }

  stats(): Promise<CacheStats> {
    this.calls.push({ method: "stats", args: [] });
    return Promise.resolve(this.statsResult);
  }

  close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
    return Promise.resolve();
  }
}

function makeEntry(token: string): TokenCacheEntry {
  return { token, expiresAt: Date.now() + 60_000, scope: "production" };
}

describe("TracingTokenCache span emission", () => {
  const OTEL_ENV_KEYS = [
    "OTEL_TRACES_ENABLED",
    "OTEL_SERVICE_NAME",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  ] as const;
  const savedEnv = new Map<string, string | undefined>();
  let spanNames: string[] = [];

  function createRecordingSpan(): Span {
    const span: Span = {
      setAttribute: () => span,
      setAttributes: () => span,
      setStatus: () => span,
      recordException: () => {},
      addEvent: () => span,
      end: () => {},
      spanContext: () => ({
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
      }),
      updateName: () => {},
    } as unknown as Span;
    return span;
  }

  function createRecordingExporter(): TracingExporter {
    const tracer: Tracer = {
      startSpan: (name: string) => {
        spanNames.push(name);
        return createRecordingSpan();
      },
      startActiveSpan: ((name: string, ...rest: unknown[]) => {
        spanNames.push(name);
        const fn = rest.find((arg) => typeof arg === "function") as
          | ((span: Span) => unknown)
          | undefined;
        return fn?.(createRecordingSpan());
      }) as Tracer["startActiveSpan"],
    };
    return {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => ({ getTracer: () => tracer }),
      getMetricsAPI: () => null,
      getTraceAPI: () => null,
    };
  }

  beforeEach(async () => {
    for (const key of OTEL_ENV_KEYS) savedEnv.set(key, Deno.env.get(key));
    _resetOTLPForTests();
    _resetShimForTests();
    spanNames = [];
    Deno.env.set("OTEL_TRACES_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:9");
    Deno.env.delete("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
    const exporter = createRecordingExporter();
    await initializeOTLPWithApis(() => Promise.resolve(exporter));
  });

  afterEach(async () => {
    await shutdownOTLP();
    _resetOTLPForTests();
    _resetShimForTests();
    for (const [key, value] of savedEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });

  it("emits one prefixed span for every public method", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake);

    await traced.get("key");
    await traced.set("key", makeEntry("t-span"));
    await traced.delete("key");
    await traced.clear();
    await traced.has("key");
    await traced.stats();
    await traced.close();

    assertEquals(
      spanNames,
      [
        "cache.extension.get",
        "cache.extension.set",
        "cache.extension.delete",
        "cache.extension.clear",
        "cache.extension.has",
        "cache.extension.stats",
        "cache.extension.close",
      ],
      "every public method must emit its prefixed span",
    );
  });

  it("names the emitted span with the configured spanPrefix", async () => {
    const fake = new FakeCache();
    const traced = new TracingTokenCache(fake, { spanPrefix: "cache.custom" });

    await traced.get("key");

    assertEquals(spanNames, ["cache.custom.get"], "spanPrefix must name the emitted span");
    await traced.close();
  });
});
