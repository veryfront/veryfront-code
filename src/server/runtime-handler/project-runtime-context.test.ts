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
import { createRequestContext } from "../context/request-context.ts";
import type { DomainLookupResult } from "../utils/domain-lookup.ts";
import type { ParsedDomain } from "#veryfront/types";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";
import { __injectDepsForTests, extractRequestHeaders } from "./project-resolution.ts";
import {
  prepareProjectRequest,
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

  return {
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
    proxyTrust: { proxyTrusted: undefined },
    securityConfig: { allowedOrigins: ["*"] } as any,
    cspUserHeader: "default-src 'self'",
    debug: true,
    routeRegistry: {} as any,
    moduleServerUrl: "https://modules.example.test",
    envVarCache: {
      get: () => Promise.resolve({ REMOTE_ONLY: "1" }),
    },
    logDebug: () => {},
    ...overrides,
  } as Parameters<typeof resolveProjectRuntimeContext>[0];
}

afterEach(() => {
  defaultDiscoveryCache.projects.clear();
  defaultDiscoveryCache.adapters.clear();
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
  it("reuses explicit false proxy trust for headers and request context", async () => {
    let trustChecks = 0;
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
      trustProxy: () => {
        trustChecks += 1;
        return Promise.resolve(false);
      },
    });

    assertEquals(trustChecks, 1);
    assertStrictEquals(prepared.proxyTrust.proxyTrusted, false);
    assertEquals(prepared.headers, extractRequestHeaders(req, url, false));
    assertEquals(prepared.requestContext, createRequestContext(req, { proxyTrusted: false }));
    assertEquals(prepared.headers.environment, undefined);
    assertEquals(prepared.loggerFacts.projectSlug, "header-project");
    assertEquals(prepared.trackingFacts.releaseId, "rel_123");
    assertEquals(prepared.proxyGuard, undefined);
  });

  it("returns the existing missing slug proxy guard response", async () => {
    const req = new Request("http://localhost/page", {
      headers: { "x-token": "proxy-token" },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
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
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.proxyGuard?.detail, "x-token header is required in proxy mode");
    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("guards only trust-sensitive x-project-path in untrusted proxy requests", async () => {
    const forwardedOnly = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "my-project",
        "x-token": "proxy-token",
        "x-forwarded-host": "my-project.production.veryfront.com",
      },
    });

    const allowed = await prepareProjectRequest({
      req: forwardedOnly,
      url: new URL(forwardedOnly.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(allowed.proxyGuard, undefined);

    const projectPath = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "my-project",
        "x-token": "proxy-token",
        "x-project-path": "/attacker/chosen/path",
      },
    });

    const rejected = await prepareProjectRequest({
      req: projectPath,
      url: new URL(projectPath.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
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

  it("preserves websocket environment query and skips the proxy guard", async () => {
    const req = new Request(
      "http://localhost/_ws?x-environment=preview&x-project-slug=test-project",
    );

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.headers.environment, "preview");
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
      trustProxy: () => Promise.resolve(false),
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
          proxyTrust: { proxyTrusted: undefined },
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
      requestContext: createRequestContext(req, { proxyTrusted: false }),
      config: undefined,
      defaultProjectSlug: undefined,
      defaultProjectId: undefined,
      defaultReleaseId: undefined,
      wsSlugOverride: undefined,
      proxyTrust: { proxyTrusted: false },
    });

    assertEquals(untrusted.projectSlug, undefined);

    const trustedHeaders = extractRequestHeaders(req, url, true);
    const trusted = await resolveProjectIdentity({
      req,
      url,
      headers: trustedHeaders,
      requestContext: createRequestContext(req, { proxyTrusted: true }),
      config: undefined,
      defaultProjectSlug: undefined,
      defaultProjectId: undefined,
      defaultReleaseId: undefined,
      wsSlugOverride: undefined,
      proxyTrust: { proxyTrusted: true },
    });

    assertEquals(trusted.projectSlug, "forwarded-project");
    assertEquals(trusted.parsedDomain.slug, "forwarded-project");
    assertEquals(trusted.parsedDomain.environment, "preview");
  });

  it("preserves explicit slug and suppresses unrelated default project id", async () => {
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
      const headers = extractRequestHeaders(req, url);

      const result = await resolveProjectIdentity({
        req,
        url,
        headers,
        requestContext: createRequestContext(req),
        config: undefined,
        defaultProjectSlug: "default-slug",
        defaultProjectId: "default-id",
        defaultReleaseId: undefined,
        wsSlugOverride: "ws-slug",
        proxyTrust: { proxyTrusted: undefined },
      });

      assertEquals(result.projectSlug, "request-slug");
      assertEquals(result.projectId, undefined);
    } finally {
      __injectDepsForTests(null);
    }
  });

  it("keeps header release ahead of default release and domain release lookup", async () => {
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
        headers: extractRequestHeaders(req, url),
        requestContext: createRequestContext(req),
        config,
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        defaultReleaseId: "default-release",
        wsSlugOverride: undefined,
        proxyTrust: { proxyTrusted: undefined },
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
        proxyTrust: { proxyTrusted: undefined },
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
  it("returns handler context, raw env vars, and normalized source policy for remote requests", async () => {
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
    const requestContext = createRequestContext(req, { proxyTrusted: true });

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
      proxyTrust: { proxyTrusted: true },
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
    assertEquals(ctx.enriched, undefined);
    assertEquals(result.rawEnvVars, {});
  });

  it("passes explicit false proxy trust so untrusted x-project-path is suppressed", async () => {
    const adapter = createMockAdapter({
      "/attacker/chosen/path": { isDirectory: true },
      "/attacker/chosen/path/app": { isDirectory: true },
    });
    defaultDiscoveryCache.adapters.set("/attacker/chosen/path", adapter);
    const req = new Request("http://localhost/page", {
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
      requestContext: createRequestContext(req, { proxyTrusted: false }),
      isProxyMode: true,
      proxyTrust: { proxyTrusted: false },
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
    assertEquals(defaultDiscoveryCache.projects.has("remote-project"), false);
  });

  it("returns production 404 responses and standalone synthetic fallback from environment resolution", async () => {
    const remoteProduction = await resolveProjectRuntimeContext(makeRuntimeContextInput({
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

    assertEquals(remoteProduction.environment.errorResponse?.status, 404);
    assertEquals(
      remoteProduction.environment.errorResponse?.headers.get("Content-Type"),
      "text/html; charset=utf-8",
    );

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
  });
});
