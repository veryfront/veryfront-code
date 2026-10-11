import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRuntimeSourceAuthorizer } from "./source-api-authorizer.ts";
const authority = {
  projectId: "10000000-1000-4000-8000-100000000001",
  projectSlug: "example",
  environmentId: "20000000-2000-4000-8000-200000000002",
  environmentName: "production",
  releaseId: "30000000-3000-4000-8000-300000000003",
  sourceToken: "private-source-token",
};
const result = {
  project_id: authority.projectId,
  project_slug: authority.projectSlug,
  environment_id: authority.environmentId,
  environment_name: authority.environmentName,
  release_id: authority.releaseId,
};
const json = (value: unknown) => Response.json(value);
const signal = () => new AbortController().signal;
describe("runtime source API authorization", () => {
  it("uses one fixed origin, an exact source path and the existing scoped bearer", async () => {
    let calls = 0;
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      fetch: async (url, init) => {
        calls++;
        assertEquals(
          String(url),
          `https://api.example/projects/${authority.projectId}/releases/${authority.releaseId}/runtime-binding?environment_id=${authority.environmentId}`,
        );
        assertEquals((init as RequestInit)?.redirect, "error");
        assertEquals((init as RequestInit)?.credentials, "omit");
        assertEquals(
          new Headers((init as RequestInit)?.headers).get("authorization"),
          `Bearer ${authority.sourceToken}`,
        );
        return json(result);
      },
    });
    await authorize(authority, signal());
    assertEquals(calls, 1);
  });
  it("rejects every mismatched identity and unexpected response authority", async () => {
    for (const key of Object.keys(result)) {
      const authorize = createRuntimeSourceAuthorizer({
        baseUrl: "https://api.example",
        fetch: async () => json({ ...result, [key]: "foreign" }),
      });
      await assertRejects(
        () => authorize(authority, signal()),
        Error,
        "Runtime source authorization failed",
      );
    }
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      fetch: async () => json({ ...result, variables: { secret: "must-not-return" } }),
    });
    await assertRejects(() => authorize(authority, signal()));
  });
  it("refuses non-success, redirects, malformed, oversized or non-JSON responses", async () => {
    const responses = [
      new Response(null, { status: 401 }),
      new Response(null, { status: 302 }),
      new Response("{}"),
      new Response("bad", { headers: { "content-type": "application/json" } }),
      new Response("x".repeat(17000), { headers: { "content-type": "application/json" } }),
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "99999" },
      }),
    ];
    for (const response of responses) {
      const authorize = createRuntimeSourceAuthorizer({
        baseUrl: "https://api.example",
        fetch: async () => response,
      });
      await assertRejects(() => authorize(authority, signal()));
    }
  });
  it("refuses mutable aliases and cancelled requests before transmitting credentials", async () => {
    let calls = 0;
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      fetch: async () => {
        calls++;
        return json(result);
      },
    });
    await assertRejects(() => authorize({ ...authority, releaseId: "latest" }, signal()));
    const c = new AbortController();
    c.abort();
    await assertRejects(() => authorize(authority, c.signal));
    assertEquals(calls, 0);
  });
  it("requires HTTPS origins without redirects or URL credentials", () => {
    for (
      const baseUrl of [
        "http://api.example",
        "https://user:password@api.example",
        "https://api.example/path",
        "https://api.example?query=1",
      ]
    ) {
      assertThrows(() => createRuntimeSourceAuthorizer({ baseUrl }), TypeError);
    }
  });
  it("owns a finite deadline independently of caller cancellation and sanitizes transport failures", async () => {
    const caller = new AbortController();
    const fallback = setTimeout(() => caller.abort(), 1000);
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          const pendingSignal = (init as RequestInit).signal!;
          pendingSignal.addEventListener("abort", () => reject(new Error(authority.sourceToken)), {
            once: true,
          });
        }),
    });
    try {
      const error = await assertRejects(
        () => authorize(authority, caller.signal),
        Error,
        "Runtime source authorization failed",
      );
      assertEquals(String(error).includes(authority.sourceToken), false);
      assertEquals(
        caller.signal.aborted,
        false,
        "the source API deadline must fire before the caller boundary",
      );
    } finally {
      clearTimeout(fallback);
    }
  });
});
