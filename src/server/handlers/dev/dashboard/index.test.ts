import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { DevDashboardHandler } from "./index.ts";

function createContext(isLocalProject = true): HandlerContext {
  return {
    adapter: { fs: {} },
    cspUserHeader: null,
    isLocalProject,
    securityConfig: null,
  } as unknown as HandlerContext;
}

describe("DevDashboardHandler", () => {
  for (const pathname of ["/_dev", "/_dev/ui/index.js", "/_dev/api/stats"]) {
    it(`rejects non-loopback access to ${pathname}`, async () => {
      const result = await new DevDashboardHandler().handle(
        new Request(`http://devbox.example${pathname}`),
        createContext(),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it(`rejects cross-origin browser access to ${pathname}`, async () => {
      const result = await new DevDashboardHandler().handle(
        new Request(`http://localhost:3000${pathname}`, {
          headers: { origin: "http://127.0.0.1:4000" },
        }),
        createContext(),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });
  }

  it("serves the dashboard shell only through GET", async () => {
    const result = await new DevDashboardHandler().handle(
      new Request("http://localhost/_dev", { method: "POST" }),
      createContext(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 405);
    assertEquals(result.response.headers.get("allow"), "GET");
  });

  it("serves dashboard UI modules only through GET", async () => {
    const result = await new DevDashboardHandler().handle(
      new Request("http://localhost/_dev/ui/index.js", { method: "DELETE" }),
      createContext(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 405);
    assertEquals(result.response.headers.get("allow"), "GET");
  });

  it("returns the route-specific API method when a method is not allowed", async () => {
    const handler = new DevDashboardHandler();

    const getOnly = await handler.handle(
      new Request("http://localhost/_dev/api/stats", { method: "POST" }),
      createContext(),
    );
    const postOnly = await handler.handle(
      new Request("http://localhost/_dev/api/hmr-trigger"),
      createContext(),
    );

    assertExists(getOnly.response);
    assertEquals(getOnly.response.status, 405);
    assertEquals(getOnly.response.headers.get("allow"), "GET");
    assertExists(postOnly.response);
    assertEquals(postOnly.response.status, 405);
    assertEquals(postOnly.response.headers.get("allow"), "POST");
  });

  it("serves an authorized dashboard shell without caching it", async () => {
    const result = await new DevDashboardHandler().handle(
      new Request("http://localhost:3000/_dev", {
        headers: { origin: "http://localhost:3000" },
      }),
      createContext(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(result.response.headers.get("cache-control"), "no-store");
    assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
  });
});
