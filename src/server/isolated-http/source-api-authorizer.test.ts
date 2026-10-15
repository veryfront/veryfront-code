import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
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
  it("honors the established 64KiB project credential limit", async () => {
    for (const length of [8193, 65536]) {
      const token = "a".repeat(length);
      let projectReads = 0;
      const authorize = setup(async (url, init) => {
        if (String(url).includes("/releases/")) return Response.json(source);
        projectReads++;
        assertEquals(
          new Headers((init as RequestInit).headers).get("authorization"),
          `Bearer ${token}`,
        );
        return Response.json(project);
      }, async () => token);
      await authorize(authority, signal());
      assertEquals(projectReads, 1);
    }
    let projectReads = 0;
    const authorize = setup(async (url) => {
      if (!String(url).includes("/releases/")) projectReads++;
      return Response.json(source);
    }, async () => "a".repeat(65537));
    await assertRejects(() => authorize(authority, signal()));
    assertEquals(projectReads, 0);
  });
  it("cancels denied and malformed API bodies at both source and project reads", async () => {
    for (const stage of ["source", "project"]) {
      for (const status of [401, 403, 200]) {
        let cancelled = 0;
        const response = new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
            },
          }),
          {
            status,
            headers: { "content-type": status === 200 ? "text/plain" : "application/json" },
          },
        );
        const authorize = setup(async (url) =>
          stage === "project" && String(url).includes("/releases/")
            ? Response.json(source)
            : response
        );
        await assertRejects(() => authorize(authority, signal()));
        assertEquals(cancelled, 1);
      }
    }
  });
  it("retains bounded ownership while response cancellation ignores the deadline", async () => {
    using time = new FakeTime(1_000_000);
    const cancellation = Promise.withResolvers<void>();
    let calls = 0, cancelled = 0;
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      timeoutMs: 5,
      maxPendingOperations: 1,
      readProjectToken,
      fetch: async () => {
        calls++;
        return new Response(
          new ReadableStream({
            cancel() {
              cancelled++;
              return cancellation.promise;
            },
          }),
          { status: 403 },
        );
      },
    });
    try {
      const rejected = assertRejects(() => authorize(authority, signal()));
      await time.tickAsync(5);
      await rejected;
      assertEquals(cancelled, 1);
      assertEquals(authorize.pending, 1);
      await assertRejects(() => authorize(authority, signal()));
      assertEquals(calls, 1);
      let done = false;
      const settled = authorize.settled.then(() => {
        done = true;
      });
      await Promise.resolve();
      assertEquals(done, false);
      cancellation.resolve();
      await settled;
      assertEquals(authorize.pending, 0);
    } finally {
      cancellation.resolve();
      await authorize.settled;
    }
  });
  it("holds finite credential admission until cancelled raw reads retire", async () => {
    using time = new FakeTime(1_000_000);
    const reader = Promise.withResolvers<string>();
    let calls = 0;
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      timeoutMs: 5,
      maxPendingOperations: 1,
      fetch: async (url) => Response.json(String(url).includes("/releases/") ? source : project),
      readProjectToken: () => ++calls === 1 ? reader.promise : Promise.resolve("host-reader"),
    });
    try {
      const rejected = assertRejects(() => authorize(authority, signal()));
      await time.tickAsync(5);
      await rejected;
      await assertRejects(() => authorize(authority, signal()));
      assertEquals(calls, 1);
      assertEquals(authorize.pending, 1);
      reader.resolve("host-reader");
      await authorize.settled;
      await authorize(authority, signal());
      assertEquals(calls, 2);
      for (const maxPendingOperations of [0, 1.5, 65, Infinity]) {
        assertThrows(
          () =>
            createRuntimeSourceAuthorizer({
              baseUrl: "https://api.example",
              maxPendingOperations,
              readProjectToken,
            }),
          TypeError,
        );
      }
    } finally {
      reader.resolve("host-reader");
      await authorize.settled;
    }
  });
  it("enforces the credential deadline while retaining raw reader settlement", async () => {
    using time = new FakeTime(1_000_000);
    const reader = Promise.withResolvers<string>();
    const authorize = createRuntimeSourceAuthorizer({
      baseUrl: "https://api.example",
      timeoutMs: 5,
      fetch: async () => Response.json(source),
      readProjectToken: () => reader.promise,
    });
    const attempt = authorize(authority, signal());
    const rejected = assertRejects(() => attempt);
    try {
      await time.tickAsync(5);
      await rejected;
      assertEquals(authorize.pending, 1);
      let settled = false;
      const owned = authorize.settled.then(() => {
        settled = true;
      });
      await Promise.resolve();
      assertEquals(settled, false);
      reader.resolve("host-reader");
      await owned;
      assertEquals(authorize.pending, 0);
    } finally {
      reader.resolve("host-reader");
      await attempt.catch(() => {});
    }
  });
  it("accepts the proxy routing environment bound and refuses oversized metadata", async () => {
    const environments = [
      environment,
      ...Array.from({ length: 999 }, (_, index) => ({
        id: `40000000-4000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `environment-${index}`,
        active_release_id: authority.releaseId,
      })),
    ];
    const selected = { ...project, environments };
    const run = (value: unknown) =>
      setup(async (url) =>
        Response.json(
          String(url).includes("/releases/") ? source : value,
        )
      )(authority, signal());
    await run(selected);
    await assertRejects(() =>
      run({
        ...selected,
        environments: [...environments, { ...environment, id: authority.projectId }],
      })
    );
    await assertRejects(() => run({ ...selected, extra: "x".repeat(512 * 1024) }));
  });
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
    using time = new FakeTime(1_000_000);
    const caller = new AbortController();
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
      const rejected = assertRejects(
        () => authorize(authority, caller.signal),
        Error,
        "Runtime source authorization failed",
      );
      await time.tickAsync(5);
      const error = await rejected;
      assertEquals(String(error).includes(authority.sourceToken), false);
      assertEquals(caller.signal.aborted, false);
    } finally {
      await authorize.settled;
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
