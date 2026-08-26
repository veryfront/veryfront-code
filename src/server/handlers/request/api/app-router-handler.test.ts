import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../../types.ts";
import { handleAppRouter } from "./app-router-handler.ts";

describe("server API app-router compatibility handler", () => {
  it("fails closed before shared route discovery or module import", async () => {
    let filesystemCalls = 0;
    const ctx = {
      projectDir: "/remote/project",
      adapter: {
        fs: {
          isMultiProjectMode: () => true,
          stat: () => {
            filesystemCalls++;
            throw new Error("shared app route reached filesystem discovery");
          },
        },
      },
      securityConfig: null,
    } as unknown as HandlerContext;

    const response = await handleAppRouter(
      new Request("https://tenant.example/api/private"),
      "/api/private",
      ctx,
    );

    assertEquals(response?.status, 503);
    assertEquals(response?.headers.get("cache-control"), "no-store");
    assertEquals(response?.headers.get("content-type"), "application/problem+json");
    assertEquals(filesystemCalls, 0);
  });

  it("honours a host grant for shared route discovery", async () => {
    // An explicit operator grant from the host-owned entrypoint reaches this
    // surface (veryfront-issue-inbox#848): route discovery runs against project
    // source instead of failing closed with the ungranted 503 above. No route
    // exists in the fixture, so the handler yields to the next one.
    let filesystemCalls = 0;
    const ctx = {
      projectDir: "/remote/project",
      adapter: {
        fs: {
          isMultiProjectMode: () => true,
          stat: () => {
            filesystemCalls++;
            throw new Error("not found");
          },
        },
      },
      securityConfig: null,
      allowHostProjectCodeExecution: true,
    } as unknown as HandlerContext;

    const response = await handleAppRouter(
      new Request("https://tenant.example/api/private"),
      "/api/private",
      ctx,
    );

    assertEquals(response, null);
    assertEquals(
      filesystemCalls > 0,
      true,
      "the grant must reach route discovery",
    );
  });
});
