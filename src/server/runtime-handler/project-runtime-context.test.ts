import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRequestContext } from "../context/request-context.ts";
import { extractRequestHeaders } from "./project-resolution.ts";
import { prepareProjectRequest } from "./project-runtime-context.ts";

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
