import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { evaluateDeclarativeConfig } from "#veryfront/config/declarative-evaluator.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { resolveProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";

const declarations = [{ name: "ext-observability-opentelemetry" }] as const;
const scope = { projectId: "project-a", environmentId: "environment-a" };
const env = {
  OTEL_TRACES_ENABLED: "true",
  OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer synthetic-token,x-route=base",
};

describe("hosted project telemetry configuration", () => {
  it("requires HTTPS for project headers unless the HTTP origin is host-allowlisted", async () => {
    await withEnv({
      VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: "http://collector.example:4318",
    }, async () => {
      for (
        const [endpoint, allowed] of [["http://public.example:4318", false], [
          "http://collector.example:4318",
          true,
        ], ["https://public.example", true]] as const
      ) {
        const result = await resolveProjectTraceConfig(scope, declarations, {
          ...env,
          OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
        });
        assertEquals(result.status, allowed ? "enabled" : "invalid");
      }
      const withoutHeaders = await resolveProjectTraceConfig(scope, declarations, {
        ...env,
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://public.example:4318",
        OTEL_EXPORTER_OTLP_HEADERS: "",
      });
      assertEquals(withoutHeaders.status, "enabled");
    });
  });

  it("rejects a malformed host allowlist without throwing from telemetry validation", async () => {
    await withEnv(
      { VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS: "not-an-origin" },
      async () => {
        assertEquals(
          await resolveProjectTraceConfig(scope, declarations, {
            ...env,
            OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example:4318",
          }),
          { status: "invalid", reason: "endpoint" },
        );
      },
    );
  });

  it("uses the extension marker retained by hosted declarative evaluation", async () => {
    const snapshot = await evaluateDeclarativeConfig({
      source: `
        import extOpenTelemetry from "@veryfront/ext-observability-opentelemetry";
        export default { extensions: [extOpenTelemetry()] };
      `,
      environmentName: "production",
      environment: env,
    });
    assertEquals(snapshot.extensions, declarations);
    const result = await resolveProjectTraceConfig(
      scope,
      snapshot.extensions as readonly unknown[],
      env,
    );
    assertEquals(result.status, "enabled");
  });

  it("does not borrow platform enablement, endpoints, credentials or service identity", async () => {
    await withEnv({
      ...env,
      OTEL_SERVICE_NAME: "platform-service",
    }, async () => {
      assertEquals(await resolveProjectTraceConfig(scope, declarations, {}), {
        status: "disabled",
      });
      assertEquals(
        await resolveProjectTraceConfig(scope, declarations, { OTEL_TRACES_ENABLED: "true" }),
        { status: "invalid", reason: "endpoint" },
      );
      const result = await resolveProjectTraceConfig(scope, declarations, {
        OTEL_TRACES_ENABLED: "true",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://project.example",
      });
      assertEquals(result.status, "enabled");
      if (result.status !== "enabled") return;
      assertEquals(result.config.headers, {});
      assertEquals(result.config.serviceName, "project-a");
    });
  });
  it("does not pass credentials through replaceable serialization or header methods", async () => {
    const previousEntries = Object.entries;
    const previousSplit = String.prototype.split;
    const previousGet = Headers.prototype.get;
    const previousSet = Headers.prototype.set;
    const arrayJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    const href = Object.getOwnPropertyDescriptor(URL.prototype, "href")!;
    let intercepted = false;
    const intercept = () => {
      intercepted = true;
      throw new Error("replaceable method invoked");
    };
    let result: Awaited<ReturnType<typeof resolveProjectTraceConfig>>;
    try {
      Object.entries = intercept;
      String.prototype.split = intercept;
      Headers.prototype.get = intercept;
      Headers.prototype.set = intercept;
      Object.defineProperty(Array.prototype, "toJSON", { configurable: true, value: intercept });
      Object.defineProperty(URL.prototype, "href", { ...href, get: intercept });
      result = await resolveProjectTraceConfig(scope, declarations, env);
    } finally {
      Object.entries = previousEntries;
      String.prototype.split = previousSplit;
      Headers.prototype.get = previousGet;
      Headers.prototype.set = previousSet;
      if (arrayJson) Object.defineProperty(Array.prototype, "toJSON", arrayJson);
      else Reflect.deleteProperty(Array.prototype, "toJSON");
      Object.defineProperty(URL.prototype, "href", href);
    }
    assertEquals(intercepted, false);
    assertEquals(result!.status, "enabled");
  });
});
