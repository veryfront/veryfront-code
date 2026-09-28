import { getProjectEnv } from "#veryfront/server/project-env/storage.ts";
import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createVeryfrontHandler } from "#veryfront/server/runtime-handler/index.ts";
import { register } from "#veryfront/extensions/contracts.ts";
import { wireTracingShim } from "#veryfront/server/bootstrap.ts";
import {
  flushProjectHttpTracing,
  shutdownProjectHttpTracing,
} from "#veryfront/observability/tracing/project-http-tracing.ts";
import { resetApiHandler } from "#veryfront/server/handlers/request/api/pages-api-handler.ts";
import extOpenTelemetry from "../../../extensions/ext-observability-opentelemetry/src/index.ts";

for (const key of Object.keys(Deno.env.toObject())) {
  if (key.startsWith("OTEL_") || key.startsWith("DD_")) Deno.env.delete(key);
}
const dedicated = Deno.args[0]!.startsWith("dedicated");
const auth = Deno.args[0]!.endsWith("-auth");
const appRouter = Deno.args[0]!.endsWith("-app");
Deno.env.set("OTEL_TRACES_ENABLED", "false");
Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
Deno.env.set("PROXY_MODE", "1");
Deno.env.set("VERYFRONT_API_INTERNAL_USER", "fixture");
Deno.env.set("VERYFRONT_API_INTERNAL_PASS", "fixture-password");
Deno.env.set("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS", "false");
Deno.env.set("LOG_LEVEL", "error");
if (dedicated) {
  Deno.env.set("SERVER_ID", "fixture-server");
  Deno.env.set("ENVIRONMENT_IDS", "env-a,env-b");
} else {
  Deno.env.delete("SERVER_ID");
  Deno.env.delete("ENVIRONMENT_IDS");
}
type Attribute = { key: string; value: { stringValue?: string; intValue?: number | string } };
type Span = {
  name: string;
  attributes: Attribute[];
  traceId: string;
  spanId: string;
  parentSpanId?: string;
};
type Payload = {
  resourceSpans: { resource: { attributes: Attribute[] }; scopeSpans: { spans: Span[] }[] }[];
};
const captured: Record<string, Payload[]> = { a: [], b: [] };
let origin = "";
let managementReads = 0;
let secretReads = 0;
const control = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  const collector = /^\/collect\/([ab])\/v1\/traces$/.exec(url.pathname)?.[1];
  if (collector) {
    assertEquals(req.headers.get("authorization"), `Bearer collector-${collector}`);
    captured[collector]!.push(await req.json());
    return Response.json({}, { headers: { connection: "close" } });
  }
  const id = url.searchParams.get("environment_id")?.replace("env-", "");
  if (id !== "a" && id !== "b") return new Response("unknown environment", { status: 404 });
  const project = dedicated ? "project" : `project-${id}`;
  if (url.pathname === "/api/internal/project-environment-variables") {
    assertEquals(req.headers.get("authorization"), `Basic ${btoa("fixture:fixture-password")}`);
    assertEquals(url.searchParams.get("project_slug"), project);
    secretReads++;
  } else {
    assertEquals(url.pathname, `/api/projects/${project}/environment-variables`);
    assertEquals(req.headers.get("authorization"), `Bearer token-${project}`);
    managementReads++;
  }
  const env = {
    OTEL_TRACES_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: `${origin}/collect/${id}`,
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer collector-${id}`,
    OTEL_SERVICE_NAME: `application-${id}`,
    ...(auth
      ? {
        APP_URL: "https://application.example",
        OIDC_ISSUER: "https://identity.example",
        OIDC_CLIENT_ID: "fixture-client",
        OIDC_CLIENT_SECRET: "fixture-secret",
        OIDC_SESSION_SECRET: "fixture-session-secret-with-at-least-32-characters",
      }
      : {}),
  };
  return Response.json({ data: Object.entries(env).map(([key, value]) => ({ key, value })) }, {
    headers: { connection: "close" },
  });
});
origin = `http://127.0.0.1:${control.addr.port}`;
Deno.env.set("VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS", origin);
Deno.env.set("VERYFRONT_API_BASE_URL", `${origin}/api`);
const adapter = createMockAdapter();
const readAdapterEnv = adapter.env.get.bind(adapter.env);
adapter.env.get = (key) => getProjectEnv(key) ?? readAdapterEnv(key);
adapter.env.set("VERYFRONT_API_BASE_URL", `${origin}/api`);
const projectDir = "/virtual/otel-app";
adapter.fs.files.set(
  `${projectDir}/veryfront.config.ts`,
  `
  import extOpenTelemetry from "@veryfront/ext-observability-opentelemetry";
  export default { router: "${appRouter ? "app" : "pages"}", extensions: [extOpenTelemetry()],
    ${
    auth
      ? 'security: { auth: { oidc: { issuerEnvVar: "OIDC_ISSUER", clientIdEnvVar: "OIDC_CLIENT_ID", clientSecretEnvVar: "OIDC_CLIENT_SECRET", sessionSecretEnvVar: "OIDC_SESSION_SECRET", scopes: ["openid"] } } },'
      : ""
  }
  };
`,
);
adapter.fs.files.set(
  `${projectDir}/${appRouter ? "app/api/hello/route.ts" : "pages/api/hello.ts"}`,
  `
  import { trace, withSpan } from "veryfront/observability";
  const tracer = trace.getTracer("fixture-app");
  export function GET() {
    return withSpan("app.work", async () => {
      const child = tracer.startSpan("app.custom");
      child.setAttribute("project.id", "forged-other-project");
      child.end();
      return Response.json({ ok: true });
    });
  }
`,
);
const extension = extOpenTelemetry();
let app: Deno.HttpServer<Deno.NetAddr> | undefined;
try {
  await extension.setup!({
    config: {},
    provide: register,
    get: () => undefined,
    require: () => {
      throw new Error("unexpected contract");
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  wireTracingShim();
  const handler = createVeryfrontHandler(projectDir, adapter, {
    projectDir,
    allowHostProjectCodeExecution: true,
    config: { fs: { veryfront: { proxyMode: true } } },
  });
  app = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
  for (let batch = -1; batch < 20; batch++) {
    await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const id = index % 2 === 0 ? "a" : "b";
      const project = dedicated ? "project" : `project-${id}`;
      const res = await fetch(`http://127.0.0.1:${app!.addr.port}/api/hello`, {
        redirect: "manual",
        headers: {
          ...(auth
            ? { "x-forwarded-host": "application.example", "x-forwarded-proto": "https" }
            : {}),
          accept: auth && batch % 2 === 0 ? "text/html" : "application/json",
          "x-project-slug": project,
          "x-project-id": project,
          "x-token": `token-${project}`,
          "x-environment-id": `env-${id}`,
          "x-environment-name": "preview",
          "x-environment": "preview",
        },
      });
      const body = await res.text();
      if (auth) {
        assertEquals(res.status, batch % 2 === 0 ? 302 : 401, body);
      } else {
        assertEquals(res.status, 200, body);
        assertEquals(JSON.parse(body), { ok: true });
      }
    }));
    if (batch === -1) {
      await flushProjectHttpTracing();
      captured.a = [];
      captured.b = [];
    }
  }
  await flushProjectHttpTracing();
  assertEquals(managementReads, 2);
  assertEquals(secretReads, 2);
  for (const id of ["a", "b"]) {
    const project = dedicated ? "project" : `project-${id}`;
    const spans = captured[id]!.flatMap((payload) =>
      payload.resourceSpans.flatMap((group) => {
        assertEquals(
          group.resource.attributes.find((a) => a.key === "project.id")?.value.stringValue,
          project,
        );
        assertEquals(
          group.resource.attributes.find((a) => a.key === "environment.id")?.value.stringValue,
          `env-${id}`,
        );
        return group.scopeSpans.flatMap((scope) => scope.spans);
      })
    );
    assertEquals(spans.filter((s) => s.name === "http.server.request").length, 100);
    assertEquals(spans.filter((s) => s.name === "app.work").length, auth ? 0 : 100);
    assertEquals(spans.filter((s) => s.name === "app.custom").length, auth ? 0 : 100);
    assertEquals(spans.length, auth ? 100 : 300);
    if (!auth) {
      for (const work of spans.filter((span) => span.name === "app.work")) {
        assertEquals(
          spans.some((span) =>
            span.name === "http.server.request" && span.traceId === work.traceId &&
            span.spanId === work.parentSpanId
          ),
          true,
        );
      }
      for (const child of spans.filter((span) => span.name === "app.custom")) {
        assertEquals(
          spans.some((span) =>
            span.name === "app.work" && span.traceId === child.traceId &&
            span.spanId === child.parentSpanId
          ),
          true,
        );
      }
    }
    if (auth) {
      for (const status of [302, 401]) {
        assertEquals(
          spans.filter((s) =>
            Number(
              s.attributes.find((a) => a.key === "http.response.status_code")?.value.intValue,
            ) === status
          ).length,
          50,
        );
      }
    }
    for (const span of spans) {
      assertEquals(span.attributes.find((a) => a.key === "project.id")?.value.stringValue, project);
    }
  }
} finally {
  await shutdownProjectHttpTracing();
  await extension.teardown!();
  await resetApiHandler();
  await app?.shutdown();
  await control.shutdown();
}
