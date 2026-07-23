import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { handleProjectsSurfaceRequest } from "./index.ts";

function createContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    adapter: { fs: {} },
    cspUserHeader: null,
    isLocalProject: true,
    parsedDomain: {
      slug: null,
      branch: null,
      environment: "development",
      isVeryfrontDomain: true,
      isDraft: true,
      allowIframeEmbed: true,
    },
    projectSlug: undefined,
    securityConfig: null,
    ...overrides,
  } as unknown as HandlerContext;
}

describe("handleProjectsSurfaceRequest", () => {
  for (const pathname of ["/", "/_projects", "/_projects/ui/index.js"]) {
    it(`rejects non-local access to ${pathname}`, async () => {
      const response = await handleProjectsSurfaceRequest(
        new Request(`http://devbox.example${pathname}`),
        createContext(),
      );

      assertExists(response);
      assertEquals(response.status, 401);
      assertEquals(response.headers.get("cache-control"), "no-store");
      assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    });
  }

  it("rejects cross-origin and cross-site browser requests", async () => {
    const crossOrigin = await handleProjectsSurfaceRequest(
      new Request("http://lvh.me:3000/_projects", {
        headers: { origin: "http://localhost:3000" },
      }),
      createContext(),
    );
    const crossSite = await handleProjectsSurfaceRequest(
      new Request("http://lvh.me:3000/_projects", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
      createContext(),
    );

    assertEquals(crossOrigin?.status, 401);
    assertEquals(crossSite?.status, 401);
  });

  it("allows only GET", async () => {
    const response = await handleProjectsSurfaceRequest(
      new Request("http://lvh.me/_projects", { method: "POST" }),
      createContext(),
    );

    assertExists(response);
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET");
  });

  it("serves an authorized shell with private headers", async () => {
    const response = await handleProjectsSurfaceRequest(
      new Request("http://lvh.me:3000/_projects", {
        headers: { origin: "http://lvh.me:3000" },
      }),
      createContext(),
    );

    assertExists(response);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("does not claim prefix-collision paths", async () => {
    const prefixCollision = await handleProjectsSurfaceRequest(
      new Request("http://lvh.me/_projects-private"),
      createContext(),
    );

    assertEquals(prefixCollision, null);
  });
});
