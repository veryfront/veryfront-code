import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
} from "#veryfront/utils/logger/logger.ts";
import { createRequestContext } from "../context/request-context.ts";
import type { DomainLookupResult } from "../utils/domain-lookup.ts";
import type { ParsedDomain } from "#veryfront/types";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";
import { __injectDepsForTests, extractRequestHeaders } from "./project-resolution.ts";
import {
  prepareProjectRequest,
  prepareProjectRuntimeSource,
  resolveProjectIdentity,
  resolveProjectRuntimeContext,
} from "./project-runtime-context.ts";

const defaultParsedDomain: ParsedDomain = {
  slug: null,
  branch: null,
  environment: null,
  isVeryfrontDomain: false,
  isDraft: false,
  allowIframeEmbed: false,
};

function createMockAdapter(
  files: Record<string, { isDirectory: boolean; isFile?: boolean }> = {},
  env: Record<string, string> = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "Memory",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: {
      readFile: async () => "",
      writeFile: async () => {},
      exists: async (path: string) => path in files,
      readDir: async function* () {},
      stat: async (path: string) => {
        const entry = files[path];
        if (!entry) throw new Error(`Not found: ${path}`);
        return {
          size: 0,
          isFile: entry.isFile ?? !entry.isDirectory,
          isDirectory: entry.isDirectory,
          isSymlink: false,
          mtime: null,
        };
      },
      mkdir: async () => {},
      remove: async () => {},
      makeTempDir: async () => "/tmp/vf-test",
      watch: () => ({ close: () => {}, [Symbol.asyncIterator]: async function* () {} }),
    },
    env: {
      get: (key: string) => env[key],
      set: (key: string, value: string) => {
        env[key] = value;
      },
      toObject: () => ({ ...env }),
    },
    server: {
      upgradeWebSocket: () => {
        throw new Error("Not implemented");
      },
    },
    serve: async () => ({
      stop: async () => {},
      addr: { hostname: "127.0.0.1", port: 0 },
    }),
  };
}

function createExtendedMockAdapter(
  options: { onRunWithContext?: () => never | void } = {},
): RuntimeAdapter {
  const base = createMockAdapter();
  const extendedFs = {
    ...base.fs,
    isVeryfrontAdapter: () => true,
    getUnderlyingAdapter: () => ({}),
    isMultiProjectMode: () => false,
    runWithContext: (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
    ) => {
      options.onRunWithContext?.();
      return fn();
    },
  };
  return { ...base, fs: extendedFs } as unknown as RuntimeAdapter;
}

function makeRuntimeContextInput(
  overrides: Record<string, unknown> = {},
): Parameters<typeof resolveProjectRuntimeContext>[0] {
  const req = new Request("http://remote-project.preview.lvh.me/page", {
    headers: {
      "x-project-slug": "remote-project",
      "x-project-id": "proj-remote",
      "x-token": "proxy-token",
      "x-environment-id": "env-remote",
    },
  });
  const url = new URL(req.url);
  const headers = extractRequestHeaders(req, url);
  const requestContext = createRequestContext(req);
  const adapter = createMockAdapter();
  const config = {
    integrations: {
      allow: {
        github: { allowedTools: ["list_repos", "get_issue"] },
      },
    },
  } as unknown as VeryfrontConfig;

  const baseInput = {
    req,
    url,
    projectDir: "/base/project",
    adapter,
    config,
    projectIdentity: {
      projectSlug: "remote-project",
      projectId: "proj-remote",
      releaseId: "rel-remote",
      environmentName: "Preview",
      proxyEnv: "preview",
      parsedDomain: defaultParsedDomain,
    },
    headers,
    requestContext,
    isProxyMode: false,
    allowDevelopmentModuleServing: false,
    proxyTopologyTrusted: false,
    securityConfig: { allowedOrigins: ["*"] } as any,
    cspUserHeader: "default-src 'self'",
    debug: true,
    routeRegistry: {} as any,
    moduleServerUrl: "https://modules.example.test",
    envVarCache: {
      get: () => Promise.resolve({ REMOTE_ONLY: "1" }),
    },
    hostedSourceBindingCache: {
      resolve: (input: {
        projectSlug: string;
        projectId?: string;
        environmentId?: string;
        selector:
          | { kind: "name"; name: string }
          | { kind: "domain"; domain: string };
        mode: "preview" | "production";
        releaseId?: string;
        branch?: string | null;
      }) => {
        const environmentName = input.selector.kind === "name" ? input.selector.name : "production";
        return Promise.resolve({
          projectSlug: input.projectSlug,
          projectId: input.projectId ?? "proj-remote",
          environmentId: input.environmentId ?? "env-remote",
          environmentName,
          activeReleaseId: input.releaseId ?? null,
          sourceContext: input.mode === "production"
            ? {
              productionMode: true as const,
              releaseId: input.releaseId ?? null,
              environmentName,
            }
            : {
              productionMode: false as const,
              branch: input.branch ?? null,
            },
        });
      },
    },
    logDebug: () => {},
  };
  const merged = {
    ...baseInput,
    ...overrides,
  } as unknown as Parameters<typeof resolveProjectRuntimeContext>[0];
  if (!("sourcePlan" in overrides)) {
    merged.sourcePlan = prepareProjectRuntimeSource({
      req: merged.req,
      url: merged.url,
      isProxyMode: merged.isProxyMode,
      proxyTopologyTrusted: merged.proxyTopologyTrusted,
      projectIdentity: merged.projectIdentity,
    });
  }
  return merged;
}

