import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createRequestContext } from "../context/request-context.ts";
import type { DomainLookupResult } from "../utils/domain-lookup.ts";
import type { ParsedDomain } from "#veryfront/types";
import { __injectDepsForTests, extractRequestHeaders } from "./project-resolution.ts";
import { prepareProjectRequest, resolveProjectIdentity } from "./project-runtime-context.ts";

const defaultParsedDomain: ParsedDomain = {
  slug: null,
  branch: null,
  environment: null,
  isVeryfrontDomain: false,
  isDraft: false,
  allowIframeEmbed: false,
};

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
  it("rejects unsupported runtime context operations before Task 3", async () => {
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
