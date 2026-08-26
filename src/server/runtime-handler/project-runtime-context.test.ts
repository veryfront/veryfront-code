import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ProjectEnvironmentScope } from "#veryfront/server/project-env/cache.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { createRequestContext } from "../context/request-context.ts";
import { AuthHandler } from "#veryfront/security/http/auth.ts";
import { CsrfHandler } from "#veryfront/security/http/csrf/csrf-handler.ts";
import type { DomainLookupResult } from "../utils/domain-lookup.ts";
import type { ParsedDomain } from "#veryfront/types";
import { defaultDiscoveryCache } from "./local-project-discovery.ts";
import { __injectDepsForTests, extractRequestHeaders } from "./project-resolution.ts";
import {
  prepareProjectRequest,
  resolveProjectIdentity,
  resolveProjectRuntimeContext,
} from "./project-runtime-context.ts";
import { preparePreviewDocumentSourceSnapshot } from "../handlers/request/source-snapshot-freshness.ts";

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
      readFile: (path: string) =>
        path in files
          ? Promise.resolve("")
          : Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`)),
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

function createHostedConfigAdapter(source: string): RuntimeAdapter {
  const configPath = "/base/project/veryfront.config.ts";
  const adapter = createMockAdapter({
    [configPath]: { isDirectory: false, isFile: true },
  });
  (adapter.fs as unknown as Record<string, unknown>).sourceSnapshotFreshnessOptionsVersion = 1;
  adapter.fs.ensureSourceSnapshotFresh = () => Promise.resolve();
  adapter.fs.getSourceSnapshotIdentity = () => "branch:hosted-config-test:main";
  adapter.fs.getSourceSnapshotVersion = () => 1;
  adapter.fs.readFile = (path: string) =>
    path === configPath
      ? Promise.resolve(source)
      : Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
  return adapter;
}

function makeRuntimeContextInput(
  overrides: Record<string, unknown> = {},
): Parameters<typeof resolveProjectRuntimeContext>[0] {
  const req = new Request("http://remote-project.preview.localhost/page", {
    headers: {
      "x-project-slug": "remote-project",
      "x-project-id": "proj-remote",
      "x-token": "proxy-token",
      "x-environment-id": "env-remote",
      "x-environment-name": "preview",
      "x-default-branch-name": "trunk",
    },
  });
  const url = new URL(req.url);
  const headers = extractRequestHeaders(req, url, false, true);
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
  it("reuses explicit false proxy trust for headers and request context", async () => {
    let trustChecks = 0;
    const req = new Request("http://localhost/page", {
      headers: {
        host: "localhost",
        "x-forwarded-host": "forwarded-project.preview.localhost",
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
    assertStrictEquals(prepared.proxyTrust.identityHeadersTrusted, false);
    assertEquals(prepared.headers, extractRequestHeaders(req, url, false));
    assertEquals(
      prepared.requestContext,
      createRequestContext(req, {
        proxyTrusted: false,
        allowHostTokenFallback: false,
      }),
    );
    assertEquals(prepared.headers.environment, undefined);
    assertEquals(prepared.loggerFacts.projectSlug, "header-project");
    assertEquals(prepared.trackingFacts.releaseId, "rel_123");
    assertEquals(
      prepared.proxyGuard?.detail,
      "proxy mode requires an operator-trusted upstream proxy",
    );
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

  it("rejects every untrusted proxy identity, not only x-project-path", async () => {
    const forwardedOnly = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "my-project",
        "x-token": "proxy-token",
        "x-forwarded-host": "my-project.production.veryfront.com",
      },
    });

    const rejectedForwarded = await prepareProjectRequest({
      req: forwardedOnly,
      url: new URL(forwardedOnly.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(
      rejectedForwarded.proxyGuard?.detail,
      "proxy mode requires an operator-trusted upstream proxy",
    );

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
      "proxy mode requires an operator-trusted upstream proxy",
    );
    await assertJsonResponse(rejected.proxyGuard!.response, 502, {
      error: "Untrusted proxy context",
      detail: "proxy mode requires an operator-trusted upstream proxy",
    });
  });

  it("rejects unbound identity IDs even when a dispatch signature is trusted", async () => {
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "project-a",
        "x-project-id": "victim-project-id",
        "x-environment-id": "victim-environment-id",
        "x-environment-name": "victim-environment-name",
        "x-token": "project-token",
      },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.headers.projectId, undefined);
    assertEquals(prepared.headers.environmentId, undefined);
    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Untrusted identity context",
      detail:
        "project, environment, and branch identity headers require an operator-authenticated proxy boundary",
    });
  });

  it("rejects an untrusted default branch identity on its own", async () => {
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "project-a",
        "x-default-branch-name": "attacker-branch",
        "x-token": "project-token",
      },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.headers.defaultBranchName, undefined);
    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Untrusted identity context",
      detail:
        "project, environment, and branch identity headers require an operator-authenticated proxy boundary",
    });
  });

  it("accepts canonical identity IDs from an operator-authenticated proxy", async () => {
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "project-a",
        "x-project-id": "project-id-a",
        "x-environment-id": "environment-id-a",
        "x-environment-name": "staging",
        "x-token": "project-token",
      },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(true),
    });

    assertEquals(prepared.proxyTrust.identityHeadersTrusted, true);
    assertEquals(prepared.headers.projectId, "project-id-a");
    assertEquals(prepared.headers.environmentId, "environment-id-a");
    assertEquals(prepared.headers.environmentName, "staging");
    assertEquals(prepared.proxyGuard, undefined);
  });

  it("rejects an incomplete environment identity from a trusted proxy", async () => {
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "project-a",
        "x-project-id": "project-id-a",
        "x-environment-id": "environment-id-a",
        "x-token": "project-token",
      },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(true),
    });

    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Incomplete environment identity",
      detail: "x-environment-id and x-environment-name must be supplied together",
    });
  });

  it("rejects incomplete and conflicting branch identity from a trusted proxy", async () => {
    const invalidBranchIdentities: Array<Record<string, string>> = [
      { "x-branch-id": "branch-id-a" },
      { "x-branch-name": "feature-a" },
      {
        "x-branch-id": "branch-id-a",
        "x-branch-name": "feature-a",
        "x-default-branch-name": "main",
      },
    ];
    for (const identityHeaders of invalidBranchIdentities) {
      const req = new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "project-a",
          "x-project-id": "project-id-a",
          "x-token": "project-token",
          ...identityHeaders,
        },
      });

      const prepared = await prepareProjectRequest({
        req,
        url: new URL(req.url),
        isProxyMode: true,
        trustProxy: () => Promise.resolve(true),
      });

      await assertJsonResponse(prepared.proxyGuard!.response, 502, {
        error: "Invalid branch identity",
        detail:
          "x-branch-id and x-branch-name must be supplied together and cannot be combined with x-default-branch-name",
      });
    }
  });

  it("accepts complete preview or default branch identity from a trusted proxy", async () => {
    const validBranchIdentities: Array<Record<string, string>> = [
      { "x-branch-id": "branch-id-a", "x-branch-name": "feature-a" },
      { "x-default-branch-name": "main" },
    ];
    for (const identityHeaders of validBranchIdentities) {
      const req = new Request("http://localhost/page", {
        headers: {
          "x-project-slug": "project-a",
          "x-project-id": "project-id-a",
          "x-token": "project-token",
          ...identityHeaders,
        },
      });

      const prepared = await prepareProjectRequest({
        req,
        url: new URL(req.url),
        isProxyMode: true,
        trustProxy: () => Promise.resolve(true),
      });

      assertEquals(prepared.proxyGuard, undefined);
    }
  });

  it("reports missing authentication before validating a trusted environment pair", async () => {
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "project-a",
        "x-project-id": "project-id-a",
        "x-environment-id": "environment-id-a",
      },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(true),
    });

    await assertJsonResponse(prepared.proxyGuard!.response, 502, {
      error: "Missing authentication context",
      detail: "x-token header is required in proxy mode",
    });
  });

  it("rejects untrusted websocket query identity", async () => {
    const req = new Request(
      "http://localhost/_ws?x-environment=preview&x-project-slug=test-project",
    );

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.headers.environment, undefined);
    assertEquals(prepared.proxyGuard?.detail, "x-project-slug header is required in proxy mode");
  });

  it("applies the proxy guard to lightweight requests", async () => {
    const req = new Request("http://localhost/_veryfront/hydration-runtime.js", {
      headers: { "x-release-id": "rel_123" },
    });

    const prepared = await prepareProjectRequest({
      req,
      url: new URL(req.url),
      isProxyMode: true,
      trustProxy: () => Promise.resolve(false),
    });

    assertEquals(prepared.proxyGuard?.detail, "x-project-slug header is required in proxy mode");
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
      headers: { "x-forwarded-host": "forwarded-project.preview.localhost" },
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

  it("preserves the trusted canonical environment name when release identity is complete", async () => {
    for (const environmentName of ["staging", "production"]) {
      const req = new Request(`http://project.${environmentName}.veryfront.com/`, {
        headers: {
          "x-project-slug": "project",
          "x-project-id": "project-id",
          "x-release-id": `release-${environmentName}`,
          "x-environment": "production",
          "x-environment-id": `environment-${environmentName}`,
          "x-environment-name": environmentName,
          "x-token": "project-token",
        },
      });
      const url = new URL(req.url);
      const headers = extractRequestHeaders(req, url, true, true);
      const result = await resolveProjectIdentity({
        req,
        url,
        headers,
        requestContext: createRequestContext(req, { proxyTrusted: true }),
        config: undefined,
        defaultProjectSlug: undefined,
        defaultProjectId: undefined,
        defaultReleaseId: undefined,
        wsSlugOverride: undefined,
        proxyTrust: { proxyTrusted: true },
      });

      assertEquals(result.environmentName, environmentName);
      assertEquals(result.releaseId, `release-${environmentName}`);
      assertEquals(result.proxyEnv, "production");
    }
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
  it("derives preview document config from the strict routing snapshot", async () => {
    let sourceFresh = false;
    let sourceVersion = 0;
    const freshnessCalls: Array<{ reason?: string; maxAgeMs?: number }> = [];
    const configPath = "/base/project/veryfront.config.ts";
    const adapter = createHostedConfigAdapter("");
    adapter.fs.readFile = (path: string) => {
      if (path !== configPath) {
        return Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
      }
      return Promise.resolve(
        `export default { router: "${sourceFresh ? "pages" : "app"}" };`,
      );
    };
    Object.assign(adapter.fs, {
      sourceSnapshotFreshnessOptionsVersion: 1,
      ensureSourceSnapshotFresh: (reason?: string, options?: { maxAgeMs?: number }) => {
        freshnessCalls.push({ reason, maxAgeMs: options?.maxAgeMs });
        sourceFresh = true;
        sourceVersion++;
        return Promise.resolve();
      },
      getSourceSnapshotIdentity: () => "branch:generation-config-project:main",
      getSourceSnapshotVersion: () => sourceVersion,
    });

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      adapter,
      config: undefined,
      isProxyMode: true,
      allowHostProjectCodeExecution: true,
      proxyTrust: { proxyTrusted: true },
      projectIdentity: {
        projectSlug: "generation-config-project",
        projectId: "proj_generation_config",
        releaseId: undefined,
        environmentName: undefined,
        proxyEnv: "preview",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(result.handlerContext?.config?.router, "pages");
    assertEquals(freshnessCalls, [
      { reason: "config-load", maxAgeMs: undefined },
      { reason: "preview-document-routing", maxAgeMs: 0 },
    ]);

    assertExists(result.handlerContext);
    await preparePreviewDocumentSourceSnapshot(result.handlerContext);
    assertEquals(
      freshnessCalls,
      [
        { reason: "config-load", maxAgeMs: undefined },
        { reason: "preview-document-routing", maxAgeMs: 0 },
      ],
      "routing must reuse the generation that produced config instead of advancing past it",
    );
  });

  it("evaluates staging config and security with the matching trusted environment secrets", async () => {
    const adapter = createHostedConfigAdapter(`
      import { defineConfigWithEnv, getEnv } from "veryfront";
      export default defineConfigWithEnv((environmentName) => ({
        title: environmentName + ":" + getEnv("TENANT_MARKER"),
        security: {
          auth: { bearer: { token: getEnv("AUTH_TOKEN") } },
          csrf: true,
        },
      }));
    `);
    const req = new Request("http://project.staging.veryfront.com/page", {
      headers: {
        "x-project-slug": "project",
        "x-project-id": "project-id",
        "x-release-id": "release-staging",
        "x-environment": "production",
        "x-environment-id": "environment-staging",
        "x-environment-name": "staging",
        "x-token": "project-token",
      },
    });
    const url = new URL(req.url);
    const headers = extractRequestHeaders(req, url, true, true);
    const requestContext = createRequestContext(req, { proxyTrusted: true });
    const projectIdentity = await resolveProjectIdentity({
      req,
      url,
      headers,
      requestContext,
      config: undefined,
      defaultProjectSlug: undefined,
      defaultProjectId: undefined,
      defaultReleaseId: undefined,
      wsSlugOverride: undefined,
      proxyTrust: { proxyTrusted: true },
    });
    let observedEnvironmentId: string | undefined;

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers,
      requestContext,
      projectIdentity,
      isProxyMode: true,
      proxyTrust: { proxyTrusted: true },
      envVarCache: {
        get: (scope: ProjectEnvironmentScope) => {
          observedEnvironmentId = scope.environmentId;
          return Promise.resolve({
            TENANT_MARKER: "staging-environment",
            AUTH_TOKEN: "staging-secret",
          });
        },
      },
    }));

    assertEquals(observedEnvironmentId, "environment-staging");
    assertEquals(result.handlerContext?.config?.title, "staging:staging-environment");
    assertEquals(result.handlerContext?.isProxyMode, true);
    assertEquals(result.handlerContext?.securityConfig?.auth, {
      bearer: { token: "staging-secret" },
    });
    assertEquals(result.rawEnvVars, {
      TENANT_MARKER: "staging-environment",
      AUTH_TOKEN: "staging-secret",
    });
  });

  it("returns handler context, raw env vars, and normalized source policy for remote requests", async () => {
    let envLoadCount = 0;
    const adapter = createMockAdapter();
    const routeRegistry = { execute: () => Promise.resolve(undefined) } as any;
    const securityConfig = { allowedOrigins: ["https://example.test"] } as any;
    const input = makeRuntimeContextInput({
      adapter,
      routeRegistry,
      securityConfig,
      envVarCache: {
        get: ({ environmentId, token, projectSlug, projectId }: ProjectEnvironmentScope) => {
          envLoadCount += 1;
          assertEquals(environmentId, "env-remote");
          assertEquals(token, "proxy-token");
          assertEquals(projectSlug, "remote-project");
          assertEquals(projectId, "proj-remote");
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
    assertStrictEquals(ctx.routeRegistry, routeRegistry);
    assertEquals(ctx.projectDir, "/base/project");
    assertEquals(ctx.projectSlug, "remote-project");
    assertEquals(ctx.projectId, "proj-remote");
    assertEquals(ctx.releaseId, "rel-remote");
    assertEquals(ctx.proxyToken, "proxy-token");
    assertEquals(ctx.environmentId, "env-remote");
    assertEquals(ctx.defaultBranchName, "trunk");
    assertEquals(ctx.moduleServerUrl, "https://modules.example.test");
    assertEquals(ctx.isProxyMode, false);
    assertEquals(ctx.requestContext?.mode, "preview");
    assertEquals(result.environment.resolvedEnvironment, "preview");
  });

  it("carries the trusted browser-visible request origin into handler context", async () => {
    const req = new Request("http://runtime.internal/page", {
      headers: {
        "x-forwarded-host": "app.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url: new URL(req.url),
      proxyTrust: { proxyTrusted: true },
    }));

    assertEquals(result.handlerContext?.requestOrigin, "https://app.example.com:8443");
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
      "/base/project/veryfront.config.ts": { isDirectory: false, isFile: true },
    });
    adapter.fs.readFile = (path: string) =>
      path === "/base/project/veryfront.config.ts"
        ? Promise.resolve(`
          import { defineConfigWithEnv, getEnv } from "veryfront";
          export default defineConfigWithEnv((environmentName) => ({
            title: environmentName + ":" + getEnv("TENANT"),
            security: {
              auth: { bearer: { token: getEnv("AUTH_TOKEN") } },
              cors: { origin: ["https://client.example"] },
              csrf: true,
              csp: { defaultSrc: ["'none'"] },
            },
          }));
        `)
        : Promise.reject(new Deno.errors.NotFound(`Not found: ${path}`));
    (adapter.fs as unknown as Record<string, unknown>).sourceSnapshotFreshnessOptionsVersion = 1;
    adapter.fs.ensureSourceSnapshotFresh = () => Promise.resolve();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:remote-project:main";
    adapter.fs.getSourceSnapshotVersion = () => 1;
    defaultDiscoveryCache.adapters.set("/attacker/chosen/path", adapter);
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "remote-project",
        "x-project-id": "proj-remote",
        "x-token": "proxy-token",
        "x-environment-id": "env-remote",
        "x-project-path": "/attacker/chosen/path",
      },
    });
    const url = new URL(req.url);
    const headers = extractRequestHeaders(req, url, false);

    let envLoadCount = 0;
    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers,
      requestContext: createRequestContext(req, { proxyTrusted: false }),
      isProxyMode: true,
      proxyTrust: { proxyTrusted: false },
      environmentId: "env-remote",
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: undefined,
        proxyEnv: "preview",
        parsedDomain: defaultParsedDomain,
      },
      envVarCache: {
        get: () => {
          envLoadCount += 1;
          return Promise.resolve({ TENANT: "tenant-value", AUTH_TOKEN: "tenant-secret" });
        },
      },
    }));

    assertEquals(envLoadCount, 1);
    assertEquals(result.adapter.isLocalProject, false);
    assertEquals(result.adapter.projectDir, "/base/project");
    assertEquals(defaultDiscoveryCache.projects.has("remote-project"), false);
    assertEquals(result.handlerContext?.config?.title, "preview:tenant-value");
    assertEquals(result.rawEnvVars, {
      TENANT: "tenant-value",
      AUTH_TOKEN: "tenant-secret",
    });
    const ctx = result.handlerContext!;
    assertEquals(ctx.securityConfig?.auth, {
      bearer: { token: "tenant-secret" },
    });
    assertEquals(ctx.securityConfig?.csrf, true);
    assertEquals(ctx.securityConfig?.cors, {
      origin: ["https://client.example"],
    });
    assertEquals(ctx.securityConfig?.csp, { defaultSrc: ["'none'"] });

    const authResult = await new AuthHandler().handle(
      new Request("http://localhost/page"),
      ctx,
    );
    assertEquals(authResult.response?.status, 401);
    const csrfResult = await new CsrfHandler().handle(
      new Request("http://localhost/action", { method: "POST" }),
      ctx,
    );
    assertEquals(csrfResult.response?.status, 403);
  });

  it("derives isolated hosted security snapshots for concurrent tenants", async () => {
    const makeTenantResolution = (
      projectSlug: string,
      projectId: string,
      token: string,
    ) => {
      const adapter = createHostedConfigAdapter(`
        import { defineConfigWithEnv, getEnv } from "veryfront";
        export default defineConfigWithEnv((environmentName) => ({
          title: environmentName,
          security: {
            auth: { bearer: { token: getEnv("AUTH_TOKEN") } },
            cors: { origin: [getEnv("CLIENT_ORIGIN")] },
            csrf: true,
            csp: { defaultSrc: [getEnv("CSP_SOURCE")] },
          },
        }));
      `);
      const req = new Request(`http://${projectSlug}.preview.localhost/page`, {
        headers: {
          "x-project-slug": projectSlug,
          "x-project-id": projectId,
          "x-token": "proxy-token",
          "x-environment-id": `env-${projectId}`,
        },
      });
      const url = new URL(req.url);
      return resolveProjectRuntimeContext(makeRuntimeContextInput({
        req,
        url,
        adapter,
        headers: extractRequestHeaders(req, url, true, true),
        requestContext: createRequestContext(req, { proxyTrusted: true }),
        isProxyMode: true,
        proxyTrust: { proxyTrusted: true },
        projectIdentity: {
          projectSlug,
          projectId,
          releaseId: undefined,
          environmentName: undefined,
          proxyEnv: "preview",
          parsedDomain: defaultParsedDomain,
        },
        envVarCache: {
          get: () =>
            Promise.resolve({
              AUTH_TOKEN: token,
              CLIENT_ORIGIN: `https://${projectSlug}.client.example`,
              CSP_SOURCE: `https://${projectSlug}.assets.example`,
            }),
        },
      }));
    };

    const [alpha, beta] = await Promise.all([
      makeTenantResolution("alpha-project", "proj-alpha-security", "alpha-secret"),
      makeTenantResolution("beta-project", "proj-beta-security", "beta-secret"),
    ]);

    const alphaSecurity = alpha.handlerContext?.securityConfig;
    const betaSecurity = beta.handlerContext?.securityConfig;
    assertEquals(alphaSecurity?.auth, { bearer: { token: "alpha-secret" } });
    assertEquals(betaSecurity?.auth, { bearer: { token: "beta-secret" } });
    assertEquals(alphaSecurity?.cors, {
      origin: ["https://alpha-project.client.example"],
    });
    assertEquals(betaSecurity?.cors, {
      origin: ["https://beta-project.client.example"],
    });
    // CSP now travels on the request-scoped securityConfig rather than a
    // parallel pre-serialized copy, so tenant isolation is asserted there.
    assertEquals(alphaSecurity?.csp, {
      defaultSrc: ["https://alpha-project.assets.example"],
    });
    assertEquals(betaSecurity?.csp, {
      defaultSrc: ["https://beta-project.assets.example"],
    });
    assertEquals(Object.isFrozen(alphaSecurity), true);
    assertEquals(Object.isFrozen(betaSecurity), true);
    assertEquals(alphaSecurity === betaSecurity, false);
  });

  it("enables the production CSRF default for hosted project config", async () => {
    const adapter = createHostedConfigAdapter("export default {};");
    const req = new Request("http://production-project.production.veryfront.com/page", {
      headers: {
        "x-project-slug": "production-project",
        "x-project-id": "proj-production-security",
        "x-token": "proxy-token",
        "x-release-id": "rel-production-security",
      },
    });
    const url = new URL(req.url);
    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      headers: extractRequestHeaders(req, url, true, true),
      requestContext: createRequestContext(req, { proxyTrusted: true }),
      isProxyMode: true,
      proxyTrust: { proxyTrusted: true },
      projectIdentity: {
        projectSlug: "production-project",
        projectId: "proj-production-security",
        releaseId: "rel-production-security",
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    assertEquals(result.environment.resolvedEnvironment, "production");
    assertEquals(result.handlerContext?.securityConfig?.csrf, true);
    assertEquals(result.handlerContext?.securityConfig?.cors, false);
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
      allowHostProjectCodeExecution: true,
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
    assertEquals(
      standaloneProduction.handlerContext.allowHostProjectCodeExecution,
      true,
    );
    assertEquals(standaloneProduction.handlerContext.isProxyMode, false);
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

  it("honors host-level forwarded trust when runtime proxy trust is unresolved", async () => {
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    __resetLoggerConfigForTests();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    const req = new Request("http://internal.local/page", {
      headers: {
        host: "internal.local",
        "x-forwarded-host": "remote-project.production.veryfront.com",
        "x-project-slug": "remote-project",
        "x-project-id": "proj-remote",
      },
    });
    const url = new URL(req.url);

    await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      headers: extractRequestHeaders(req, url, undefined),
      requestContext: createRequestContext(req, { proxyTrusted: undefined }),
      isProxyMode: true,
      proxyTrust: { proxyTrusted: undefined },
      projectIdentity: {
        projectSlug: "remote-project",
        projectId: "proj-remote",
        releaseId: undefined,
        environmentName: "Production",
        proxyEnv: "production",
        parsedDomain: defaultParsedDomain,
      },
    }));

    const warning = entries.find((entry) =>
      entry.component === "environment-resolution" &&
      entry.message === "No active release found (proxy mode)"
    );
    assertEquals(warning?.context?.host, "remote-project.production.veryfront.com");
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
    __resetLoggerConfigForTests();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    let outerContextCalls = 0;
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
    assertEquals(result.adapter.config, undefined);
    assertEquals(result.handlerContext?.config, undefined);
    // A config-less control-plane request is the intended shape, so it must
    // stay distinguishable from a project whose config failed to resolve.
    assertEquals(result.adapter.configOutcome, "deferred");
    // And it must stay silent. The exclusion is the whole reason the outcome
    // is threaded through: without it this path would warn on every
    // control-plane request and drown the signal it exists to carry.
    assertEquals(
      entries.filter((entry) => entry.message.includes("serving platform-default security headers"))
        .length,
      0,
    );
  });

  it("records the security fallback when a proxied request resolves no project config", async () => {
    // No proxy token, so no project-specific config load runs at all and the
    // caller's (absent) config stands. The response still gets security
    // headers -- from the process-wide config rather than the project's.
    const adapter = createExtendedMockAdapter();
    const req = new Request("http://localhost/page", {
      headers: {
        "x-project-slug": "proxy-project",
        "x-project-id": "proj-proxy",
      },
    });
    const url = new URL(req.url);
    const securityConfig = { allowedOrigins: ["*"] };
    __resetLoggerConfigForTests();
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    const result = await resolveProjectRuntimeContext(makeRuntimeContextInput({
      req,
      url,
      adapter,
      config: undefined,
      securityConfig,
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
    }));

    assertEquals(result.adapter.config, undefined);
    // The outcome names the branch, which is what makes the accompanying warn
    // actionable: several unrelated paths leave `config` undefined and are
    // otherwise indistinguishable at the point of the fallback.
    assertEquals(result.adapter.configOutcome, "inherited");
    // And the degradation this records: the request falls back to the
    // process-wide security config, so the response carries platform-default
    // headers in place of the project's policy.
    assertStrictEquals(result.handlerContext?.securityConfig, securityConfig);

    // The whole point of the change: this is visible above debug level, and
    // carries the branch that produced the absent config.
    const warning = entries.find((entry) =>
      entry.level === "warn" &&
      entry.message.includes("serving platform-default security headers")
    );
    assertExists(warning);
    assertEquals(
      (warning.context as Record<string, unknown> | undefined)?.configOutcome,
      "inherited",
    );
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
