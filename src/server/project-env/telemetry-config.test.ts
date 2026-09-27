import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { filterSharedRuntimeProjectEnv } from "#veryfront/server/project-env/reserved-env.ts";
import { resolveProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";

const declarations = [{ name: "ext-observability-opentelemetry" }] as const;
const scope = { projectId: "project-a", environmentId: "environment-a" };
const env = {
  OTEL_TRACES_ENABLED: "true",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer synthetic-token,x-route=base",
};

describe("project telemetry configuration", () => {
  it("requires a declaration and a project signal opt-in; disable wins", async () => {
    for (
      const [extensions, variables] of [
        [[], env],
        [declarations, {}],
        [[...declarations, { name: declarations[0].name, enabled: false }], env],
        [declarations, { ...env, OTEL_TRACES_ENABLED: "false", OTEL_TRACES_EXPORTER: "otlp" }],
      ] as const
    ) {
      assertEquals(
        await resolveProjectTraceConfig(scope, extensions, variables),
        { status: "disabled" },
      );
    }
  });

  it("resolves signal overrides and snapshots headers without exposing OTEL in shared env", async () => {
    const variables = {
      ...env,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/custom-intake",
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer other-token,x-route=traces",
      OTEL_SERVICE_NAME: "application",
      OTEL_SERVICE_VERSION: "1.2.3",
      OTEL_DEPLOYMENT_ENVIRONMENT: "preview",
      APPLICATION_SETTING: "kept",
    };
    const result = await resolveProjectTraceConfig(scope, declarations, variables);
    assertEquals(result.status, "enabled");
    if (result.status !== "enabled") return;
    assertEquals(result.config.endpoint, "https://traces.example/custom-intake");
    assertEquals(result.config.headers, {
      authorization: "Bearer other-token",
      "x-route": "traces",
    });
    assertEquals(result.config.serviceName, "application");
    assertEquals(result.config.serviceVersion, "1.2.3");
    assertEquals(result.config.deploymentEnvironment, "preview");
    assertEquals(Object.isFrozen(result.config), true);
    assertEquals(Object.isFrozen(result.config.headers), true);
    variables.OTEL_SERVICE_NAME = "changed";
    assertEquals(result.config.serviceName, "application");
    assertEquals(filterSharedRuntimeProjectEnv(variables), { APPLICATION_SETTING: "kept" });
  });

  it("accepts the OTLP exporter flag and appends the trace path only to base endpoints", async () => {
    const result = await resolveProjectTraceConfig(scope, declarations, {
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp/",
    });
    assertEquals(result.status, "enabled");
    if (result.status !== "enabled") return;
    assertEquals(result.config.endpoint, "https://collector.example/otlp/v1/traces");
  });

  it("normalizes a trailing slash on a base endpoint that already names the trace signal", async () => {
    const result = await resolveProjectTraceConfig(scope, declarations, {
      ...env,
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp/v1/traces/",
    });
    assertEquals(result.status, "enabled");
    if (result.status !== "enabled") return;
    assertEquals(result.config.endpoint, "https://collector.example/otlp/v1/traces");
  });

  it("rejects invalid settings with bounded diagnostics that contain no supplied values", async () => {
    for (
      const [patch, reason] of [
        [{ OTEL_TRACES_ENABLED: "sometimes" }, "signal"],
        [{ OTEL_EXPORTER_OTLP_ENDPOINT: "file:///synthetic-secret" }, "endpoint"],
        [
          { OTEL_EXPORTER_OTLP_ENDPOINT: "https://user:synthetic-secret@collector.example" },
          "endpoint",
        ],
        [{ OTEL_EXPORTER_OTLP_HEADERS: "invalid-header" }, "headers"],
        [
          { OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer token\r\nHost: other.example" },
          "headers",
        ],
        [{ OTEL_EXPORTER_OTLP_HEADERS: "Host=other.example" }, "headers"],
        [{ OTEL_EXPORTER_OTLP_HEADERS: "Content-Encoding=gzip" }, "headers"],
        [{ OTEL_EXPORTER_OTLP_HEADERS: "Content-Type=text/plain" }, "headers"],
        [{ OTEL_SERVICE_NAME: "x".repeat(257) }, "resource"],
      ] as const
    ) {
      assertEquals(await resolveProjectTraceConfig(scope, declarations, { ...env, ...patch }), {
        status: "invalid",
        reason,
      });
    }
    assertEquals(
      await resolveProjectTraceConfig({ projectId: "", environmentId: "" }, declarations, env),
      {
        status: "invalid",
        reason: "identity",
      },
    );
  });

  it("creates a stable opaque revision, changing only when effective settings or scope change", async () => {
    const first = await resolveProjectTraceConfig(scope, declarations, env);
    const reordered = await resolveProjectTraceConfig(scope, declarations, {
      ...env,
      OTEL_EXPORTER_OTLP_HEADERS: "x-route=base,authorization=Bearer synthetic-token",
      UNRELATED_SECRET: "does-not-invalidate",
    });
    const rotated = await resolveProjectTraceConfig(scope, declarations, {
      ...env,
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer rotated-token,x-route=base",
    });
    const otherScope = await resolveProjectTraceConfig(
      { ...scope, environmentId: "environment-b" },
      declarations,
      env,
    );
    for (const result of [first, reordered, rotated, otherScope]) {
      assertEquals(result.status, "enabled");
    }
    if (
      first.status !== "enabled" || reordered.status !== "enabled" ||
      rotated.status !== "enabled" || otherScope.status !== "enabled"
    ) return;
    assertExists(first.config.revision);
    assertEquals(first.config.revision, reordered.config.revision);
    assertNotEquals(first.config.revision, rotated.config.revision);
    assertNotEquals(first.config.revision, otherScope.config.revision);
    assertEquals(first.config.revision.includes("synthetic-token"), false);
  });

  it("ignores inherited or accessor-backed declarations and environment settings", async () => {
    const hostile = Object.create({ OTEL_TRACES_ENABLED: "true" });
    Object.defineProperty(hostile, "OTEL_EXPORTER_OTLP_ENDPOINT", {
      get() {
        throw new Error("must not read accessor");
      },
    });
    assertEquals(await resolveProjectTraceConfig(scope, declarations, hostile), {
      status: "disabled",
    });
    assertEquals(await resolveProjectTraceConfig(scope, [Object.create(declarations[0])], env), {
      status: "disabled",
    });
  });
});