afterEach(() => {
  defaultDiscoveryCache.projects.clear();
  defaultDiscoveryCache.adapters.clear();
  Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
  __resetLogRecordEmitterForTests();
  __resetLoggerConfigForTests();
});

async function assertJsonResponse(
  response: Response,
  expectedStatus: number,
  expectedBody: Record<string, string>,
): Promise<void> {
  assertEquals(response.status, expectedStatus);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  assertEquals(await response.json(), expectedBody);
}

describe("prepareProjectRequest", () => {
  it("preserves explicit false topology trust for headers and request context", async () => {
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    const req = new Request("http://localhost/page", {
      headers: {
        host: "localhost",
        "x-forwarded-host": "forwarded-project.preview.lvh.me",
        "x-project-slug": "header-project",
        "x-token": "proxy-token",
        "x-release-id": "rel_123",
        "x-environment": "preview",
      },
    });
    const url = new URL(req.url);

    const prepared = await prepareProjectRequest({
      req,
      url,
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertStrictEquals(prepared.proxyTopologyTrusted, false);
    assertEquals(prepared.headers, extractRequestHeaders(req, url, false));
    assertEquals(
      prepared.requestContext,
      createRequestContext(req, { proxyTopologyTrusted: false }),
    );
    assertEquals(prepared.headers.environment, undefined);
    assertEquals(prepared.headers.projectSlug, undefined);
    assertEquals(prepared.headers.projectId, undefined);
    assertEquals(prepared.requestContext.slug, "");
    assertEquals(prepared.loggerFacts.projectSlug, undefined);
    assertEquals(prepared.trackingFacts.releaseId, undefined);
    assertEquals(prepared.proxyGuard?.detail, "x-project-slug header is required in proxy mode");
  });

  it("returns the existing missing slug proxy guard response", async () => {
    const req = new Request("http://localhost/page", {
      headers: { "x-token": "proxy-token" },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(prepared.proxyGuard?.detail, "x-project-slug header is required in proxy mode");
    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Missing project context",
      detail: "x-project-slug header is required in proxy mode",
    });
  });

  it("returns the existing missing token proxy guard response", async () => {
    const req = new Request("http://localhost/page", {
      headers: { "x-project-slug": "my-project" },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      proxyTopologyTrusted: true,
    });

    assertEquals(prepared.proxyGuard?.detail, "x-token header is required in proxy mode");
    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("guards trust-sensitive x-project-path in untrusted proxy requests", async () => {
    const forwardedOnly = new Request("http://my-project.production.veryfront.com/page", {
      headers: {
        "x-project-slug": "attacker-project",
        "x-token": "proxy-token",
        "x-forwarded-host": "attacker.production.veryfront.com",
      },
    });

    const allowed = await prepareProjectRequest({
      req: forwardedOnly,
      url: new URL(forwardedOnly.url),
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(allowed.proxyGuard, undefined);

    const projectPath = new Request("http://my-project.production.veryfront.com/page", {
      headers: {
        "x-project-slug": "attacker-project",
        "x-token": "proxy-token",
        "x-project-path": "/attacker/chosen/path",
      },
    });

    const rejected = await prepareProjectRequest({
      req: projectPath,
      url: new URL(projectPath.url),
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(
      rejected.proxyGuard?.detail,
      "proxy context headers require a trusted upstream proxy",
    );
    await assertJsonResponse(rejected.proxyGuard!.response, 502, {
      error: "Untrusted proxy context",
      detail: "proxy context headers require a trusted upstream proxy",
    });
  });

  it("ignores an untrusted websocket environment query and skips the proxy guard", async () => {
    const req = new Request(
      "http://localhost/_ws?x-environment=preview&x-project-slug=test-project",
    );

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(prepared.headers.environment, undefined);
    assertEquals(prepared.requestContext.mode, "production");
    assertEquals(prepared.proxyGuard, undefined);
  });

  it("skips the proxy guard for lightweight requests", async () => {
    const req = new Request("http://localhost/_veryfront/hydration-runtime.js", {
      headers: { "x-release-id": "rel_123" },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      proxyTopologyTrusted: false,
    });

    assertEquals(prepared.proxyGuard, undefined);
  });
});

describe("resolveProjectIdentity", () => {
  it("rejects unsupported identity operation names", async () => {
    const req = new Request("http://localhost/");
    const url = new URL(req.url);

    await assertRejects(
      () =>
        resolveProjectIdentity({
          operation: "runtime-context",
          req,
          url,
          headers: extractRequestHeaders(req, url),
          requestContext: createRequestContext(req),
          config: undefined,
          defaultProjectSlug: undefined,
          defaultProjectId: undefined,
          defaultReleaseId: undefined,
          wsSlugOverride: undefined,
          proxyTopologyTrusted: false,
        }),
      Error,
      "Unsupported project runtime context operation: runtime-context",
    );
  });

  it("derives identity from forwarded host only when proxy trust is explicit true", async () => {
    const req = new Request("http://localhost/", {
      headers: { "x-forwarded-host": "forwarded-project.preview.lvh.me" },
    });
    const url = new URL(req.url);

    const untrustedHeaders = extractRequestHeaders(req, url, false);
    const untrusted = await resolveProjectIdentity({
      req,
      url,
      headers: untrustedHeaders,
      requestContext: createRequestContext(req, { proxyTopologyTrusted: false }),
      config: undefined,
      defaultProjectSlug: undefined,
      defaultProjectId: undefined,
      defaultReleaseId: undefined,
      wsSlugOverride: undefined,
      proxyTopologyTrusted: false,
    });

    assertEquals(untrusted.projectSlug, undefined);

    const trustedHeaders = extractRequestHeaders(req, url, true);
    const trusted = await resolveProjectIdentity({
      req,
      url,
      headers: trustedHeaders,
      requestContext: createRequestContext(req, { proxyTopologyTrusted: true }),
      config: undefined,
      defaultProjectSlug: undefined,
      defaultProjectId: undefined,
      defaultReleaseId: undefined,
      wsSlugOverride: undefined,
      proxyTopologyTrusted: true,
    });

    assertEquals(trusted.projectSlug, "forwarded-project");
    assertEquals(trusted.parsedDomain.slug, "forwarded-project");
    assertEquals(trusted.parsedDomain.environment, "preview");
  });

  it("keeps rotating standalone identity headers on the configured identity through HandlerContext", async () => {
    __injectDepsForTests({
      parseProjectDomain: () => defaultParsedDomain,
      lookupProjectByDomain: () => Promise.resolve(null),
      getEnvironmentType: () => undefined,
    });
    try {
      for (
        const [headerSlug, headerId] of [
          ["attacker-a", "project-attacker-a"],
          ["attacker-b", "project-attacker-b"],
        ] as const
      ) {
        const req = new Request("http://localhost/page", {
          headers: {
            "x-project-slug": headerSlug,
            "x-project-id": headerId,
          },
        });
        const url = new URL(req.url);
        const prepared = await prepareProjectRequest({
          req,
          url,
          isProxyMode: false,
          proxyTopologyTrusted: false,
        });
        const identity = await resolveProjectIdentity({
          req,
          url,
          headers: prepared.headers,
          requestContext: prepared.requestContext,
          config: undefined,
          defaultProjectSlug: "configured-project",
          defaultProjectId: "project-configured",
          defaultReleaseId: undefined,
          wsSlugOverride: undefined,
          proxyTopologyTrusted: prepared.proxyTopologyTrusted,
        });

        assertEquals(prepared.headers.projectSlug, undefined);
        assertEquals(prepared.headers.projectId, undefined);
        assertEquals(identity.projectSlug, "configured-project");
        assertEquals(identity.projectId, "project-configured");

        const runtime = await resolveProjectRuntimeContext(makeRuntimeContextInput({
          req,
          url,
          headers: prepared.headers,
          requestContext: prepared.requestContext,
          projectIdentity: identity,
          isProxyMode: false,
          proxyTopologyTrusted: prepared.proxyTopologyTrusted,
        }));

        assertExists(runtime.handlerContext);
        assertEquals(runtime.handlerContext.projectSlug, "configured-project");
        assertEquals(runtime.handlerContext.projectId, "project-configured");
      }

      const trustedReq = new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "trusted-project",
          "x-project-id": "project-trusted",
          "x-token": "trusted-token",
        },
      });
      const trustedUrl = new URL(trustedReq.url);
      const trustedPrepared = await prepareProjectRequest({
        req: trustedReq,
        url: trustedUrl,
        isProxyMode: true,
        proxyTopologyTrusted: true,
      });
      const trustedIdentity = await resolveProjectIdentity({
        req: trustedReq,
        url: trustedUrl,
        headers: trustedPrepared.headers,
        requestContext: trustedPrepared.requestContext,
        config: undefined,
        defaultProjectSlug: "configured-project",
        defaultProjectId: "project-configured",
        defaultReleaseId: undefined,
        wsSlugOverride: undefined,
        proxyTopologyTrusted: trustedPrepared.proxyTopologyTrusted,
      });

      assertEquals(trustedPrepared.proxyGuard, undefined);
      assertEquals(trustedIdentity.projectSlug, "trusted-project");
      assertEquals(trustedIdentity.projectId, "project-trusted");
    } finally {
      __injectDepsForTests(null);
    }
  });

  it("preserves a trusted explicit slug and suppresses unrelated default project id", async () => {
    __injectDepsForTests({
      parseProjectDomain: () => defaultParsedDomain,
      lookupProjectByDomain: () => Promise.resolve(null),
      getEnvironmentType: () => undefined,
    });
    try {
      const req = new Request("http://localhost/", {
        headers: { "x-project-slug": "request-slug", "x-branch-id": "branch-1" },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url, true);

      const result = await resolveProjectIdentity({
        req,
        url,
        headers,
        requestContext: createRequestContext(req, { proxyTopologyTrusted: true }),
        config: undefined,
        defaultProjectSlug: "default-slug",
        defaultProjectId: "default-id",
        defaultReleaseId: undefined,
        wsSlugOverride: "ws-slug",
        proxyTopologyTrusted: true,
      });

      assertEquals(result.projectSlug, "request-slug");
      assertEquals(result.projectId, undefined);
    } finally {
      __injectDepsForTests(null);
    }
  });

  it("keeps a trusted proxy release ahead of default release and domain release lookup", async () => {
    let lookupCount = 0;
    __injectDepsForTests({
      parseProjectDomain: () => ({
        ...defaultParsedDomain,
        slug: "prod-project",
        environment: "production",
        isVeryfrontDomain: true,
        isDraft: false,
      }),
      lookupProjectByDomain: () => {
        lookupCount += 1;
        return Promise.resolve(
          {
            project_id: "domain-project-id",
            project_slug: "prod-project",
            project_name: "Prod Project",
            environment: { id: "env-1", name: "Production" },
            release_id: "domain-release",
          } satisfies DomainLookupResult,
        );
      },
      getEnvironmentType: () => "production",
    });
    try {
      const config = {
        fs: { veryfront: { apiToken: "test-token" } },
      } as unknown as VeryfrontConfig;
      const req = new Request("http://prod-project.veryfront.com/", {
        headers: { "x-release-id": "header-release" },
      });
      const url = new URL(req.url);

      const result = await resolveProjectIdentity({
        req,
        url,
        headers: extractRequestHeaders(req, url, true),
        requestContext: createRequestContext(req, { proxyTopologyTrusted: true }),
        config,
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        defaultReleaseId: "default-release",
        wsSlugOverride: undefined,
        proxyTopologyTrusted: true,
      });

      assertEquals(result.releaseId, "header-release");
      assertEquals(lookupCount, 0);
    } finally {
      __injectDepsForTests(null);
    }
  });

  it("preserves custom domain lookup identity and proxy environment", async () => {
    const lookupResult: DomainLookupResult = {
      project_id: "proj-1",
      project_slug: "looked-up-slug",
      project_name: "Looked Up",
      environment: { id: "env-1", name: "Production" },
      release_id: "rel-99",
    };
    __injectDepsForTests({
      parseProjectDomain: () => defaultParsedDomain,
      lookupProjectByDomain: () => Promise.resolve(lookupResult),
      getEnvironmentType: () => "production",
    });
    try {
      const config = {
        fs: { veryfront: { apiToken: "test-token", apiBaseUrl: "https://api.test.com" } },
      } as unknown as VeryfrontConfig;
      const req = new Request("http://custom-domain.example.com/", {
        headers: { "x-token": "request-token" },
      });
      const url = new URL(req.url);

      const result = await resolveProjectIdentity({
        req,
        url,
        headers: extractRequestHeaders(req, url),
        requestContext: createRequestContext(req),
        config,
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        defaultReleaseId: undefined,
        wsSlugOverride: undefined,
        proxyTopologyTrusted: false,
      });

      assertEquals(result.projectSlug, "looked-up-slug");
      assertEquals(result.projectId, "proj-1");
      assertEquals(result.releaseId, "rel-99");
      assertEquals(result.environmentName, "Production");
      assertEquals(result.proxyEnv, "production");
      assertEquals(result.parsedDomain, defaultParsedDomain);
    } finally {
      __injectDepsForTests(null);
    }
  });
});

describe("resolveProjectRuntimeContext", () => {
  it("returns handler context, raw env vars, and normalized source policy for standalone requests", async () => {
    let envLoadCount = 0;
    const adapter = createMockAdapter();
    const routeRegistry = { execute: () => Promise.resolve(undefined) } as any;
    const securityConfig = { allowedOrigins: ["https://example.test"] } as any;
    const cspUserHeader = "default-src 'self'";
    const input = makeRuntimeContextInput({
      adapter,
      routeRegistry,
      securityConfig,
      cspUserHeader,
      environmentId: "env-remote",
      envVarCache: {
        get: (
          environmentId: string,
          token: string,
          projectSlug: string,
        ) => {
          envLoadCount += 1;
          assertEquals(environmentId, "env-remote");
          assertEquals(token, "proxy-token");
          assertEquals(projectSlug, "remote-project");
          return Promise.resolve({ REMOTE_ONLY: "1", SECRET_VALUE: "present" });
        },
      },
    });

    const result = await resolveProjectRuntimeContext(input);

    assertEquals(envLoadCount, 1);
    assertEquals(result.rawEnvVars, { REMOTE_ONLY: "1", SECRET_VALUE: "present" });
    assertEquals(result.sourceIntegrationPolicy, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        github: { allowedToolIds: ["get_issue", "list_repos"] },
      },
    });
    assertExists(result.handlerContext);
    const ctx = result.handlerContext;
    assertStrictEquals(ctx.adapter, adapter);
    assertStrictEquals(ctx.securityConfig, securityConfig);
    assertStrictEquals(ctx.cspUserHeader, cspUserHeader);
    assertStrictEquals(ctx.routeRegistry, routeRegistry);
    assertEquals(ctx.projectDir, "/base/project");
    assertEquals(ctx.projectSlug, "remote-project");
    assertEquals(ctx.projectId, "proj-remote");
    assertEquals(ctx.releaseId, "rel-remote");
    assertEquals(ctx.proxyToken, "proxy-token");
    assertEquals(ctx.environmentId, "env-remote");
    assertEquals(ctx.moduleServerUrl, "https://modules.example.test");
    assertEquals(ctx.requestContext?.mode, "preview");
    assertEquals(ctx.clientModuleStrategy, "rsc-module");
    assertEquals(ctx.allowHostProjectCodeExecution, true);
    assertEquals(result.environment.resolvedEnvironment, "preview");
  });

  it("honors trusted local project paths, suppresses local proxy tokens, and skips enriched context", async () => {
    const adapter = createMockAdapter({
      "/trusted/project": { isDirectory: true },
      "/trusted/project/app": { isDirectory: true },
    });
    defaultDiscoveryCache.adapters.set("/trusted/project", adapter);
    const req = new Request("http://localhost/api/control-plane/runs/run_1/stream", {
      method: "POST",
      headers: {
        "x-project-slug": "local-project",
        "x-project-id": "proj-local",
        "x-token": "proxy-token",
        "x-project-path": "/trusted/project",
      },
    });
    const url = new URL(req.url);
    const headers = extractRequestHeaders(req, url, true);
    const requestContext = createRequestContext(req, { proxyTopologyTrusted: true });

    let envLoadCount = 0;
    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers,
      requestContext,
      projectIdentity: {
        projectSlug: "local-project",
        projectId: "proj-local",
        releaseId: undefined,
        environmentName: undefined,
        proxyEnv: "preview",
        parsedDomain: defaultParsedDomain,
      },
      isProxyMode: true,
      allowDevelopmentModuleServing: true,
      proxyTopologyTrusted: true,
      skipEnrichedContext: true,
      envVarCache: {
        get: () => {
          envLoadCount += 1;
          return Promise.resolve({ SHOULD_NOT_LOAD: "1" });
        },
      },
    }));

    assertEquals(envLoadCount, 0);
    assertEquals(result.adapter.isLocalProject, true);
    assertEquals(result.adapter.projectDir, "/trusted/project");
    assertEquals(defaultDiscoveryCache.projects.get("local-project"), "/trusted/project");
    assertExists(result.handlerContext);
    const ctx = result.handlerContext;
    assertEquals(ctx.projectDir, "/trusted/project");
    assertStrictEquals(ctx.adapter, adapter);
    assertEquals(ctx.config, undefined);
    assertEquals(ctx.proxyToken, undefined);
    assertEquals(ctx.clientModuleStrategy, "fs");
    assertEquals(ctx.allowHostProjectCodeExecution, true);
    assertEquals(ctx.enriched, undefined);
    assertEquals(result.rawEnvVars, {});
  });

  it("passes explicit false topology trust so untrusted x-project-path is suppressed", async () => {
    const adapter = createMockAdapter({
      "/attacker/chosen/path": { isDirectory: true },
      "/attacker/chosen/path/app": { isDirectory: true },
    });
    adapter.fs.readFile = async () => "export default {};";
    defaultDiscoveryCache.adapters.set("/attacker/chosen/path", adapter);
    const req = new Request("http://remote-project.preview.lvh.me/page", {
      headers: {
        "x-project-slug": "remote-project",
        "x-project-id": "proj-remote",
        "x-token": "proxy-token",
        "x-project-path": "/attacker/chosen/path",
      },
    });
    const url = new URL(req.url);
    const headers = extractRequestHeaders(req, url, false);

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers,
      requestContext: createRequestContext(req, { proxyTopologyTrusted: false }),
      isProxyMode: true,
      proxyTopologyTrusted: false,
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: undefined,
        proxyEnv: "preview",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(result.adapter.isLocalProject, false);
    assertEquals(result.adapter.projectDir, "/base/project");
    assertEquals(result.handlerContext?.allowHostProjectCodeExecution, false);
    assertEquals(defaultDiscoveryCache.projects.has("remote-project"), false);
  });

  it("returns standalone synthetic fallback from environment resolution", async () => {
    const standaloneProduction = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      isProxyMode: false,
      defaultEnvironment: "production",
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(standaloneProduction.environment.errorResponse, undefined);
    assertEquals(standaloneProduction.environment.resolvedEnvironment, "production");
    assertEquals(standaloneProduction.environment.releaseId, "standalone-dev");
    assertExists(standaloneProduction.handlerContext);
    assertEquals(standaloneProduction.handlerContext.releaseId, "standalone-dev");
    assertEquals(standaloneProduction.handlerContext.isLocalProject, false);
    assertEquals(standaloneProduction.handlerContext.allowHostProjectCodeExecution, true);
  });

  it("keeps standalone virtual project source on isolated execution paths", async () => {
    const standalone = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      adapter: createExtendedMockAdapter(),
      isProxyMode: false,
      defaultEnvironment: "production",
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertExists(standalone.handlerContext);
    assertEquals(standalone.handlerContext.isLocalProject, false);
    assertEquals(standalone.handlerContext.allowHostProjectCodeExecution, false);
  });

  it("returns production environment errors before reading source policy config", async () => {
    let sourcePolicyReads = 0;
    const config = {} as VeryfrontConfig;
    Object.defineProperty(config, "integrations", {
      get: () => {
        sourcePolicyReads += 1;
        throw new Error("source policy must not be read");
      },
    });
    const req = new Request("http://remote-project.production.veryfront.com/page", {
      headers: {
        "x-project-slug": "remote-project",
        "x-project-id": "proj-remote",
      },
    });
    const url = new URL(req.url);

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      config,
      headers: extractRequestHeaders(req, url),
      requestContext: createRequestContext(req),
      isProxyMode: true,
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(result.environment.errorResponse?.status, 404);
    assertEquals(result.handlerContext, undefined);
    assertEquals(result.rawEnvVars, {});
    assertEquals(result.sourceIntegrationPolicy, {
      schemaVersion: 1,
      mode: "unrestricted",
    });
    assertEquals(sourcePolicyReads, 0);
  });

  it("does not reread topology trust after explicit false was captured", () => {
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");

    const req = new Request("http://internal.local/page", {
      headers: {
        host: "internal.local",
        "x-forwarded-host": "remote-project.production.veryfront.com",
        "x-project-slug": "remote-project",
        "x-project-id": "proj-remote",
      },
    });
    const url = new URL(req.url);
    const sourcePlan = prepareProjectRuntimeSource({
      req,
      url,
      isProxyMode: true,
      proxyTopologyTrusted: false,
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    });

    assertEquals(sourcePlan.sourceHost, "internal.local");
    assertEquals(sourcePlan.hostedSource?.selector, {
      kind: "domain",
      domain: "internal.local",
    });
  });

  it("notifies environment resolution before source policy access and later failures", async () => {
    const events: string[] = [];
    const config = {} as VeryfrontConfig;
    Object.defineProperty(config, "integrations", {
      get: () => {
        events.push("source-policy");
        throw new Error("source policy read failed");
      },
    });

    await assertRejects(
      () =>
        resolveProjectRuntimeContext(makeRuntimeContextInput({
          config,
          onEnvironmentResolved: () => {
            events.push("environment");
          },
        })),
      Error,
      "source policy read failed",
    );

    assertEquals(events, ["environment", "source-policy"]);
  });

  it("keeps exact-source control-plane config undefined at the runtime-context boundary", async () => {
    let outerContextCalls = 0;
    let hostedSourceBindingCalls = 0;
    let envLoadCalls = 0;
    const adapter = createExtendedMockAdapter({
      onRunWithContext: () => {
        outerContextCalls += 1;
        throw new Error("outer source must not be read");
      },
    });
    const req = new Request("http://localhost/api/control-plane/runs/run_1/stream", {
      method: "POST",
      headers: {
        "x-project-slug": "proxy-project",
        "x-project-id": "proj-proxy",
        "x-token": "proxy-token",
        "x-environment-id": "env-outer",
      },
    });
    const url = new URL(req.url);
    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers: extractRequestHeaders(req, url),
      requestContext: createRequestContext(req),
      isProxyMode: true,
      hostedSourceBindingCache: {
        resolve: () => {
          hostedSourceBindingCalls += 1;
          return Promise.reject(new Error("outer source binding must not be resolved"));
        },
      },
      envVarCache: {
        get: () => {
          envLoadCalls += 1;
          return Promise.resolve({ SHOULD_NOT_LOAD: "1" });
        },
      },
      projectIdentity: {
        projectSlug: "proxy-project",
        projectId: "proj-proxy",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(outerContextCalls, 0);
    assertEquals(hostedSourceBindingCalls, 0);
    assertEquals(envLoadCalls, 0);
    assertEquals(result.rawEnvVars, {});
    assertEquals(result.adapter.config, undefined);
    assertEquals(result.handlerContext?.config, undefined);
  });

  it("rejects proxy config load failures at the runtime-context boundary", async () => {
    const adapter = createExtendedMockAdapter({
      onRunWithContext: () => {
        throw new Error("proxy config fail");
      },
    });
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "proxy-project",
        "x-project-id": "proj-proxy",
        "x-token": "proxy-token",
      },
    });
    const url = new URL(req.url);

    await assertRejects(
      () =>
        resolveProjectRuntimeContext(makeRuntimeContextInput({
          req,
          url,
          adapter,
          headers: extractRequestHeaders(req, url),
          requestContext: createRequestContext(req),
          isProxyMode: true,
          projectIdentity: {
            projectSlug: "proxy-project",
            projectId: "proj-proxy",
            releaseId: "rel-proxy",
            environmentName: "Preview",
            proxyEnv: "preview",
            parsedDomain: defaultParsedDomain,
          },
        })),
      Error,
      "proxy config fail",
    );
  });
});
