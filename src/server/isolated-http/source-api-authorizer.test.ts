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
  sourceToken: "source-only-token",
};
const source = { release_id: authority.releaseId, data: [] };
const environment = {
  id: authority.environmentId,
  name: authority.environmentName,
  active_release_id: authority.releaseId,
};
const project = {
  id: authority.projectId,
  slug: authority.projectSlug,
  environments: [environment],
};
const signal = () => new AbortController().signal;
const readProjectToken = async () => "host-only-read-token";
function setup(
  fetch: typeof globalThis.fetch,
  reader: (projectId: string, signal: AbortSignal) => Promise<string> = readProjectToken,
) {
  return createRuntimeSourceAuthorizer({
    baseUrl: "https://api.example",
    fetch,
    readProjectToken: reader,
  });
}
describe("runtime source API authorization", () => {
  it("checks exact caller source access before using the host-only project reader", async () => {
    const calls: string[] = [];
    const authorize = setup(async (url, init) => {
      const parsed = new URL(String(url));
      calls.push(parsed.pathname);
      const headers = new Headers((init as RequestInit).headers);
      assertEquals((init as RequestInit).redirect, "error");
      if (calls.length === 1) {
        assertEquals(
          parsed.pathname,
          `/projects/${authority.projectId}/releases/${authority.releaseId}/files`,
        );
        assertEquals(parsed.searchParams.get("limit"), "1");
        assertEquals(parsed.searchParams.get("fields"), "(id)");
        assertEquals(headers.get("authorization"), `Bearer ${authority.sourceToken}`);
        return Response.json(source);
      }
      assertEquals(parsed.pathname, `/projects/${authority.projectId}`);
      assertEquals(headers.get("authorization"), "Bearer host-only-read-token");
      return Response.json(project);
    }, async (id) => {
      assertEquals(id, authority.projectId);
      assertEquals(calls.length, 1);
      return "host-only-read-token";
    });
    await authorize(authority, signal());
    assertEquals(calls.length, 2);
  });
  it("never reads project credentials or metadata after failed source authorization", async () => {
    let reads = 0;
    const authorize = setup(async () => new Response(null, { status: 403 }), async () => {
      reads++;
      return "private-read-token";
    });
    await assertRejects(() => authorize(authority, signal()));
    assertEquals(reads, 0);
  });
  it("refuses mismatched release context and source body disclosure before the project read", async () => {
    for (
      const value of [{ ...source, release_id: authority.projectId }, {
        ...source,
        data: [{ id: "file", content: "must-not-read" }],
      }, { data: [] }]
    ) {
      let reads = 0;
      const authorize = setup(async () => Response.json(value), async () => {
        reads++;
        return "reader";
      });
      await assertRejects(() => authorize(authority, signal()));
      assertEquals(reads, 0);
    }
  });
  it("refuses foreign project, environment, release, duplicate bindings and missing deployment", async () => {
    for (
      const value of [
        { ...project, id: "foreign" },
        { ...project, slug: "foreign" },
        { ...project, environments: [] },
        { ...project, environments: [{ ...environment, name: "foreign" }] },
        { ...project, environments: [{ ...environment, active_release_id: null }] },
        { ...project, environments: [environment, environment] },
      ]
    ) {
      let calls = 0;
      const authorize = setup(async () => Response.json(++calls === 1 ? source : value));
      await assertRejects(() => authorize(authority, signal()));
    }
  });
  it("refuses redirects, malformed, oversized and non-JSON source responses", async () => {
    for (
      const response of [
        new Response(null, { status: 302 }),
        new Response("{}"),
        new Response("bad", { headers: { "content-type": "application/json" } }),
        new Response("x".repeat(17000), { headers: { "content-type": "application/json" } }),
      ]
    ) await assertRejects(() => setup(async () => response)(authority, signal()));
  });
  it("refuses mutable aliases and cancelled requests before transmitting credentials", async () => {
    let calls = 0;
    const authorize = setup(async () => {
      calls++;
      return Response.json(source);
    });
    await assertRejects(() => authorize({ ...authority, releaseId: "latest" }, signal()));
    const c = new AbortController();
    c.abort();
    await assertRejects(() => authorize(authority, c.signal));
    assertEquals(calls, 0);
  });
  it("requires fixed HTTPS origins and a host-owned credential reader", () => {
    for (
      const baseUrl of [
        "http://api.example",
        "https://user:private@api.example",
        "https://api.example/path",
      ]
    ) assertThrows(() => createRuntimeSourceAuthorizer({ baseUrl, readProjectToken }), TypeError);
    assertThrows(
      () =>
        createRuntimeSourceAuthorizer({
          baseUrl: "https://api.example",
          readProjectToken: undefined as never,
        }),
      TypeError,
    );
  });
  it("owns one finite deadline and sanitizes credential-bearing transport errors", async () => {
    const caller = new AbortController();
    const fallback = setTimeout(() => caller.abort(), 1000);
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      readProjectToken,
      timeoutMs: 5,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          (init as RequestInit).signal!.addEventListener("abort", () =>
            reject(new Error(authority.sourceToken)), { once: true });
        }),
    });
    try {
      const error = await assertRejects(
        () => authorize(authority, caller.signal),
        Error,
        "Runtime source authorization failed",
      );
      assertEquals(String(error).includes(authority.sourceToken), false);
      assertEquals(caller.signal.aborted, false);
    } finally {
      clearTimeout(fallback);
    }
  });
  it("refuses a denied or malformed host project credential without exposing either credential", async () => {
    let calls = 0;
    const denied = setup(async () =>
      ++calls === 1 ? Response.json(source) : new Response(null, { status: 403 })
    );
    await assertRejects(() => denied(authority, signal()));
    assertEquals(calls, 2);
    calls = 0;
    const missing = setup(async () => {
      calls++;
      return Response.json(source);
    }, async () => "");
    await assertRejects(() => missing(authority, signal()));
    assertEquals(calls, 1);
  });
});
