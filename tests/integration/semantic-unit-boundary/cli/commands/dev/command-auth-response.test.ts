import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  replaceAmbientFetchForFaultInjection,
  withMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { validateToken } from "../../../../../../cli/auth/login.ts";
import { createConnectedDevAuthenticationOptions } from "../../../../../../cli/commands/dev/command.ts";

it("dev command authentication protects responses after project configuration executes", async () => {
  const response = Response.json({ id: "user", email: "trusted@example.com" });
  const fields = ["ok", "json"];
  const descriptors = fields.map((name) =>
    [name, Object.getOwnPropertyDescriptor(Response.prototype, name)!] as const
  );
  let calls = 0;
  const poison = () => {
    calls++;
    throw new Error("project received authentication response");
  };
  let result: unknown;
  await withMockFetch(() => Promise.resolve(response), async () => {
    let restoreAmbientFetch = () => {};
    try {
      restoreAmbientFetch = replaceAmbientFetchForFaultInjection(poison);
      for (const [name, descriptor] of descriptors) {
        Object.defineProperty(
          Response.prototype,
          name,
          "get" in descriptor ? { ...descriptor, get: poison } : { ...descriptor, value: poison },
        );
      }
      result = await validateToken("private-token", undefined, {
        apiBaseUrl: "https://api.veryfront.com",
        ...createConnectedDevAuthenticationOptions("https://api.veryfront.com"),
      });
    } finally {
      restoreAmbientFetch();
      for (const [name, descriptor] of descriptors) {
        Object.defineProperty(Response.prototype, name, descriptor);
      }
    }
  });
  assertEquals(calls, 0);
  assertEquals((result as { email: string }).email, "trusted@example.com");
});

it("dev preload protects both user and project responses after configuration executes", async () => {
  const { preloadDevAuth } = await import("../../../../../../cli/commands/dev/command.ts");
  const responses = [
    Response.json({ id: "user", email: "trusted@example.com" }),
    Response.json({ data: [{ id: "project", slug: "demo", name: "Demo" }] }),
  ];
  const fields = ["ok", "json", "text", "statusText"];
  const descriptors = fields.map((name) =>
    [name, Object.getOwnPropertyDescriptor(Response.prototype, name)!] as const
  );
  let calls = 0;
  const poison = () => {
    calls++;
    throw new Error("project received privileged discovery response");
  };
  let result: Awaited<ReturnType<typeof preloadDevAuth>> | undefined;
  await withMockFetch(() => Promise.resolve(responses.shift()!), async () => {
    let restoreAmbientFetch = () => {};
    try {
      restoreAmbientFetch = replaceAmbientFetchForFaultInjection(poison);
      for (const [name, descriptor] of descriptors) {
        Object.defineProperty(
          Response.prototype,
          name,
          "get" in descriptor ? { ...descriptor, get: poison } : { ...descriptor, value: poison },
        );
      }
      result = await preloadDevAuth("user-token");
    } finally {
      restoreAmbientFetch();
      for (const [name, descriptor] of descriptors) {
        Object.defineProperty(Response.prototype, name, descriptor);
      }
    }
  });
  assertEquals(calls, 0);
  assertEquals((result?.identity as { email: string } | null)?.email, "trusted@example.com");
  assertEquals(result?.projects[0]?.id, "project");
});

it("embedded management API client ignores project fetch and refuses cross-origin token redirects", async () => {
  const { createApiClient } = await import("../../../../../../cli/shared/config.ts");
  const response = Response.json({ secret: "trusted" });
  let ambientCalls = 0;
  await withMockFetch(() => Promise.resolve(response), async () => {
    let restoreAmbientFetch = () => {};
    restoreAmbientFetch = replaceAmbientFetchForFaultInjection(() => {
      ambientCalls++;
      throw new Error("project received token");
    });
    try {
      const client = createApiClient({
        apiUrl: "https://api.veryfront.com",
        apiToken: "private",
        projectSlug: "demo",
      }, createConnectedDevAuthenticationOptions("https://api.veryfront.com").transport);
      assertEquals(await client.get("/projects"), { secret: "trusted" });
    } finally {
      restoreAmbientFetch();
    }
  });
  assertEquals(ambientCalls, 0);
  let requests = 0;
  await withMockFetch(() => {
    requests++;
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/projects" },
      }),
    );
  }, async () => {
    const client = createApiClient({
      apiUrl: "https://api.veryfront.com",
      apiToken: "private",
      projectSlug: "demo",
    }, createConnectedDevAuthenticationOptions("https://api.veryfront.com").transport);
    let failed = false;
    try {
      await client.get("/projects");
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
  });
  assertEquals(requests, 1);
});
