import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { handleProjectsAPI } from "./api.ts";

function createContext(): HandlerContext {
  return {
    adapter: { fs: {} },
    isLocalProject: true,
    securityConfig: null,
  } as unknown as HandlerContext;
}

describe("handleProjectsAPI", () => {
  it("derives a validated navigation port from the request URL", async () => {
    const response = handleProjectsAPI(
      new Request("http://lvh.me:3001/_projects/api/config", {
        headers: { host: "attacker.example:4444" },
      }),
      createContext(),
    );

    assertExists(response);
    assertEquals(await response.json(), {
      domain: "lvh.me",
      port: "3001",
      hasToken: false,
    });
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("rejects unauthorized origins and unsupported methods", () => {
    const remote = handleProjectsAPI(
      new Request("http://devbox.example/_projects/api/config"),
      createContext(),
    );
    const crossOrigin = handleProjectsAPI(
      new Request("http://lvh.me:3001/_projects/api/config", {
        headers: { origin: "http://localhost:3001" },
      }),
      createContext(),
    );
    const wrongMethod = handleProjectsAPI(
      new Request("http://lvh.me/_projects/api/config", { method: "POST" }),
      createContext(),
    );

    assertEquals(remote?.status, 401);
    assertEquals(crossOrigin?.status, 401);
    assertEquals(wrongMethod?.status, 405);
    assertEquals(wrongMethod?.headers.get("allow"), "GET");
  });
});
