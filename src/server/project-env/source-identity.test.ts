import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  ProjectEnvironmentIdentityCache,
  type ProjectEnvironmentIdentityLookup,
  resolveProjectEnvironmentIdentity,
} from "./source-identity.ts";

interface ObservedFetchInit {
  readonly headers?: HeadersInit;
  readonly signal?: AbortSignal | null;
}

function resolveWith(
  lookup: ProjectEnvironmentIdentityLookup,
  fetchImpl: typeof globalThis.fetch,
  signal = new AbortController().signal,
) {
  return resolveProjectEnvironmentIdentity({
    apiBaseUrl: "https://api.veryfront.org",
    projectSlug: "demo-project",
    token: "request-token",
    lookup,
    signal,
    fetch: fetchImpl,
  });
}

describe("project-env/source-identity", () => {
  it("finds one exact case-insensitive name across bounded pages", async () => {
    const urls: string[] = [];
    const controller = new AbortController();
    const identity = await resolveWith(
      { kind: "name", name: "staging" },
      async (input, init) => {
        const url = new URL(String(input));
        const observedInit = init as ObservedFetchInit | undefined;
        urls.push(url.toString());
        assertEquals(observedInit?.signal, controller.signal);
        assertEquals(
          new Headers(observedInit?.headers).get("authorization"),
          "Bearer request-token",
        );
        if (url.searchParams.get("cursor") === null) {
          return Response.json({
            data: [{
              id: "env-production",
              name: "production",
              active_release_id: null,
            }],
            page_info: { next: "page-2" },
          });
        }
        return Response.json({
          data: [{
            id: "env-staging",
            name: "StAgInG",
            active_release_id: "release-staging",
          }],
          page_info: { next: null },
        });
      },
      controller.signal,
    );

    assertEquals(identity, {
      id: "env-staging",
      name: "StAgInG",
      active_release_id: "release-staging",
    });
    assertEquals(urls, [
      "https://api.veryfront.org/projects/demo-project/environments?limit=100",
      "https://api.veryfront.org/projects/demo-project/environments?limit=100&cursor=page-2",
    ]);
  });

  it("finds an exact ID and verifies optional expected source metadata", async () => {
    const identity = await resolveWith(
      {
        kind: "id",
        id: "env-preview",
        expectedName: "preview",
        expectedActiveReleaseId: null,
      },
      async () =>
        Response.json({
          data: [{
            id: "env-preview",
            name: "PrEvIeW",
            active_release_id: null,
          }],
          page_info: { next: null },
        }),
    );

    assertEquals(identity, {
      id: "env-preview",
      name: "PrEvIeW",
      active_release_id: null,
    });
  });

  it("does not let ambient Array.map poisoning substitute an unvalidated identity", async () => {
    const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map");
    if (typeof mapDescriptor?.value !== "function") {
      throw new TypeError("Array.map is unavailable");
    }
    const intrinsicMap = mapDescriptor.value as (...args: unknown[]) => unknown;
    const intrinsicIncludes = String.prototype.includes;

    Object.defineProperty(Array.prototype, "map", {
      ...mapDescriptor,
      value(this: unknown[], ...args: unknown[]) {
        const stack = new Error().stack ?? "";
        if (
          Reflect.apply(
            intrinsicIncludes,
            stack,
            ["/server/project-env/source-identity.ts:"],
          )
        ) {
          return [{
            id: "env-preview",
            name: "preview",
            active_release_id: null,
          }];
        }
        return Reflect.apply(intrinsicMap, this, args);
      },
    });

    try {
      const error = await assertRejects(
        () =>
          resolveWith(
            {
              kind: "id",
              id: "env-preview",
              expectedName: "preview",
              expectedActiveReleaseId: null,
            },
            async () =>
              Response.json({
                data: [{
                  id: "env-production",
                  name: "production",
                  active_release_id: "release-production",
                }],
                page_info: { next: null },
              }),
          ),
        VeryfrontError,
      );
      assertEquals((error as VeryfrontError).status, 404);
    } finally {
      Object.defineProperty(Array.prototype, "map", mapDescriptor);
    }
  });

  it("preserves an omitted active release distinctly from explicit null", async () => {
    const identity = await resolveWith(
      { kind: "id", id: "env-preview" },
      async () =>
        Response.json({
          data: [{ id: "env-preview", name: "preview" }],
          page_info: { next: null },
        }),
    );

    assertEquals(identity.active_release_id, undefined);
    assertEquals(Object.hasOwn(identity, "active_release_id"), true);
  });

  it("rejects duplicate identities instead of choosing one", async () => {
    const error = await assertRejects(
      () =>
        resolveWith(
          { kind: "name", name: "preview" },
          async () =>
            Response.json({
              data: [
                { id: "env-preview-1", name: "preview" },
                { id: "env-preview-2", name: "PrEvIeW" },
              ],
              page_info: { next: null },
            }),
        ),
      VeryfrontError,
    );

    assertEquals((error as VeryfrontError).status, 502);
    assertEquals((error as VeryfrontError).slug, "api-client-error");
  });

  it("rejects malformed release metadata and oversized pages", async () => {
    const malformed = await assertRejects(
      () =>
        resolveWith(
          { kind: "name", name: "preview" },
          async () =>
            Response.json({
              data: [{
                id: "env-preview",
                name: "preview",
                active_release_id: 42,
              }],
              page_info: { next: null },
            }),
        ),
      VeryfrontError,
    );
    assertEquals((malformed as VeryfrontError).status, 502);

    const oversized = await assertRejects(
      () =>
        resolveWith(
          { kind: "name", name: "preview" },
          async () =>
            new Response("{}", {
              headers: { "content-length": String(256 * 1024 + 1) },
            }),
        ),
      VeryfrontError,
    );
    assertEquals((oversized as VeryfrontError).status, 502);
  });

  it("keys cached identities by a SHA-256 credential fingerprint", async () => {
    const cache = new ProjectEnvironmentIdentityCache();
    const authorizationHeaders: string[] = [];
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      const observedInit = init as ObservedFetchInit | undefined;
      const authorization = new Headers(observedInit?.headers).get("authorization") ?? "";
      authorizationHeaders.push(authorization);
      const suffix = authorization.endsWith("token-a") ? "a" : "b";
      return Response.json({
        data: [{ id: `env-preview-${suffix}`, name: "preview" }],
        page_info: { next: null },
      });
    };
    const get = (token: string) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token,
        lookup: { kind: "name", name: "preview" },
        signal: new AbortController().signal,
        fetch: fetchImpl,
      });

    assertEquals((await get("token-a")).id, "env-preview-a");
    assertEquals((await get("token-a")).id, "env-preview-a");
    assertEquals((await get("token-b")).id, "env-preview-b");
    assertEquals(authorizationHeaders, [
      "Bearer token-a",
      "Bearer token-b",
    ]);
  });

  it("singleflights concurrent discovery without letting one waiter abort peers", async () => {
    const cache = new ProjectEnvironmentIdentityCache();
    const firstController = new AbortController();
    const secondController = new AbortController();
    let fetchCalls = 0;
    let sharedSignal: AbortSignal | null = null;
    let releaseFetch!: () => void;
    const fetchReleased = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      sharedSignal = (init as ObservedFetchInit | undefined)?.signal ?? null;
      markFetchStarted();
      await fetchReleased;
      return Response.json({
        data: [{ id: "env-preview", name: "preview" }],
        page_info: { next: null },
      });
    };
    const get = (signal: AbortSignal) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token: "shared-token",
        lookup: { kind: "name", name: "preview" },
        signal,
        fetch: fetchImpl,
      });

    const first = get(firstController.signal);
    const second = get(secondController.signal);
    await fetchStarted;
    firstController.abort(new Error("first waiter cancelled"));
    await assertRejects(() => first, Error, "first waiter cancelled");
    assertEquals((sharedSignal as AbortSignal | null)?.aborted, false);
    releaseFetch();
    assertEquals((await second).id, "env-preview");
    assertEquals(fetchCalls, 1);
  });

  it("replaces an orphaned aborted flight instead of poisoning a later live caller", async () => {
    const cache = new ProjectEnvironmentIdentityCache({
      maxInflight: 2,
      maxInflightPerProject: 2,
      fetchTimeoutMs: 1_000,
    });
    const firstController = new AbortController();
    const firstStarted = Promise.withResolvers<void>();
    let fetchCalls = 0;
    const fetchImpl: typeof globalThis.fetch = () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        firstStarted.resolve();
        return new Promise<Response>(() => {
          // Deliberately ignores the shared abort signal.
        });
      }
      return Promise.resolve(
        Response.json({
          data: [{ id: "env-preview-fresh", name: "preview" }],
          page_info: { next: null },
        }),
      );
    };
    const get = (signal: AbortSignal) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token: "shared-token",
        lookup: { kind: "name", name: "preview" },
        signal,
        fetch: fetchImpl,
      });

    const abandoned = get(firstController.signal);
    await firstStarted.promise;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    firstController.abort(new Error("first waiter left"));
    await assertRejects(() => abandoned, Error, "first waiter left");

    const replacement = await get(new AbortController().signal);
    assertEquals(replacement.id, "env-preview-fresh");
    assertEquals(fetchCalls, 2);
  });

  it("enforces a visible deadline while retaining capacity for non-cooperative work", async () => {
    let fetchCalls = 0;
    const cache = new ProjectEnvironmentIdentityCache({
      maxInflight: 1,
      maxInflightPerProject: 1,
      fetchTimeoutMs: 5,
    });
    const get = (token: string) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token,
        lookup: { kind: "name", name: "preview" },
        signal: new AbortController().signal,
        fetch: () => {
          fetchCalls += 1;
          return new Promise<Response>(() => {
            // A broken transport may ignore AbortSignal indefinitely.
          });
        },
      });

    const timeout = await assertRejects(() => get("token-a"), VeryfrontError) as VeryfrontError;
    assertEquals(timeout.status, 503);
    assertEquals(timeout.context, { code: "fetch-timeout" });

    const capacity = await assertRejects(() => get("token-b"), VeryfrontError) as VeryfrontError;
    assertEquals(capacity.status, 503);
    assertEquals(fetchCalls, 1);
  });

  it("reserves discovery capacity per project without letting one tenant starve peers", async () => {
    const cache = new ProjectEnvironmentIdentityCache({
      maxInflight: 2,
      maxInflightPerProject: 1,
      fetchTimeoutMs: 1_000,
    });
    const noisyController = new AbortController();
    const noisyStarted = Promise.withResolvers<void>();
    let fetchCalls = 0;
    const fetchImpl: typeof globalThis.fetch = (_input, init) => {
      fetchCalls += 1;
      const authorization = new Headers(
        (init as ObservedFetchInit | undefined)?.headers,
      ).get("authorization");
      if (authorization === "Bearer noisy-a") {
        noisyStarted.resolve();
        return new Promise<Response>(() => {
          // Keep one underlying slot occupied until the caller leaves.
        });
      }
      return Promise.resolve(
        Response.json({
          data: [{ id: "env-preview-peer", name: "preview" }],
          page_info: { next: null },
        }),
      );
    };
    const get = (projectSlug: string, token: string, signal = new AbortController().signal) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug,
        token,
        lookup: { kind: "name", name: "preview" },
        signal,
        fetch: fetchImpl,
      });

    const noisy = get("noisy-project", "noisy-a", noisyController.signal);
    await noisyStarted.promise;
    const sameProject = await assertRejects(
      () => get("noisy-project", "noisy-b"),
      VeryfrontError,
    ) as VeryfrontError;
    assertEquals(sameProject.status, 503);

    assertEquals(
      (await get("peer-project", "peer-token")).id,
      "env-preview-peer",
    );
    assertEquals(fetchCalls, 2);
    noisyController.abort();
    await assertRejects(() => noisy);
  });

  it("bounds cache-key hashing before the discovery admission point", async () => {
    const originalDigest = Object.getOwnPropertyDescriptor(
      SubtleCrypto.prototype,
      "digest",
    );
    if (typeof originalDigest?.value !== "function") {
      throw new TypeError("SubtleCrypto.digest is unavailable");
    }
    const digestStarted = Promise.withResolvers<void>();
    const digestResult = Promise.withResolvers<ArrayBuffer>();
    let IsolatedCache: typeof ProjectEnvironmentIdentityCache | undefined;

    Object.defineProperty(SubtleCrypto.prototype, "digest", {
      ...originalDigest,
      value() {
        digestStarted.resolve();
        return digestResult.promise;
      },
    });
    try {
      const isolatedModule = await import(
        `./source-identity.ts?bounded-key-build=${crypto.randomUUID()}`
      );
      IsolatedCache = isolatedModule.ProjectEnvironmentIdentityCache;
    } finally {
      Object.defineProperty(SubtleCrypto.prototype, "digest", originalDigest);
    }
    if (!IsolatedCache) throw new Error("Failed to load isolated identity cache");

    const cache = new IsolatedCache({
      maxInflight: 1,
      maxInflightPerProject: 1,
    });
    const fetchImpl: typeof globalThis.fetch = () =>
      Promise.resolve(
        Response.json({
          data: [{ id: "env-preview", name: "preview" }],
          page_info: { next: null },
        }),
      );
    const get = (projectSlug: string, token: string) =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug,
        token,
        lookup: { kind: "name", name: "preview" },
        signal: new AbortController().signal,
        fetch: fetchImpl,
      });

    const first = get("project-a", "token-a");
    await digestStarted.promise;
    const overflow = await assertRejects(
      () => get("project-b", "token-b"),
      VeryfrontError,
    ) as VeryfrontError;
    assertEquals(overflow.status, 503);
    digestResult.resolve(new Uint8Array(32).buffer);
    assertEquals((await first).id, "env-preview");
  });

  it("uses captured abort and listener intrinsics after shared prototypes are poisoned", async () => {
    const abortedDescriptor = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "aborted",
    );
    const throwDescriptor = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "throwIfAborted",
    );
    const addDescriptor = Object.getOwnPropertyDescriptor(
      EventTarget.prototype,
      "addEventListener",
    );
    const removeDescriptor = Object.getOwnPropertyDescriptor(
      EventTarget.prototype,
      "removeEventListener",
    );
    if (
      typeof abortedDescriptor?.get !== "function" ||
      typeof throwDescriptor?.value !== "function" ||
      typeof addDescriptor?.value !== "function" ||
      typeof removeDescriptor?.value !== "function"
    ) {
      throw new TypeError("AbortSignal/EventTarget intrinsics are unavailable");
    }

    const controller = new AbortController();
    const signal = controller.signal;
    const cache = new ProjectEnvironmentIdentityCache();
    Object.defineProperty(AbortSignal.prototype, "aborted", {
      ...abortedDescriptor,
      get() {
        throw new Error("ambient AbortSignal.aborted must not run");
      },
    });
    Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
      ...throwDescriptor,
      value() {
        throw new Error("ambient AbortSignal.throwIfAborted must not run");
      },
    });
    Object.defineProperty(EventTarget.prototype, "addEventListener", {
      ...addDescriptor,
      value() {
        throw new Error("ambient EventTarget.addEventListener must not run");
      },
    });
    Object.defineProperty(EventTarget.prototype, "removeEventListener", {
      ...removeDescriptor,
      value() {
        throw new Error("ambient EventTarget.removeEventListener must not run");
      },
    });
    try {
      const identity = await cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token: "captured-intrinsics-token",
        lookup: { kind: "name", name: "preview" },
        signal,
        fetch: () =>
          Promise.resolve(
            Response.json({
              data: [{ id: "env-preview", name: "preview" }],
              page_info: { next: null },
            }),
          ),
      });
      assertEquals(identity.id, "env-preview");
    } finally {
      Object.defineProperty(AbortSignal.prototype, "aborted", abortedDescriptor);
      Object.defineProperty(
        AbortSignal.prototype,
        "throwIfAborted",
        throwDescriptor,
      );
      Object.defineProperty(
        EventTarget.prototype,
        "addEventListener",
        addDescriptor,
      );
      Object.defineProperty(
        EventTarget.prototype,
        "removeEventListener",
        removeDescriptor,
      );
    }
  });

  it("uses captured cache primitives after ambient prototypes are poisoned", async () => {
    const mapMethods = [
      "delete",
      "get",
      "has",
      "keys",
      "set",
      "values",
    ] as const;
    const mapDescriptors = mapMethods.map((method) =>
      [
        method,
        Object.getOwnPropertyDescriptor(Map.prototype, method),
      ] as const
    );
    const mapSizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "size");
    const setMethods = ["add", "has"] as const;
    const setDescriptors = setMethods.map((method) =>
      [
        method,
        Object.getOwnPropertyDescriptor(Set.prototype, method),
      ] as const
    );
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    const thenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then");
    if (
      mapDescriptors.some(([, descriptor]) => typeof descriptor?.value !== "function") ||
      typeof mapSizeDescriptor?.get !== "function" ||
      setDescriptors.some(([, descriptor]) => typeof descriptor?.value !== "function") ||
      typeof freezeDescriptor?.value !== "function" ||
      typeof thenDescriptor?.value !== "function"
    ) {
      throw new TypeError("Cache intrinsics are unavailable");
    }

    let fetchCalls = 0;
    const cache = new ProjectEnvironmentIdentityCache();
    const get = () =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token: "captured-cache-intrinsics-token",
        lookup: { kind: "name", name: "preview" },
        signal: new AbortController().signal,
        fetch: () => {
          fetchCalls += 1;
          return Promise.resolve(
            Response.json({
              data: [{ id: "env-preview", name: "preview" }],
              page_info: { next: null },
            }),
          );
        },
      });

    // Let the test runner attach its own reaction before the ambient Promise
    // prototype is replaced inside this test.
    await Promise.resolve();
    for (const [method, descriptor] of mapDescriptors) {
      Object.defineProperty(Map.prototype, method, {
        ...descriptor,
        value() {
          throw new Error(`ambient Map.${method} must not run`);
        },
      });
    }
    Object.defineProperty(Map.prototype, "size", {
      ...mapSizeDescriptor,
      get() {
        throw new Error("ambient Map.size must not run");
      },
    });
    for (const [method, descriptor] of setDescriptors) {
      Object.defineProperty(Set.prototype, method, {
        ...descriptor,
        value() {
          throw new Error(`ambient Set.${method} must not run`);
        },
      });
    }
    Object.defineProperty(Object, "freeze", {
      ...freezeDescriptor,
      value() {
        throw new Error("ambient Object.freeze must not run");
      },
    });
    Object.defineProperty(Promise.prototype, "then", {
      ...thenDescriptor,
      value(this: Promise<unknown>, ...args: unknown[]) {
        if (
          new Error().stack?.includes(
            "/server/project-env/source-identity.ts:",
          )
        ) {
          throw new Error("ambient Promise.then must not run");
        }
        return Reflect.apply(
          thenDescriptor.value as (...args: unknown[]) => unknown,
          this,
          args,
        );
      },
    });

    let firstId: string | undefined;
    let secondId: string | undefined;
    try {
      firstId = (await get()).id;
      secondId = (await get()).id;
    } finally {
      for (const [method, descriptor] of mapDescriptors) {
        Object.defineProperty(Map.prototype, method, descriptor!);
      }
      Object.defineProperty(Map.prototype, "size", mapSizeDescriptor);
      for (const [method, descriptor] of setDescriptors) {
        Object.defineProperty(Set.prototype, method, descriptor!);
      }
      Object.defineProperty(Object, "freeze", freezeDescriptor);
      Object.defineProperty(Promise.prototype, "then", thenDescriptor);
    }

    assertEquals(firstId, "env-preview");
    assertEquals(secondId, "env-preview");
    assertEquals(fetchCalls, 1);
  });

  it("removes failed discovery flights so a later request can retry", async () => {
    const cache = new ProjectEnvironmentIdentityCache();
    let fetchCalls = 0;
    const fetchImpl: typeof globalThis.fetch = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return new Response(null, { status: 503 });
      }
      return Response.json({
        data: [{ id: "env-preview", name: "preview" }],
        page_info: { next: null },
      });
    };
    const get = () =>
      cache.get({
        apiBaseUrl: "https://api.veryfront.org",
        projectSlug: "demo-project",
        token: "retry-token",
        lookup: { kind: "name", name: "preview" },
        signal: new AbortController().signal,
        fetch: fetchImpl,
      });

    await assertRejects(() => get(), VeryfrontError);
    assertEquals((await get()).id, "env-preview");
    assertEquals(fetchCalls, 2);
  });
});
