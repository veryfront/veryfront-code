import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { DebugContextHandler } from "./debug-context.handler.ts";

function createContext(isLocalProject = true): HandlerContext {
  return {
    adapter: {
      fs: {
        constructor: { name: "SensitiveAdapterName" },
        getUnderlyingAdapter: () => ({
          getManagerStats: () => ({ secretSessionId: "manager-session" }),
        }),
        isMultiProjectMode: () => true,
      },
    },
    cspUserHeader: null,
    isLocalProject,
    parsedDomain: { branch: "private-branch", hostname: "private.example" },
    projectDir: "/private/workspace/project",
    projectId: "project-id",
    projectSlug: "project-slug",
    proxyToken: "proxy-secret",
    releaseId: "release-id",
    requestContext: {
      branch: "private-branch",
      mode: "preview",
      slug: "project-slug",
      token: "request-secret",
    },
    securityConfig: null,
  } as unknown as HandlerContext;
}

function assertSafeDiagnosticValues(value: unknown): void {
  if (typeof value === "boolean") return;
  if (typeof value === "number") {
    assertEquals(Number.isSafeInteger(value) && value >= 0, true);
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) assertSafeDiagnosticValues(nested);
    return;
  }
  throw new Error(`Unsafe debug context value type: ${typeof value}`);
}

describe("DebugContextHandler", () => {
  it("does not handle the debug endpoint for a remote project", async () => {
    const result = await new DebugContextHandler().handle(
      new Request("http://localhost/_vf_debug/context"),
      createContext(false),
    );

    assertEquals(result.continue, true);
    assertEquals(result.response, undefined);
  });

  it("rejects non-loopback and cross-origin requests", async () => {
    const handler = new DebugContextHandler();
    const nonLoopback = await handler.handle(
      new Request("http://devbox.example/_vf_debug/context"),
      createContext(),
    );
    const crossOrigin = await handler.handle(
      new Request("http://localhost:3000/_vf_debug/context", {
        headers: { origin: "http://127.0.0.1:4000" },
      }),
      createContext(),
    );

    assertExists(nonLoopback.response);
    assertEquals(nonLoopback.response.status, 401);
    assertEquals(nonLoopback.response.headers.get("cache-control"), "no-store");
    assertEquals(nonLoopback.response.headers.get("x-content-type-options"), "nosniff");
    assertExists(crossOrigin.response);
    assertEquals(crossOrigin.response.status, 401);
  });

  it("rejects an origin-less browser request identified as cross-site", async () => {
    const result = await new DebugContextHandler().handle(
      new Request("http://localhost/_vf_debug/context", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
      createContext(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 401);
  });

  it("allows only GET", async () => {
    const result = await new DebugContextHandler().handle(
      new Request("http://localhost/_vf_debug/context", { method: "POST" }),
      createContext(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 405);
    assertEquals(result.response.headers.get("allow"), "GET");
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
  });

  it("returns only safe booleans and bounded counts", async () => {
    const request = new Request(
      "http://localhost/_vf_debug/context?session=private-session",
      { headers: { "x-token": "header-secret" } },
    );
    const result = await new DebugContextHandler().handle(request, createContext());

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");

    const text = await result.response.text();
    for (
      const sensitive of [
        "private-session",
        "header-secret",
        "proxy-secret",
        "/private/workspace/project",
        "project-id",
        "project-slug",
        "release-id",
        "private-branch",
        "private.example",
        "manager-session",
        "SensitiveAdapterName",
        "token",
        "projectDir",
        "managerStats",
      ]
    ) {
      assertEquals(text.includes(sensitive), false, `response exposed ${sensitive}`);
    }
    assertSafeDiagnosticValues(JSON.parse(text));
  });
});
