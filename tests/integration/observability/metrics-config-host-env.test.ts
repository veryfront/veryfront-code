import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { loadConfig } from "#veryfront/observability/metrics/config.ts";

type RuntimeAdapter = import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;

function adapterWithEnv(env: { get: (key: string) => string | undefined }): RuntimeAdapter {
  return { env } as unknown as RuntimeAdapter;
}

const HOST_OTEL_ENV: Record<string, string> = {
  VERYFRONT_OTEL: "1",
  OTEL_METRICS_ENABLED: "true",
  OTEL_METRICS_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://host.example/otlp",
};

function withHostEnv<T>(values: Record<string, string>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Deno.env.get(name));
    Deno.env.set(name, value);
  }
  try {
    return fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
}

describe("observability/metrics config host environment", () => {
  it("applies the host environment when no adapter is supplied", () => {
    const result = withHostEnv(HOST_OTEL_ENV, () => loadConfig({ prefix: "configured" }));

    assertEquals(result.enabled, true, "host OTEL_METRICS_ENABLED applies without an adapter");
    assertEquals(
      result.exporter,
      "otlp",
      "host OTEL_METRICS_EXPORTER applies without an adapter",
    );
    assertEquals(
      result.endpoint,
      "https://host.example/otlp",
      "host OTLP endpoint applies without an adapter",
    );
    assertEquals(result.prefix, "configured", "caller config is preserved");
  });

  it("does not fall through to the host environment when the adapter environment throws", () => {
    const result = withHostEnv(HOST_OTEL_ENV, () =>
      loadConfig(
        { enabled: false, prefix: "configured" },
        adapterWithEnv({
          get() {
            throw new Error("environment unavailable");
          },
        }),
      ));

    assertEquals(
      result.enabled,
      false,
      "adapter env failure must not fall through to the host OTEL flags",
    );
    assertEquals(result.exporter, "console", "host OTEL_METRICS_EXPORTER must not leak in");
    assertEquals(result.endpoint, undefined, "host OTLP endpoint must not leak in");
    assertEquals(result.prefix, "configured", "caller config is preserved");
  });
});
