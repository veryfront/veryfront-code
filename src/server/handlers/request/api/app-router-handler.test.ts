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

  it("keeps shared route discovery denied despite a host grant", async () => {
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

    assertEquals(response?.status, 503);
    assertEquals(filesystemCalls, 0);
  });
});
