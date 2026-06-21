# Veryfront OTel Multi-Tenant Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Veryfront telemetry safe and explicit for multi-tenant shared runtimes while preserving dedicated-runtime BYO OpenTelemetry.

**Architecture:** Shared Veryfront runtimes must treat telemetry exporter configuration as host-owned process configuration, never as per-project request configuration. Project code can still produce request spans through framework instrumentation, but shared runtime export endpoints, headers, service names, and sampling policy are controlled by the platform process. Dedicated runtimes can still use project/deployment env vars because they run in their own process boundary.

**Tech Stack:** Deno, TypeScript, Veryfront runtime, OpenTelemetry JS SDK, Vitest in `veryfront-api` and `veryfront-studio`, Deno tests in `veryfront-code`.

---

## File Structure

- Modify `src/observability/tracing/otlp-setup.ts`: read framework OTel export config from host env only.
- Modify `src/proxy/tracing.ts`: read proxy OTel export config from host env only.
- Create `src/observability/tracing/telemetry-env.ts`: one small helper for host-owned telemetry env reads and reserved key detection.
- Create `src/observability/tracing/telemetry-env.test.ts`: regression tests for host-only OTel config reads under project env overlays.
- Modify `src/config/environment-config.ts`: add host-owned `proxyMode` and resolve OTel framework settings from host env only.
- Modify `src/config/environment-config.test.ts`: add the new `proxyMode` field to environment shape coverage.
- Modify `src/config/env.test.ts`: add `proxyMode` to the test `EnvironmentConfig` fixture.
- Modify `src/config/runtime-config.ts`: in shared/proxy mode, ignore `veryfront.config.ts` observability exporter endpoints and service names.
- Modify `src/observability/metrics/config.ts`: resolve framework OTel metrics settings from host env only when no explicit adapter env is passed.
- Create `src/server/project-env/reserved-env.ts`: shared-runtime filtering for reserved framework telemetry env keys.
- Create `src/server/project-env/reserved-env.test.ts`: filtering tests.
- Modify `src/server/runtime-handler/index.ts`: filter reserved telemetry env keys before `runWithProjectEnv`.
- Modify `src/server/handlers/request/agent-stream.handler.ts`: apply the same reserved telemetry env filtering to internal agent-stream project env overlays.
- Modify `extensions/ext-observability-opentelemetry/src/index.ts`: add real OTLP metrics export behind host-owned metrics env.
- Modify `extensions/ext-observability-opentelemetry/deno.json`: add OpenTelemetry metrics SDK/exporter dependencies and metrics env capabilities.
- Modify `extensions/ext-observability-opentelemetry/README.md`: document trace and metric env behavior, and remove `ctx.config.otel` exporter routing as a supported shared-runtime control path.
- Create or modify `extensions/ext-observability-opentelemetry/src/index.test.ts`: regression tests for trace-only, metrics-only, and combined trace/metric startup.
- Modify `docs/guides/evals.md`: document eval report exports as explicit vendor data exports, not regular runtime telemetry.
- Modify `extensions/ext-eval-report-http/README.md`: clarify Langfuse, LangSmith, Braintrust, and gateway integration boundaries.
- Modify `.env.example`: document shared-runtime host-owned OTel env and dedicated-runtime BYO OTel.
- Modify `docs/architecture/13-observability.md`: document multi-tenant telemetry model and invariants.
- Modify `docs/guides/configuration.md`: clarify which env vars are platform-owned in shared runtime.
- In `../veryfront-api`: add or update observability docs/tests only if the existing project-scoped Tempo/Loki tests do not cover the invariant.
- In `../veryfront-api`: explicitly verify or implement OTLP metric export for existing API metric instruments.
- In `../veryfront-studio`: update env documentation and explicitly verify or implement server-side OTLP metric export; Studio already proxies project trace/log reads through API.

---

### Task 1: Add a Host-Owned Telemetry Env Helper

**Files:**
- Create: `src/observability/tracing/telemetry-env.ts`
- Test: `src/observability/tracing/telemetry-env.test.ts`

- [x] **Step 1: Write the failing test**

Create `src/observability/tracing/telemetry-env.test.ts`:

```ts
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withEnv } from "#veryfront/testing/deno-compat";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import {
  getHostTelemetryEnv,
  isReservedSharedRuntimeTelemetryEnvKey,
} from "./telemetry-env.ts";

describe("observability/tracing/telemetry-env", () => {
  it("reads OTel exporter settings from host env instead of project env", async () => {
    await withEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic platform-token",
      OTEL_SERVICE_NAME: "veryfront-server",
      OTEL_TRACES_ENABLED: "true",
    }, async () => {
      runWithProjectEnv({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
        OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic tenant-token",
        OTEL_SERVICE_NAME: "tenant-service",
        OTEL_TRACES_ENABLED: "false",
      }, () => {
        assertEquals(
          getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
          "https://platform-collector.example/otlp",
        );
        assertEquals(
          getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS"),
          "Authorization=Basic platform-token",
        );
        assertEquals(getHostTelemetryEnv("OTEL_SERVICE_NAME"), "veryfront-server");
        assertEquals(getHostTelemetryEnv("OTEL_TRACES_ENABLED"), "true");
      });
    });
  });

  it("classifies shared-runtime telemetry routing keys as reserved", () => {
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_EXPORTER_OTLP_ENDPOINT"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_EXPORTER_OTLP_HEADERS"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_SERVICE_NAME"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OTEL_TRACES_ENABLED"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("VERYFRONT_OTEL"), true);
    assertEquals(isReservedSharedRuntimeTelemetryEnvKey("OPENAI_API_KEY"), false);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
deno test --no-check --allow-all src/observability/tracing/telemetry-env.test.ts
```

Expected: FAIL because `src/observability/tracing/telemetry-env.ts` does not exist.

- [x] **Step 3: Add the helper**

Create `src/observability/tracing/telemetry-env.ts`:

```ts
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const RESERVED_SHARED_RUNTIME_TELEMETRY_ENV_KEYS = new Set([
  "VERYFRONT_OTEL",
]);

export function getHostTelemetryEnv(key: string): string | undefined {
  return getHostEnv(key);
}

export function isReservedSharedRuntimeTelemetryEnvKey(key: string): boolean {
  return key.startsWith("OTEL_") || RESERVED_SHARED_RUNTIME_TELEMETRY_ENV_KEYS.has(key);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run:

```bash
deno test --no-check --allow-all src/observability/tracing/telemetry-env.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/observability/tracing/telemetry-env.ts src/observability/tracing/telemetry-env.test.ts
git commit -m "fix: add host-owned telemetry env helper"
```

---

### Task 2: Make Core OTel Config Read Host Env Only

**Files:**
- Modify: `src/observability/tracing/otlp-setup.ts`
- Modify: `src/proxy/tracing.ts`
- Modify: `src/config/environment-config.ts`
- Modify: `src/config/environment-config.test.ts`
- Modify: `src/config/env.test.ts`
- Modify: `src/config/runtime-config.ts`
- Modify: `src/observability/metrics/config.ts`
- Test: `src/observability/tracing/telemetry-env.test.ts`
- Test: `src/config/runtime-config.test.ts`

- [x] **Step 1: Extend the failing test**

Append this test to `src/observability/tracing/telemetry-env.test.ts`:

```ts
import { getEnvironmentConfig, refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";

it("keeps framework OTel environment config host-owned inside project env overlays", async () => {
  await withEnv({
    OTEL_TRACES_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
    OTEL_SERVICE_NAME: "veryfront-server",
  }, async () => {
    runWithProjectEnv({
      OTEL_TRACES_ENABLED: "false",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
      OTEL_SERVICE_NAME: "tenant-service",
    }, () => {
      _resetEnvironmentConfig();
      const config = refreshEnvironmentConfig();
      assertEquals(config.otelEnabled, true);
      assertEquals(config.otelEndpoint, "https://platform-collector.example/otlp");
      assertEquals(config.otelServiceName, "veryfront-server");
    });
    _resetEnvironmentConfig();
    getEnvironmentConfig();
  });
});
```

Append this test to `src/config/runtime-config.test.ts`:

```ts
it("ignores project-file observability routing in shared proxy mode", () => {
  const config = createRuntimeConfig({
    observability: {
      tracing: {
        enabled: true,
        endpoint: "https://tenant-collector.example/otlp",
        serviceName: "tenant-service",
      },
    metrics: {
      enabled: true,
      endpoint: "https://tenant-metrics.example/otlp",
      },
    },
  }, createTestEnvironmentConfig({
    proxyMode: true,
    otelEnabled: false,
    otelMetricsEnabled: false,
  }));

  assertEquals(config.observability?.tracing?.enabled, false);
  assertEquals(config.observability?.tracing?.endpoint, undefined);
  assertEquals(config.observability?.tracing?.serviceName, undefined);
  assertEquals(config.observability?.metrics?.enabled, false);
  assertEquals(config.observability?.metrics?.endpoint, undefined);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
deno test --no-check --allow-all src/observability/tracing/telemetry-env.test.ts src/config/runtime-config.test.ts
```

Expected: FAIL because `environment-config.ts` still reads OTel values through `getEnv`, and `runtime-config.ts` still trusts file-based observability routing in proxy mode.

- [x] **Step 3: Update `otlp-setup.ts`**

Change the import:

```ts
import { getHostTelemetryEnv } from "./telemetry-env.ts";
```

Replace the OTel env reads inside `getConfig()` with:

```ts
return {
  enabled: isTruthyEnvValue(getHostTelemetryEnv("VERYFRONT_OTEL")) ||
    isTruthyEnvValue(getHostTelemetryEnv("OTEL_TRACES_ENABLED")),
  serviceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || "veryfront",
  endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
  headers: parseHeaders(getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS")),
};
```

Remove the unused `getEnv` import from `otlp-setup.ts`.

- [x] **Step 4: Update `src/proxy/tracing.ts`**

Change the import:

```ts
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
```

Remove:

```ts
import { getEnv } from "./env.ts";
```

Replace `getConfig()` with:

```ts
function getConfig(): OTLPConfig {
  return {
    enabled: getHostTelemetryEnv("OTEL_TRACES_ENABLED") === "true",
    serviceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || "veryfront-proxy",
    endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || "",
    headers: parseHeaders(getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS")),
  };
}
```

- [x] **Step 5: Update `environment-config.ts`**

Add:

```ts
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
```

Change the process import so runtime mode can also bypass project env overlays:

```ts
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process.ts";
```

Add this field to `EnvironmentConfig`:

```ts
proxyMode: boolean;
```

Add this field inside `readEnvSnapshot()`:

```ts
proxyMode: getHostEnv("PROXY_MODE") === "1",
```

Replace only the OTel fields in `readEnvSnapshot()`:

```ts
otelEnabled: isTruthyEnvValue(getHostTelemetryEnv("VERYFRONT_OTEL")) ||
  isTruthyEnvValue(getHostTelemetryEnv("OTEL_TRACES_ENABLED")),
otelServiceName: getHostTelemetryEnv("OTEL_SERVICE_NAME") || undefined,
otelEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT") || undefined,
otelTracesEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") || undefined,
otelMetricsEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") || undefined,
otelTracesExporter: getHostTelemetryEnv("OTEL_TRACES_EXPORTER") || undefined,
otelMetricsExporter: getHostTelemetryEnv("OTEL_METRICS_EXPORTER") || undefined,
otelHeaders: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_HEADERS") || undefined,
otelMetricsEnabled: isTruthyEnvValue(getHostTelemetryEnv("OTEL_METRICS_ENABLED")),
```

- [x] **Step 6: Update environment config tests**

In `src/config/environment-config.test.ts`, add `"proxyMode"` to `expectedProps` after `"veryfrontMode"`:

```ts
"veryfrontMode",
"proxyMode",
"debug",
```

In `src/config/env.test.ts`, add `proxyMode: false` to `BASE_MOCK_ENV` after `veryfrontMode`:

```ts
veryfrontMode: "",
proxyMode: false,
debug: false,
```

- [x] **Step 7: Update `runtime-config.ts`**

Add a small helper near `mergeConfigWithEnv()`:

```ts
function mergeObservabilityConfig(
  fileConfig: VeryfrontConfig,
  env: EnvironmentConfig,
): VeryfrontConfig["observability"] {
  if (env.proxyMode) {
    return {
      tracing: {
        enabled: env.otelEnabled,
        endpoint: env.otelEndpoint,
        serviceName: env.otelServiceName,
      },
      metrics: {
        enabled: env.otelMetricsEnabled,
        endpoint: env.otelMetricsEndpoint,
      },
    };
  }

  return {
    tracing: {
      ...fileConfig.observability?.tracing,
      enabled: env.otelEnabled || fileConfig.observability?.tracing?.enabled,
      endpoint: env.otelEndpoint || fileConfig.observability?.tracing?.endpoint,
      serviceName: env.otelServiceName || fileConfig.observability?.tracing?.serviceName,
    },
    metrics: {
      ...fileConfig.observability?.metrics,
      enabled: env.otelMetricsEnabled || fileConfig.observability?.metrics?.enabled,
      endpoint: env.otelMetricsEndpoint || fileConfig.observability?.metrics?.endpoint,
    },
  };
}
```

Replace the inline `observability: { ... }` block in `mergeConfigWithEnv()` with:

```ts
observability: mergeObservabilityConfig(fileConfig, env),
```

This preserves dedicated/local config-file behavior while blocking shared/proxy runtime project config from choosing exporter routing.

- [x] **Step 8: Update `metrics/config.ts`**

Add:

```ts
import { getHostTelemetryEnv } from "#veryfront/observability/tracing/telemetry-env.ts";
```

Replace the no-adapter `getOtelMetricsConfig()` fallback block with direct host telemetry reads:

```ts
applyEnvConfig({
  enabledFlag: getHostTelemetryEnv("OTEL_METRICS_ENABLED"),
  veryfrontFlag: getHostTelemetryEnv("VERYFRONT_OTEL"),
  endpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_ENDPOINT"),
  metricsEndpoint: getHostTelemetryEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"),
  exporter: getHostTelemetryEnv("OTEL_METRICS_EXPORTER"),
});
```

Remove the now-unused `getOtelMetricsConfig` import if it becomes unused.

- [x] **Step 9: Run focused tests**

Run:

```bash
deno test --no-check --allow-all src/observability/tracing/telemetry-env.test.ts src/observability/tracing/config.test.ts src/observability/metrics/config.test.ts src/config/environment-config.test.ts src/config/env.test.ts src/config/runtime-config.test.ts
```

Expected: PASS.

- [x] **Step 10: Commit**

```bash
git add src/observability/tracing/otlp-setup.ts src/proxy/tracing.ts src/config/environment-config.ts src/config/environment-config.test.ts src/config/env.test.ts src/config/runtime-config.ts src/observability/metrics/config.ts src/observability/tracing/telemetry-env.test.ts src/config/runtime-config.test.ts
git commit -m "fix: read framework telemetry config from host env"
```

---

### Task 3: Filter Reserved Telemetry Keys from Shared Runtime Project Env

**Files:**
- Create: `src/server/project-env/reserved-env.ts`
- Create: `src/server/project-env/reserved-env.test.ts`
- Modify: `src/server/runtime-handler/index.ts`
- Modify: `src/server/handlers/request/agent-stream.handler.ts`

- [x] **Step 1: Write the filtering test**

Create `src/server/project-env/reserved-env.test.ts`:

```ts
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { filterSharedRuntimeProjectEnv } from "./reserved-env.ts";

describe("server/project-env/reserved-env", () => {
  it("removes telemetry exporter routing env vars from shared runtime project env", () => {
    const filtered = filterSharedRuntimeProjectEnv({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic tenant-token",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://tenant-logs.example/otlp/v1/logs",
      OTEL_RESOURCE_ATTRIBUTES: "tenant.secret=do-not-export",
      OTEL_SERVICE_NAME: "tenant-service",
      OTEL_TRACES_ENABLED: "true",
      OPENAI_API_KEY: "project-openai-key",
      FEATURE_FLAG: "enabled",
    });

    assertEquals(filtered, {
      OPENAI_API_KEY: "project-openai-key",
      FEATURE_FLAG: "enabled",
    });
  });

  it("returns the original project env values for non-reserved keys", () => {
    assertEquals(filterSharedRuntimeProjectEnv({ DATABASE_URL: "postgres://project-db" }), {
      DATABASE_URL: "postgres://project-db",
    });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
deno test --no-check --allow-all src/server/project-env/reserved-env.test.ts
```

Expected: FAIL because `reserved-env.ts` does not exist.

- [x] **Step 3: Add the filter**

Create `src/server/project-env/reserved-env.ts`:

```ts
import { isReservedSharedRuntimeTelemetryEnvKey } from "#veryfront/observability/tracing/telemetry-env.ts";

export function filterSharedRuntimeProjectEnv(
  vars: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(vars).filter(([key]) => !isReservedSharedRuntimeTelemetryEnvKey(key)),
  );
}
```

- [x] **Step 4: Use the filter in the runtime handler**

In `src/server/runtime-handler/index.ts`, add:

```ts
import { filterSharedRuntimeProjectEnv } from "#veryfront/server/project-env/reserved-env.ts";
```

Replace:

```ts
return runWithProjectEnv(envVarsForRequest, executeRoute);
```

with:

```ts
return runWithProjectEnv(filterSharedRuntimeProjectEnv(envVarsForRequest), executeRoute);
```

- [x] **Step 5: Use the filter in the internal agent-stream handler**

In `src/server/handlers/request/agent-stream.handler.ts`, add:

```ts
import { filterSharedRuntimeProjectEnv } from "#veryfront/server/project-env/reserved-env.ts";
```

Change `buildAgentStreamEnv()` so project env vars are filtered before trusted framework overrides are applied:

```ts
function buildAgentStreamEnv(input: {
  envVars: Record<string, string>;
  proxyToken?: string | null;
  projectSlug?: string | null;
}): Record<string, string> {
  const apiUrl = getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com";
  return {
    ...filterSharedRuntimeProjectEnv(input.envVars),
    // Framework-owned values must override project env to keep request-scoped
    // credentials bound to trusted Veryfront endpoints and the current project.
    ...(input.proxyToken ? { VERYFRONT_API_TOKEN: input.proxyToken } : {}),
    VERYFRONT_API_URL: apiUrl,
    ...(input.projectSlug ? { VERYFRONT_PROJECT_SLUG: input.projectSlug } : {}),
  };
}
```

- [x] **Step 6: Add an agent-stream regression test**

In `src/server/handlers/request/agent-stream.handler.test.ts`, add a test that exercises a remote agent stream request with project env containing `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`, and `OPENAI_API_KEY`.

Assert that the runtime sees:

```ts
{
  OPENAI_API_KEY: "project-openai-key",
  VERYFRONT_API_TOKEN: "trusted-proxy-token",
  VERYFRONT_API_URL: "https://api.veryfront.com",
  VERYFRONT_PROJECT_SLUG: "project-slug",
}
```

and does not see:

```ts
{
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://tenant-collector.example/otlp",
  OTEL_RESOURCE_ATTRIBUTES: "tenant.secret=do-not-export",
}
```

- [x] **Step 7: Run focused tests**

Run:

```bash
deno test --no-check --allow-all src/server/project-env/reserved-env.test.ts src/server/project-env/getenv-integration.test.ts src/server/runtime-handler/tracing.test.ts src/server/handlers/request/agent-stream.handler.test.ts
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src/server/project-env/reserved-env.ts src/server/project-env/reserved-env.test.ts src/server/runtime-handler/index.ts src/server/handlers/request/agent-stream.handler.ts src/server/handlers/request/agent-stream.handler.test.ts
git commit -m "fix: block tenant telemetry routing env in shared runtime"
```

---

### Task 4: Implement OTLP Metrics Export in the OpenTelemetry Extension

**Files:**
- Modify: `extensions/ext-observability-opentelemetry/src/index.ts`
- Modify: `extensions/ext-observability-opentelemetry/deno.json`
- Modify: `extensions/ext-observability-opentelemetry/README.md`
- Create or modify: `extensions/ext-observability-opentelemetry/src/index.test.ts`

Current state: `veryfront-code` has framework metric instruments and metrics configuration, but the OpenTelemetry extension only installs a trace provider and `OTLPTraceExporter`. `getMetricsAPI()` returns the global OTel metrics API, but there is no global `MeterProvider`, `PeriodicExportingMetricReader`, or `OTLPMetricExporter`. This task makes `OTEL_METRICS_ENABLED=true` actually send OTLP metrics.

- [x] **Step 1: Add failing pure config tests**

Create or extend `extensions/ext-observability-opentelemetry/src/index.test.ts` with tests for exported pure helpers. Do not call `start()` in these unit tests just to inspect config: `trace.setGlobalTracerProvider()` and `metrics.setGlobalMeterProvider()` are process-global OTel APIs and are awkward to reset inside one Deno test process.

```ts
import { assertEquals } from "@std/assert";
import {
  resolveOtlpExtensionConfig,
  resolveOtlpSignalUrl,
} from "./index.ts";

function env(vars: Record<string, string>): (name: string) => string | undefined {
  return (name) => vars[name];
}

it("resolves trace and metric signal URLs from a base OTLP endpoint", () => {
  assertEquals(
    resolveOtlpSignalUrl("https://collector.example/otlp", "traces"),
    "https://collector.example/otlp/v1/traces",
  );
  assertEquals(
    resolveOtlpSignalUrl("https://collector.example/otlp", "metrics"),
    "https://collector.example/otlp/v1/metrics",
  );
});

it("preserves explicit OTLP signal URLs", () => {
  assertEquals(
    resolveOtlpSignalUrl("https://collector.example/v1/traces", "traces"),
    "https://collector.example/v1/traces",
  );
  assertEquals(
    resolveOtlpSignalUrl("https://collector.example/v1/metrics", "metrics"),
    "https://collector.example/v1/metrics",
  );
});

it("resolves metrics without requiring trace export", () => {
  const config = resolveOtlpExtensionConfig(env({
    OTEL_TRACES_ENABLED: "false",
    OTEL_METRICS_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic platform-token",
    OTEL_SERVICE_NAME: "veryfront-server",
  }));

  assertEquals(config.tracesEnabled, false);
  assertEquals(config.metricsEnabled, true);
  assertEquals(config.tracesUrl, "https://collector.example/otlp/v1/traces");
  assertEquals(config.metricsUrl, "https://collector.example/otlp/v1/metrics");
  assertEquals(config.headers, { Authorization: "Basic platform-token" });
  assertEquals(config.serviceName, "veryfront-server");
});

it("does not expose a ctx.config.otel exporter-routing override", () => {
  const config = resolveOtlpExtensionConfig(env({
    OTEL_TRACES_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://platform-collector.example/otlp",
    OTEL_SERVICE_NAME: "veryfront-server",
  }));

  assertEquals(config.serviceName, "veryfront-server");
  assertEquals(config.tracesUrl, "https://platform-collector.example/otlp/v1/traces");
});
```

Run:

```bash
deno test --no-check --allow-all extensions/ext-observability-opentelemetry/src/index.test.ts
```

Expected: FAIL because the extension has no metrics exporter wiring.

- [x] **Step 2: Add metrics dependencies and env capabilities**

In `extensions/ext-observability-opentelemetry/deno.json`, add imports:

```json
"@opentelemetry/exporter-metrics-otlp-http": "npm:@opentelemetry/exporter-metrics-otlp-http@0.219.0",
"@opentelemetry/sdk-metrics": "npm:@opentelemetry/sdk-metrics@2.8.0"
```

Add capabilities for:

```json
"OTEL_METRICS_ENABLED",
"OTEL_METRICS_EXPORTER",
"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"
```

- [x] **Step 3: Export pure config resolution helpers**

In `extensions/ext-observability-opentelemetry/src/index.ts`, remove the `OtlpExtConfig` interface and the old `resolveConfig(ctxConfig)` path. Export pure helpers used by both startup and tests:

```ts
type EnvReader = (name: string) => string | undefined;

interface ResolvedOtlpExtensionConfig {
  serviceName: string;
  serviceVersion: string;
  headers: Record<string, string>;
  tracesEnabled: boolean;
  metricsEnabled: boolean;
  tracesUrl: string | undefined;
  metricsUrl: string | undefined;
  metricsExportIntervalMillis: number;
}
```

Implementation:

```ts
export function resolveOtlpSignalUrl(
  endpoint: string | undefined,
  signal: "traces" | "metrics",
): string | undefined {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/$/, "");
  const suffix = `/v1/${signal}`;
  return trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}

export function resolveOtlpExtensionConfig(
  read: EnvReader = readEnv,
): ResolvedOtlpExtensionConfig {
  const endpoint = read("OTEL_EXPORTER_OTLP_ENDPOINT");
  const tracesEndpoint = read("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ?? endpoint;
  const metricsEndpoint = read("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ?? endpoint;
  const metricsExportIntervalMillis = Number.parseInt(
    read("OTEL_METRIC_EXPORT_INTERVAL") ?? "60000",
    10,
  );

  return {
    serviceName: read("OTEL_SERVICE_NAME") ?? "veryfront",
    serviceVersion: "0.1.0",
    headers: parseHeaders(read("OTEL_EXPORTER_OTLP_HEADERS")),
    tracesEnabled: read("OTEL_TRACES_ENABLED") === "true",
    metricsEnabled: read("OTEL_METRICS_ENABLED") === "true",
    tracesUrl: resolveOtlpSignalUrl(tracesEndpoint, "traces"),
    metricsUrl: resolveOtlpSignalUrl(metricsEndpoint, "metrics"),
    metricsExportIntervalMillis: Number.isFinite(metricsExportIntervalMillis)
      ? metricsExportIntervalMillis
      : 60_000,
  };
}
```

Do not read `ctx.config` for OTLP endpoints, headers, service name, sampling, or enable flags in the shared extension. In shared runtimes those values are host-owned env only; dedicated runtimes can still provide project-specific values by running the project in its own process with its own process env.

Update exporter startup to call:

```ts
const config = resolveOtlpExtensionConfig(readEnv);
```

Do not pass `ctx.config` into telemetry exporter resolution.

- [x] **Step 4: Install a global meter provider when metrics are enabled**

Use the metrics SDK in `extensions/ext-observability-opentelemetry/src/index.ts`:

```ts
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
```

Add state to the exporter class:

```ts
private meterProvider: MeterProvider | null = null;
private metricReader: PeriodicExportingMetricReader | null = null;
```

During startup:

```ts
if (!config.tracesEnabled && !config.metricsEnabled) return;

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: config.serviceName,
  [ATTR_SERVICE_VERSION]: config.serviceVersion,
});

if (config.tracesEnabled) {
  if (!config.tracesUrl) {
    throw new Error("OTEL_TRACES_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT");
  }

  const exporter = new OTLPTraceExporter({
    url: config.tracesUrl,
    headers: config.headers,
  });

  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  trace.setGlobalTracerProvider(provider);
  this.sdkProvider = provider;

  // Preserve the existing AsyncLocalStorageContextManager,
  // W3CTraceContextPropagator, propagation.setGlobalPropagator(...), and
  // otelContext.setGlobalContextManager(...) setup here.
}

if (config.metricsEnabled) {
  if (!config.metricsUrl) {
    throw new Error("OTEL_METRICS_ENABLED=true requires OTEL_EXPORTER_OTLP_ENDPOINT or OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
  }

  this.metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: config.metricsUrl,
      headers: config.headers,
    }),
    exportIntervalMillis: config.metricsExportIntervalMillis,
  });

  this.meterProvider = new MeterProvider({
    resource,
    readers: [this.metricReader],
  });
  metrics.setGlobalMeterProvider(this.meterProvider);
}
```

Keep trace startup independent so these combinations work:
- traces enabled, metrics disabled
- traces disabled, metrics enabled
- traces enabled, metrics enabled

During shutdown:

```ts
await this.meterProvider?.shutdown();
this.meterProvider = null;
this.metricReader = null;
```

- [x] **Step 5: Document metrics env behavior**

In `extensions/ext-observability-opentelemetry/README.md`, remove the existing statements that `ctx.config.otel` wins over env vars and that configuration is read from `ctx.config.otel`.

Replace them with:

```md
Configuration is read from process `OTEL_*` environment variables.
In shared Veryfront runtimes these are platform-owned host env vars. The
extension does not accept `ctx.config.otel` exporter endpoint, header, service
name, or enable-flag overrides because project config is tenant controlled in
shared runtimes.
```

Also add:

```md
## Metrics

Set `OTEL_METRICS_ENABLED=true` to export framework metrics through OTLP HTTP.
The extension resolves `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` first, then
`OTEL_EXPORTER_OTLP_ENDPOINT`. A base OTLP endpoint receives `/v1/metrics`.

In shared Veryfront runtimes, these variables are platform-owned host env vars.
Project env overlays must not control the shared runtime metrics exporter. Use a
dedicated runtime for project-owned collector endpoints or credentials.
```

- [x] **Step 6: Run focused extension tests**

Run:

```bash
deno test --no-check --allow-all extensions/ext-observability-opentelemetry/src/index.test.ts src/observability/metrics/config.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add extensions/ext-observability-opentelemetry/src/index.ts extensions/ext-observability-opentelemetry/deno.json extensions/ext-observability-opentelemetry/README.md extensions/ext-observability-opentelemetry/src/index.test.ts
git commit -m "feat: export otel metrics from observability extension"
```

---

### Task 5: Document Eval Export Hooks and Vendor Telemetry Boundary

**Files:**
- Modify: `docs/guides/evals.md`
- Modify: `extensions/ext-eval-report-http/README.md`
- Inspect: `src/eval/runner.ts`
- Inspect: `src/eval/runner.test.ts`
- Inspect: `extensions/ext-eval-report-http/src/index.ts`

Current state: eval exports already hook into the framework through `EvalReportExporterRegistry`. `runEval()` creates an `EvalReport`, applies default redaction, and calls selected exporters. When OTel is active, `runEval()` enriches export context with the active `traceId` and `spanId`, unless the caller provides explicit `context.trace`. The HTTP eval extension sends `{ report, context }` to a configured endpoint and is the intended bridge for Langfuse, LangSmith, Braintrust, or an internal gateway.

This is not regular runtime telemetry. OTel traces and metrics describe runtime behavior. Eval exports are explicit application-level payload exports that may include prompt, output, score, metadata, and trace correlation fields after redaction.

- [x] **Step 1: Verify existing eval export tests cover trace context and redaction**

Run:

```bash
deno test --no-check --allow-all src/eval/runner.test.ts
```

Expected: PASS, including coverage for:
- selected exporters are invoked
- default redaction is applied
- active OTel trace context is included when present
- explicit `context.trace` wins over active span context

- [x] **Step 2: Add an HTTP exporter payload-shape regression test**

Add this focused test in `extensions/ext-eval-report-http/src/index.test.ts`:

```ts
import { createEvalReportHttpExporter } from "./index.ts";

it("sends eval report payloads with correlation context to the configured endpoint", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const exporter = createEvalReportHttpExporter(
    {
      id: "langfuse-proxy",
      url: "https://evals.example.test/langfuse",
      token: "test-token",
      headers: { "x-provider": "langfuse" },
    },
    (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );

  await exporter.export(
    {
      kind: "eval-report",
      definitionId: "eval:vendor-boundary",
      targetKind: "agent",
      target: "agent:researcher",
      runId: "evalrun_1",
      startedAt: "2026-06-21T00:00:00.000Z",
      endedAt: "2026-06-21T00:00:01.000Z",
      records: [],
      summary: { records: 0, passed: 0, failed: 0, passRate: 1, metrics: [] },
    },
    {
      projectReference: "docs-agent",
      trace: { traceId: "trace-1", spanId: "span-1" },
    },
  );

  assertEquals(requests.length, 1);
  assertEquals(requests[0]?.url, "https://evals.example.test/langfuse");
  assertEquals(requests[0]?.init.method, "POST");
  assertEquals(JSON.parse(String(requests[0]?.init.body)), {
    report: {
      kind: "eval-report",
      definitionId: "eval:vendor-boundary",
      targetKind: "agent",
      target: "agent:researcher",
      runId: "evalrun_1",
      startedAt: "2026-06-21T00:00:00.000Z",
      endedAt: "2026-06-21T00:00:01.000Z",
      records: [],
      summary: { records: 0, passed: 0, failed: 0, passRate: 1, metrics: [] },
    },
    context: {
      projectReference: "docs-agent",
      trace: { traceId: "trace-1", spanId: "span-1" },
    },
  });
});
```

This test locks the HTTP transport contract. Redaction remains covered by `src/eval/runner.test.ts`, where `runEval()` applies redaction before invoking exporters.

Run:

```bash
deno test --no-check --allow-all extensions/ext-eval-report-http/src/index.test.ts
```

Expected: PASS.

- [x] **Step 3: Update eval guide with the relationship to OTel**

In `docs/guides/evals.md`, add a section:

```md
## Eval exports vs runtime telemetry

OpenTelemetry runtime telemetry and eval report exports are separate data paths.

OpenTelemetry traces and metrics describe framework/runtime behavior and are
exported by `ext-observability-opentelemetry` to an OTLP collector. In shared
runtimes, OTLP exporter endpoints and headers are platform-owned host
configuration.

Eval exports are explicit report payload exports. `runEval()` sends redacted
`EvalReport` data through registered `EvalReportExporter` implementations. The
HTTP eval extension can forward those payloads to Langfuse, LangSmith,
Braintrust, or a Veryfront-owned gateway. When an active OTel span exists,
`runEval()` adds `traceId` and `spanId` to the eval export context so vendor
dashboards can correlate an eval report with runtime traces.

Do not use eval exporter env vars as a replacement for OTLP telemetry config.
Do not treat OTLP telemetry env vars as permission to export prompt/output eval
payloads. Eval report exports must remain explicit and redacted by default.
```

- [x] **Step 4: Update HTTP eval extension README**

In `extensions/ext-eval-report-http/README.md`, add or revise:

```md
The HTTP eval extension is for explicit eval report exports. It is appropriate
for routing redacted eval payloads to Langfuse, LangSmith, Braintrust, or an
internal gateway that adapts Veryfront's `EvalReport` shape to vendor APIs.

This extension does not configure OpenTelemetry spans or metrics. Runtime OTel
export is handled by `ext-observability-opentelemetry`. Eval exports may include
OTel `traceId` and `spanId` as correlation metadata, but they are not OTLP trace
or metric records.
```

- [x] **Step 5: Confirm shared-runtime env policy**

Do not add `VERYFRONT_EVAL_HTTP_EXPORTER_*` to the OTel reserved key list. Those keys configure explicit eval report export, not framework telemetry routing. If hosted shared runtimes allow project-controlled eval exporters, they must enforce the separate eval-export policy:
- redaction defaults stay on
- exports run only when eval execution is requested
- allowed destinations should be gateway-mediated or allowlisted for hosted tiers
- correlation fields may be sent, but raw runtime spans/metrics are not sent through eval exporters

- [x] **Step 6: Commit**

```bash
git add docs/guides/evals.md extensions/ext-eval-report-http/README.md extensions/ext-eval-report-http/src/index.test.ts
git commit -m "docs: clarify eval exports and runtime telemetry"
```

---

### Task 6: Document the Supported Telemetry Modes

**Files:**
- Modify: `.env.example`
- Modify: `docs/architecture/13-observability.md`
- Modify: `docs/guides/configuration.md`

- [x] **Step 1: Update `.env.example`**

Replace the existing OpenTelemetry section with:

```env
# OpenTelemetry (shared runtime)
# These variables are platform-owned in shared/proxy runtime processes.
# Do not set collector endpoints or headers from project environment variables in shared runtimes.
# OTEL_TRACES_ENABLED=true
# OTEL_SERVICE_NAME=veryfront-server
# OTEL_EXPORTER_OTLP_ENDPOINT=https://your-otlp-endpoint/otlp
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <REDACTED>
#
# Dedicated runtime / BYO telemetry
# Project-specific OTLP endpoints and credentials are supported only when the
# project runs in its own dedicated process or pod.
```

- [x] **Step 2: Update `docs/architecture/13-observability.md`**

Add this section after `Runtime flow`:

```md
## Multi-tenant telemetry

Shared Veryfront runtimes use platform-owned OpenTelemetry exporter configuration.
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`OTEL_SERVICE_NAME`, `OTEL_TRACES_ENABLED`, `OTEL_METRICS_ENABLED`, and
`VERYFRONT_OTEL` are read from the host process environment for framework
telemetry. Remote project environment overlays do not control the shared
runtime exporter.

Project-visible telemetry must be attributed with trusted project context such
as `project.id`, `project.slug`, `handler.project_slug`, or
`veryfront.project_slug`. Studio reads logs and traces through Veryfront API
project-scoped endpoints rather than querying observability backends directly.

Customer-owned OTLP endpoints are supported only for dedicated runtimes where
the project owns the process boundary. Do not multiplex tenant collector
credentials inside a shared server process.

| Runtime mode | OTEL endpoint/header source | Safe? | Policy |
| --- | --- | --- | --- |
| Shared multi-tenant runtime | Platform host env | Yes | Supported. Send all shared runtime telemetry to the Veryfront/platform collector and attach trusted project attributes. |
| Shared multi-tenant runtime | Project env or project config | No | Block. Project-controlled config must not change process-global exporters, headers, resource attributes, service name, sampling, or instrumentation flags. |
| Dedicated runtime / per-project pod | Project/deployment env or config | Yes | Supported. The project owns the process boundary, so BYO OTLP endpoint, headers, service name, sampling, and resource attributes are allowed. |
| Local development | Developer shell env or local config | Yes | Supported for debugging. Treat this like a single-project process, not a hosted shared runtime. |

Dedicated BYO telemetry and shared-runtime telemetry must not use the same
configuration path. If a deployment mode cannot prove a per-project process
boundary, it must use the shared-runtime policy.
```

- [x] **Step 3: Update `docs/guides/configuration.md`**

In the observability bullet, replace the current text with:

```md
- **Observability**: `OTEL_TRACES_ENABLED`, `OTEL_METRICS_ENABLED`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
  `OTEL_SERVICE_NAME`, and `VERYFRONT_OTEL`. In shared/proxy runtimes these
  variables are platform-owned host environment variables. Project environment
  variables do not control the shared runtime exporter. Use a dedicated runtime
  when a project needs its own OTLP endpoint or credentials. Runtime policy:
  shared runtime + host env is supported; shared runtime + project env/config
  is blocked; dedicated runtime + project env/config is supported; local dev
  uses developer-owned env/config.
```

- [x] **Step 4: Run docs-related checks**

Run:

```bash
deno test --no-check --allow-all tests/docs/guide-contracts.test.ts tests/docs/guide-code-examples.test.ts
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .env.example docs/architecture/13-observability.md docs/guides/configuration.md
git commit -m "docs: define shared runtime telemetry policy"
```

---

### Task 7: Verify API Trace and Log Read Boundaries

**Files:**
- Inspect: `../veryfront-api/src/infrastructure/external/tempo/client.test.ts`
- Inspect: `../veryfront-api/src/infrastructure/external/loki/query-builder.test.ts`
- Modify only if the assertions below are missing.

- [x] **Step 1: Verify Tempo search scopes by project ID**

Run:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/infrastructure/external/tempo/client.test.ts
```

from `../veryfront-api`.

Expected: PASS, including assertions equivalent to:

```ts
expect(buildTraceQL({ projectId: 'project-123' })).toBe('{ .project.id = "project-123" }')
expect(() =>
  parseTempoTraceResponse(traceWithOnlyOtherProjectSpans, 'trace-1', 'project-123')
).toThrow()
```

- [x] **Step 2: Add Tempo ownership assertions**

Add this test to `src/infrastructure/external/tempo/client.test.ts`:

```ts
it('does not return trace detail when no span belongs to the requested project', () => {
  expect(() =>
    parseTempoTraceResponse(
      createTempoTraceResponse({
        spans: [
          createTempoSpan({
            attributes: [createTempoAttribute('project.id', 'other-project')],
          }),
        ],
      }),
      traceId,
      'requested-project',
    )
  ).toThrow('Trace not found for project.')
})
```

Run:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/infrastructure/external/tempo/client.test.ts
```

Expected: PASS.

- [x] **Step 3: Verify Loki queries include project ID filtering**

Run:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/infrastructure/external/loki/query-builder.test.ts
```

Expected: PASS, including an assertion equivalent to:

```ts
expect(buildLogQL({ projectId: 'project-123' })).toContain('project_id=`project-123`')
```

- [x] **Step 4: Commit only if API tests were changed**

If tests were added:

```bash
git add src/infrastructure/external/tempo/client.test.ts src/infrastructure/external/loki/query-builder.test.ts
git commit -m "test: lock project-scoped observability reads"
```

If the file already had equivalent assertions and the added test is redundant after review, keep whichever version is clearer and commit the resulting test file.

---

### Task 8: Document Studio as a Read-Only Observability Client

**Files:**
- Modify: `../veryfront-studio/.env.example`
- Modify: `../veryfront-studio/studio/panels/traces/TracesPanel.Backend.mdx`
- Modify: `../veryfront-studio/studio/panels/logs/LogsPanel.Backend.mdx`

- [x] **Step 1: Update Studio `.env.example`**

Add near the panel flags:

```env
# Logs and traces panels read through Veryfront API project-scoped endpoints.
# Studio server OTel export is process-level server telemetry only.
# STUDIO_PANEL_LOGS_ENABLED=true
# STUDIO_PANEL_TRACES_ENABLED=true
```

- [x] **Step 2: Update traces backend docs**

Add this paragraph to `studio/panels/traces/TracesPanel.Backend.mdx`:

```md
The Traces panel does not query Grafana Tempo directly. It calls
`/api/projects/{project_reference}/traces` and
`/api/projects/{project_reference}/traces/{trace_id}` through the Veryfront API.
The API resolves the project server-side, filters Tempo search by `project.id`,
and rejects trace details that do not contain the requested project context.
```

- [x] **Step 3: Update logs backend docs**

Add this paragraph to `studio/panels/logs/LogsPanel.Backend.mdx`:

```md
The Logs panel does not query Loki directly. It calls
`/api/projects/{project_reference}/logs` through the Veryfront API. The API
resolves the project server-side and builds LogQL with a `project_id` filter
before querying the observability backend.
```

- [x] **Step 4: Run Studio docs/type checks**

Run from `../veryfront-studio`:

```bash
npm run check
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .env.example studio/panels/traces/TracesPanel.Backend.mdx studio/panels/logs/LogsPanel.Backend.mdx
git commit -m "docs: clarify Studio observability boundaries"
```

---

### Task 9: Verify or Implement API and Studio OTLP Metrics Export

**Files:**
- Modify: `../veryfront-api/package.json`
- Modify: `../veryfront-api/pnpm-lock.yaml`
- Modify: `../veryfront-api/src/lib/tracer/config.ts`
- Modify: `../veryfront-api/src/lib/tracer/index.ts`
- Modify: `../veryfront-api/src/lib/tracer/__tests__/otel-config.test.ts`
- Modify: `../veryfront-api/src/lib/tracer/__tests__/otel-integration.test.ts`
- Modify: `../veryfront-studio/package.json`
- Modify: `../veryfront-studio/package-lock.json`
- Modify: `../veryfront-studio/server/shared/observability/tracer-config.ts`
- Modify: `../veryfront-studio/server/shared/observability/tracer.ts`
- Modify: `../veryfront-studio/server/shared/observability/tracer-config.unit.test.ts`
- Modify: `../veryfront-studio/server/shared/observability/tracer.unit.test.ts`

Current state: `veryfront-api` records process, HTTP, AI gateway, and queue metrics through `@opentelemetry/api`, but `initializeOpenTelemetry()` only installs a trace exporter. `veryfront-studio` installs trace and log exporters, but no metric exporter. This task decides whether metrics are in scope for the same release and, if yes, makes export explicit instead of relying on implicit SDK env behavior.

- [x] **Step 1: Verify API metrics exporter dependencies**

From `../veryfront-api`, check whether these packages are present:

```bash
npm pkg get dependencies.@opentelemetry/exporter-metrics-otlp-http dependencies.@opentelemetry/sdk-metrics
```

Expected before implementation: one or both are missing.

If missing, install versions matching the existing OTel package family:

```bash
pnpm add @opentelemetry/exporter-metrics-otlp-http@^0.218.0 @opentelemetry/sdk-metrics@^2.7.1
```

- [x] **Step 2: Add API metric config tests**

In `../veryfront-api/src/lib/tracer/__tests__/otel-config.test.ts`, add:

```ts
it('resolves metrics exporter config from metrics-specific endpoint first', () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example/otlp'
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = 'https://metrics.example/v1/metrics'

  expect(OTelConfig.getMetricsExporterConfig().url).toBe('https://metrics.example/v1/metrics')
})

it('falls back to the base OTLP endpoint for metrics', () => {
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://collector.example/otlp'

  expect(OTelConfig.getMetricsExporterConfig().url).toBe('https://collector.example/otlp/v1/metrics')
})

it('enables metrics only when telemetry is enabled and metrics are not explicitly disabled', () => {
  process.env.OTEL_ENABLED = 'true'
  expect(OTelConfig.isMetricsEnabled()).toBe(true)

  process.env.OTEL_METRICS_ENABLED = 'false'
  expect(OTelConfig.isMetricsEnabled()).toBe(false)
})
```

Run:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/lib/tracer/__tests__/otel-config.test.ts
```

Expected: FAIL until config helpers are added.

- [x] **Step 3: Implement API metrics config helpers**

In `../veryfront-api/src/lib/tracer/config.ts`, add:

```ts
function appendSignalPath(url: string, signal: 'traces' | 'metrics') {
  const normalized = url.replace(/\/$/, '')
  const suffix = `/v1/${signal}`
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`
}
```

Add to `OTelConfig`:

```ts
isMetricsEnabled: () => {
  if (!OTelConfig.isEnabled()) return false
  const envValue = process.env.OTEL_METRICS_ENABLED
  return envValue === undefined || (envValue !== 'false' && envValue !== '0')
},

getMetricsExporterConfig: () => {
  const baseUrl =
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    (process.env.KUBERNETES_SERVICE_HOST
      ? 'http://otel-collector.monitoring.svc.cluster.local:4318'
      : 'http://localhost:4318')

  return {
    url: appendSignalPath(baseUrl, 'metrics'),
    headers: OTelConfig.getExporterConfig().headers,
  }
},
```

Also change `getExporterConfig()` to use `appendSignalPath(url, 'traces')` so trace and metric URL behavior stays consistent.

- [x] **Step 4: Install API metric reader**

In `../veryfront-api/src/lib/tracer/index.ts`, import the metric exporter and reader inside `initializeOpenTelemetry()`:

```ts
const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http')
const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics')
```

Before `new NodeSDK(...)`, create:

```ts
const metricReader = OTelConfig.isMetricsEnabled()
  ? new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(OTelConfig.getMetricsExporterConfig()),
      exportIntervalMillis: Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL || '60000', 10),
    })
  : undefined
```

Pass it to the SDK:

```ts
const sdk = new NodeSDK({
  resource,
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(samplingRatio),
  }),
  spanProcessor: new BatchSpanProcessor(exporter, {
    maxExportBatchSize: 100,
    scheduledDelayMillis: 500,
  }),
  ...(metricReader ? { metricReaders: [metricReader] } : {}),
  instrumentations: [
    // existing instrumentations
  ],
})
```

- [x] **Step 5: Implement the same explicit metric exporter for Studio**

Install the matching dependencies in `../veryfront-studio`:

```bash
npm install @opentelemetry/exporter-metrics-otlp-http@^0.218.0 @opentelemetry/sdk-metrics@^2.7.1
```

In `../veryfront-studio/server/shared/observability/tracer-config.ts`, add `isMetricsEnabled()` and `getMetricsExporterConfig()` with the same behavior as the API helper:
- `OTEL_ENABLED=false` or `0` disables all telemetry.
- `OTEL_METRICS_ENABLED=false` or `0` disables metrics while leaving traces/logs enabled.
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` wins over `OTEL_EXPORTER_OTLP_ENDPOINT`.
- a base OTLP endpoint gets `/v1/metrics` appended.

In `../veryfront-studio/server/shared/observability/tracer.ts`, add:

```ts
const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http')
const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics')
```

Create and pass `metricReaders: [metricReader]` into `NodeSDK` exactly as in the API implementation.

Add unit tests in `tracer-config.unit.test.ts` for:
- metrics-specific endpoint precedence
- base endpoint `/v1/metrics` normalization
- `OTEL_METRICS_ENABLED=false` disabling metrics

- [x] **Step 6: Run remote-service metric tests**

Run from `../veryfront-api`:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/lib/tracer/__tests__/otel-config.test.ts src/lib/tracer/__tests__/otel-integration.test.ts src/lib/metrics/process-metrics.test.ts src/usecases/observability/queue-metrics-sampler.test.ts
```

Run from `../veryfront-studio`:

```bash
npm run test -- server/shared/observability/tracer-config.unit.test.ts server/shared/observability/tracer.unit.test.ts
```

Expected: PASS.

- [x] **Step 7: Commit remote-service metrics changes**

If API code changed, run from `../veryfront-api`:

```bash
git add package.json pnpm-lock.yaml src/lib/tracer/config.ts src/lib/tracer/index.ts src/lib/tracer/__tests__/otel-config.test.ts src/lib/tracer/__tests__/otel-integration.test.ts
git commit -m "feat: export server metrics over otlp"
```

If Studio code changed, run from `../veryfront-studio`:

```bash
git add package.json package-lock.json server/shared/observability/tracer-config.ts server/shared/observability/tracer.ts server/shared/observability/tracer-config.unit.test.ts server/shared/observability/tracer.unit.test.ts
git commit -m "feat: export server metrics over otlp"
```

---

### Task 10: Final Verification

**Files:**
- No new files.

- [x] **Step 1: Run focused veryfront-code verification**

Run from `veryfront-code`:

```bash
deno test --no-check --allow-all src/observability/tracing/telemetry-env.test.ts src/server/project-env/reserved-env.test.ts src/server/project-env/getenv-integration.test.ts src/server/handlers/request/agent-stream.handler.test.ts src/config/environment-config.test.ts src/config/env.test.ts src/config/runtime-config.test.ts
```

Expected: PASS.

- [x] **Step 2: Run extension and eval verification**

Run from `veryfront-code`:

```bash
deno test --no-check --allow-all extensions/ext-observability-opentelemetry/src/index.test.ts extensions/ext-eval-report-http/src/index.test.ts src/eval/runner.test.ts src/observability/metrics/config.test.ts
```

Expected: PASS.

- [x] **Step 3: Run broader veryfront-code runtime tests**

Run from `veryfront-code`:

```bash
deno test --no-check --allow-all --parallel '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

Expected: PASS.

- [x] **Step 4: Run API observability tests**

Run from `../veryfront-api`:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/infrastructure/external/tempo/client.test.ts src/infrastructure/external/loki/query-builder.test.ts src/api/shared/middleware/tracing.test.ts
```

Expected: PASS.

- [x] **Step 5: Run API metrics verification**

Run from `../veryfront-api`:

```bash
pnpm exec vitest run --config vitest.config.unit.ts src/lib/tracer/__tests__/otel-config.test.ts src/lib/tracer/__tests__/otel-integration.test.ts src/lib/metrics/process-metrics.test.ts src/usecases/observability/queue-metrics-sampler.test.ts
```

Expected: PASS.

- [x] **Step 6: Run Studio observability verification**

Run from `../veryfront-studio`:

```bash
npm run test -- server/shared/observability/tracer-config.unit.test.ts server/shared/observability/tracer.unit.test.ts
npm run check
```

Expected: PASS.

- [x] **Step 7: Write the rollout note**

Create release note text:

```md
Telemetry hardening: shared Veryfront runtimes now treat OpenTelemetry trace and
metric exporter configuration as host-owned process configuration. Project
environment overlays cannot route shared-runtime telemetry to tenant-controlled
OTLP endpoints. Dedicated runtimes remain the supported path for customer-owned
OTLP collectors. Eval report exports remain a separate explicit, redacted data
export path and are not controlled by OTLP runtime telemetry settings.
```

- [x] **Step 8: Add the rollout note to the PR description**

There is no obvious changelog or changeset file in `veryfront-code`. Add the rollout note from Step 7 to the PR description under a `Rollout Note` heading.

---

## Self-Review

Spec coverage:
- Host-owned shared runtime OTel config: Tasks 1 and 2.
- Blocking tenant-controlled OTLP routing in shared runtimes: Task 3.
- Real OTLP metrics export from `ext-observability-opentelemetry`: Task 4.
- Eval export and vendor telemetry boundary: Task 5.
- Preserving dedicated-runtime BYO telemetry: Tasks 6 and 10 rollout note.
- API project-scoped observability reads: Task 7.
- Studio API-mediated read path: Task 8.
- API/Studio metric export decision: Task 9.

Placeholder scan:
- No `TBD`, `TODO`, or “similar to” steps remain.
- Every code change task includes concrete snippets and commands.

Type consistency:
- `getHostTelemetryEnv` and `isReservedSharedRuntimeTelemetryEnvKey` are introduced in Task 1 and reused in Tasks 2 and 3.
- `filterSharedRuntimeProjectEnv` is introduced in Task 3 and used in `runtime-handler/index.ts`.
- OTel metrics are configured by Task 2, exported by Task 4, and protected by the same shared-runtime env policy as traces.
- Eval exports stay separate from runtime telemetry: Task 5 documents that Langfuse, LangSmith, Braintrust, and gateway integrations receive explicit redacted eval payloads, with OTel trace IDs used only for correlation.
