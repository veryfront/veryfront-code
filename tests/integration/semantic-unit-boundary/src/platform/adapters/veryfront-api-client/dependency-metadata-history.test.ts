import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontAPIOperations } from "#veryfront/platform/adapters/veryfront-api-client/operations.ts";

const PROJECT_ID = "10000000-1000-4000-8000-100000000001";

function createOps(token = "project-token", maxRetries = 0): VeryfrontAPIOperations {
  return new VeryfrontAPIOperations(
    "https://api.example.com",
    token,
    { maxRetries, initialDelay: 1, maxDelay: 1 },
    PROJECT_ID,
  );
}

function response(branch: string | null = null): Record<string, unknown> {
  return {
    version: 1,
    project_id: PROJECT_ID,
    branch,
    entries: [{ dependencies: { react: "19.1.0" }, expires_at: 1_800_000_000_000 }],
  };
}

describe("dependency metadata history API", () => {
  afterEach(() => restoreMockFetch());

  it("omits the branch query for main and uses the existing bearer token", async () => {
    let requestedUrl = "";
    let authorization = "";
    installMockFetch((_input, init) => {
      requestedUrl = String(_input);
      authorization =
        new Headers(init && "headers" in init ? init.headers : undefined).get("authorization") ??
          "";
      return Promise.resolve(Response.json(response()));
    });

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      null,
    );

    assertEquals(new URL(requestedUrl).pathname, "/projects/project-slug/dependencies/history");
    assertEquals(new URL(requestedUrl).search, "");
    assertEquals(authorization, "Bearer project-token");
    assertEquals(requestedUrl.includes("/internal/"), false);
    assertEquals(history, {
      version: 1,
      projectId: PROJECT_ID,
      branch: null,
      entries: [{ dependencies: { react: "19.1.0" }, expiresAt: 1_800_000_000_000 }],
    });
  });

  it("preserves a named branch exactly in the query and response", async () => {
    let requestedUrl = "";
    const branch = "Feature/Exact Case";
    installMockFetch((input) => {
      requestedUrl = String(input);
      return Promise.resolve(Response.json(response(branch)));
    });

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      branch,
    );

    assertEquals(new URL(requestedUrl).searchParams.get("branch"), branch);
    assertEquals(history.branch, branch);
  });

  it("preserves dependency names that overlap object internals", async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response(
          `{"version":1,"project_id":"${PROJECT_ID}","branch":null,"entries":[{"dependencies":{"__proto__":"proto-version","constructor":"constructor-version","toJSON":"json-version"},"expires_at":1800000000000}]}`,
          { headers: { "Content-Type": "application/json" } },
        ),
      )
    );

    const history = await createOps().readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      null,
    );
    const entry = history.entries[0];
    assertExists(entry);
    const dependencies = entry.dependencies;

    assertEquals(Object.getPrototypeOf(dependencies), null);
    assertEquals("hasOwnProperty" in dependencies, false);
    assertEquals("valueOf" in dependencies, false);
    assertEquals(Object.keys(dependencies).sort(), ["__proto__", "constructor", "toJSON"]);
    assertEquals(
      Object.getOwnPropertyDescriptor(dependencies, "__proto__")?.value,
      "proto-version",
    );
    assertEquals(
      Object.getOwnPropertyDescriptor(dependencies, "constructor")?.value,
      "constructor-version",
    );
    assertEquals(Object.getOwnPropertyDescriptor(dependencies, "toJSON")?.value, "json-version");
  });

  for (const method of ["map", Symbol.iterator] as const) {
    it(`does not expose authenticated metadata to a replaced Array ${String(method)}`, async () => {
      const marker = "private-history-package";
      const prepared = Response.json({
        ...response(),
        entries: [{ dependencies: { [marker]: "1.0.0" }, expires_at: 1_800_000_000_000 }],
      });
      installMockFetch(() => Promise.resolve(prepared));
      const ops = createOps();
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, method);
      assertExists(descriptor);
      const apply = Reflect.apply;
      const some = Array.prototype.some;
      const getOwn = Object.getOwnPropertyDescriptor;
      const define = Object.defineProperty;
      let exposed = false;
      const hasMarker = (value: unknown): boolean => {
        if (value === marker) return true;
        if (value === null || typeof value !== "object") return false;
        const dependencies = getOwn(value, "dependencies")?.value;
        return dependencies !== null && typeof dependencies === "object" &&
          getOwn(dependencies, marker)?.value === "1.0.0";
      };
      define(Array.prototype, method, {
        ...descriptor,
        value: function (this: readonly unknown[], ...args: unknown[]) {
          if (apply(some, this, [hasMarker])) exposed = true;
          return apply(descriptor.value, this, args);
        },
      });
      let history: Awaited<ReturnType<typeof ops.readDependencyMetadataHistory>>;
      try {
        history = await ops.readDependencyMetadataHistory("project-slug", PROJECT_ID, null);
      } finally {
        define(Array.prototype, method, descriptor);
      }
      assertEquals(exposed, false);
      assertEquals(history.entries[0]?.dependencies[marker], "1.0.0");
    });
  }

  it("parses authenticated history without calling a replaced JSON parser", async () => {
    const marker = "private-history-package";
    const prepared = Response.json({
      ...response(),
      entries: [{ dependencies: { [marker]: "1.0.0" }, expires_at: 1_800_000_000_000 }],
    });
    installMockFetch(() => Promise.resolve(prepared));
    const ops = createOps();
    const descriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
    assertExists(descriptor);
    const apply = Reflect.apply;
    const define = Object.defineProperty;
    let exposed = false;
    define(JSON, "parse", {
      ...descriptor,
      value: function (...args: unknown[]) {
        if (typeof args[0] === "string" && args[0].includes(marker)) exposed = true;
        return apply(descriptor.value, JSON, args);
      },
    });
    let history: Awaited<ReturnType<typeof ops.readDependencyMetadataHistory>>;
    try {
      history = await ops.readDependencyMetadataHistory("project-slug", PROJECT_ID, null);
    } finally {
      define(JSON, "parse", descriptor);
    }
    assertEquals(exposed, false);
    assertEquals(history.entries[0]?.dependencies[marker], "1.0.0");
  });

  it("does not attach malformed successful JSON content to diagnostics", async () => {
    const marker = "private-history-content";
    installMockFetch(() => Promise.resolve(new Response(marker)));
    const error = await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null),
      Error,
    );
    assertInstanceOf(error, Error);
    assertEquals(error.message.includes(marker), false);
    assertEquals(error.cause, undefined);
  });

  it("cancels a stalled response body through the caller signal", async () => {
    let observedSignal: AbortSignal | null | undefined;
    let bodyReads = 0;
    let bodyCancellations = 0;
    let markBodyRead!: () => void;
    const bodyRead = new Promise<void>((resolve) => {
      markBodyRead = resolve;
    });
    installMockFetch((_input, init) => {
      observedSignal = init && "signal" in init ? init.signal : undefined;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            pull() {
              bodyReads++;
              markBodyRead();
              return new Promise<void>(() => {});
            },
            cancel() {
              bodyCancellations++;
            },
          }),
        ),
      );
    });
    const controller = new AbortController();
    const cancellation = new Error("history read cancelled");
    const request = createOps("project-token", 2).readDependencyMetadataHistory(
      "project-slug",
      PROJECT_ID,
      null,
      controller.signal,
    );
    await bodyRead;

    controller.abort(cancellation);

    await assertRejects(() => request, Error, "history read cancelled");
    assertEquals(observedSignal?.aborted, true);
    assertEquals(bodyReads, 1);
    assertEquals(bodyCancellations, 1);
  });

  it("rejects an already-aborted signal before starting the request", async () => {
    let fetchCalls = 0;
    installMockFetch(() => {
      fetchCalls++;
      return Promise.resolve(Response.json(response()));
    });
    const controller = new AbortController();
    const cancellation = new DOMException("history read already cancelled", "AbortError");
    controller.abort(cancellation);

    await assertRejects(
      () =>
        createOps().readDependencyMetadataHistory(
          "project-slug",
          PROJECT_ID,
          null,
          controller.signal,
        ),
      DOMException,
      "history read already cancelled",
    );
    assertEquals(fetchCalls, 0);
  });

  it("normalizes an explicit main branch to the omitted query", async () => {
    let requestedUrl = "";
    installMockFetch((input) => {
      requestedUrl = String(input);
      return Promise.resolve(Response.json(response()));
    });

    await createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "main");

    assertEquals(new URL(requestedUrl).searchParams.has("branch"), false);
  });

  it("rejects response identity mismatches", async () => {
    installMockFetch(() =>
      Promise.resolve(Response.json({
        ...response("expected"),
        project_id: "20000000-2000-4000-8000-200000000002",
      }))
    );

    await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "expected"),
      Error,
      "identity",
    );

    restoreMockFetch();
    installMockFetch(() => Promise.resolve(Response.json(response("other"))));
    await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, "expected"),
      Error,
      "identity",
    );
  });

  it("rejects invalid entries and more than sixteen candidates", async () => {
    for (
      const entries of [
        [{ dependencies: { react: 19 }, expires_at: 1_800_000_000_000 }],
        Array.from({ length: 17 }, () => ({ dependencies: {}, expires_at: 1_800_000_000_000 })),
        [{ dependencies: {}, expires_at: 1.5 }],
      ]
    ) {
      installMockFetch(() => Promise.resolve(Response.json({ ...response(), entries })));
      await assertRejects(() =>
        createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null)
      );
      restoreMockFetch();
    }
  });

  it("bounds the response body before materializing it", async () => {
    const oversized = JSON.stringify({ ...response(), padding: "x".repeat(1024 * 1024) });
    installMockFetch(() => Promise.resolve(new Response(oversized)));

    const error = await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null),
      Error,
    );
    assertStringIncludes(String(error), "exceeded");
  });

  it("propagates API errors without retaining the response body in diagnostics", async () => {
    installMockFetch(() =>
      Promise.resolve(
        new Response('{"credential":"must-not-escape"}', {
          status: 403,
          statusText: "Forbidden",
        }),
      )
    );

    const error = await assertRejects(
      () => createOps().readDependencyMetadataHistory("project-slug", PROJECT_ID, null),
      Error,
    );
    assertStringIncludes(String(error), "403 Forbidden");
    assertEquals(String(error).includes("must-not-escape"), false);
  });
});
