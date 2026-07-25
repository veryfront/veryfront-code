import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  HostedProxyRoutingBindingCache,
  type HostedProxySourceBindingRequest,
} from "./proxy-routing-binding.ts";

const API_BASE_URL = "https://api.veryfront.test/api";

function fetchInit(
  init: Parameters<typeof globalThis.fetch>[1],
): { headers?: HeadersInit; signal?: AbortSignal | null } {
  return (init ?? {}) as { headers?: HeadersInit; signal?: AbortSignal | null };
}

function metadataResponse(
  environments: Array<{
    id: string;
    name: string;
    domains?: string[];
    active_release_id?: string | null;
  }> = [{
    id: "env-production",
    name: "production",
    active_release_id: "release-current",
  }],
  init?: ResponseInit,
): Response {
  return new Response(
    JSON.stringify({
      id: "project-1",
      slug: "demo-project",
      name: "Demo",
      environments,
    }),
    {
      headers: { "content-type": "application/json" },
      ...init,
    },
  );
}

function bindingRequest(
  overrides: Partial<HostedProxySourceBindingRequest> = {},
): HostedProxySourceBindingRequest {
  return {
    projectSlug: "demo-project",
    projectId: "project-1",
    environmentId: "env-production",
    selector: { kind: "name", name: "production" },
    mode: "production",
    releaseId: "release-current",
    branch: null,
    token: "project-token",
    ...overrides,
  };
}

async function expectVeryfrontError(
  operation: () => Promise<unknown>,
  status: number,
): Promise<VeryfrontError> {
  const error = await assertRejects(operation);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.status, status);
  return error;
}

describe("project-env/proxy-routing-binding", () => {
  it("atomically binds a production environment and active release", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      (input, init) => {
        requests.push({
          url: String(input),
          authorization: new Headers(fetchInit(init).headers).get("authorization"),
        });
        return Promise.resolve(metadataResponse());
      },
    );

    const binding = await cache.resolve(bindingRequest());

    assertEquals(requests, [{
      url: `${API_BASE_URL}/projects/-/proxy-routing/demo-project`,
      authorization: "Bearer project-token",
    }]);
    assertEquals(binding, {
      projectSlug: "demo-project",
      projectId: "project-1",
      environmentId: "env-production",
      environmentName: "production",
      activeReleaseId: "release-current",
      sourceContext: {
        productionMode: true,
        releaseId: "release-current",
        environmentName: "production",
      },
    });
    assertEquals(Object.isFrozen(binding), true);
    assertEquals(Object.isFrozen(binding.sourceContext), true);
  });

  it("binds preview to the exact preview environment and branch", async () => {
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () =>
        Promise.resolve(
          metadataResponse([
            {
              id: "env-preview",
              name: "PrEvIeW",
              active_release_id: null,
            },
          ]),
        ),
    );

    const binding = await cache.resolve(bindingRequest({
      environmentId: "env-preview",
      selector: { kind: "name", name: "preview" },
      mode: "preview",
      releaseId: undefined,
      branch: "feature/source-binding",
    }));

    assertEquals(binding.environmentName, "PrEvIeW");
    assertEquals(binding.sourceContext, {
      productionMode: false,
      branch: "feature/source-binding",
    });
  });

  it("binds a custom domain to its authoritative environment and release", async () => {
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () =>
        Promise.resolve(
          metadataResponse([
            {
              id: "env-customer",
              name: "customer-production",
              domains: ["WWW.Example.com"],
              active_release_id: "release-customer",
            },
          ]),
        ),
    );

    const binding = await cache.resolve(bindingRequest({
      environmentId: "env-customer",
      selector: { kind: "domain", domain: "www.example.com:443" },
      releaseId: "release-customer",
    }));

    assertEquals(binding.environmentName, "customer-production");
    assertEquals(binding.sourceContext, {
      productionMode: true,
      releaseId: "release-customer",
      environmentName: "customer-production",
    });
  });

  it("fails closed when a same-project environment ID does not match the source", async () => {
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(metadataResponse());
      },
    );
    await cache.resolve(bindingRequest());

    const error = await expectVeryfrontError(
      () =>
        cache.resolve(bindingRequest({
          environmentId: "env-preview",
        })),
      502,
    );

    assertEquals(error.slug, "api-client-error");
    assertEquals(error.context, {
      code: "proxy-context-mismatch",
      reason: "environment-id",
    });
    // A cached mismatch is refreshed exactly once before it is rejected.
    assertEquals(fetchCount, 2);
  });

  it("fails closed on project identity and active-release mismatches", async () => {
    for (
      const testCase of [
        {
          response: {
            id: "different-project",
            slug: "demo-project",
            environments: [{
              id: "env-production",
              name: "production",
              active_release_id: "release-current",
            }],
          },
          reason: "project",
        },
        {
          response: {
            id: "project-1",
            slug: "different-project",
            environments: [{
              id: "env-production",
              name: "production",
              active_release_id: "release-current",
            }],
          },
          reason: "project",
        },
        {
          response: {
            id: "project-1",
            slug: "demo-project",
            environments: [{
              id: "env-production",
              name: "production",
              active_release_id: "different-release",
            }],
          },
          reason: "active-release",
        },
      ] as const
    ) {
      let fetchCount = 0;
      const cache = new HostedProxyRoutingBindingCache(
        API_BASE_URL,
        () => {
          fetchCount += 1;
          return Promise.resolve(Response.json(testCase.response));
        },
        { ttlMs: 0 },
      );
      const error = await expectVeryfrontError(
        () => cache.resolve(bindingRequest()),
        502,
      );
      assertEquals(error.context, {
        code: "proxy-context-mismatch",
        reason: testCase.reason,
      });
      assertEquals(fetchCount, 2);
    }
  });

  it("does not let ambient Array.find poisoning redirect an authorized selector", async () => {
    const findDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "find");
    if (typeof findDescriptor?.value !== "function") {
      throw new TypeError("Array.find is unavailable");
    }
    const intrinsicFind = findDescriptor.value as (...args: unknown[]) => unknown;
    const intrinsicIncludes = String.prototype.includes;
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(
          metadataResponse([
            {
              id: "env-production",
              name: "production",
              active_release_id: "release-production",
            },
            {
              id: "env-preview",
              name: "preview",
              active_release_id: "release-preview",
            },
          ]),
        );
      },
    );

    Object.defineProperty(Array.prototype, "find", {
      ...findDescriptor,
      value(this: unknown[], ...args: unknown[]) {
        const stack = new Error().stack ?? "";
        if (
          Reflect.apply(
            intrinsicIncludes,
            stack,
            ["/server/project-env/proxy-routing-binding.ts:"],
          )
        ) {
          return this[1];
        }
        return Reflect.apply(intrinsicFind, this, args);
      },
    });

    try {
      const error = await expectVeryfrontError(
        () =>
          cache.resolve(bindingRequest({
            environmentId: "env-preview",
            selector: { kind: "name", name: "production" },
            releaseId: "release-preview",
          })),
        502,
      );
      assertEquals(error.context, {
        code: "proxy-context-mismatch",
        reason: "environment-id",
      });
      assertEquals(fetchCount, 2);
    } finally {
      Object.defineProperty(Array.prototype, "find", findDescriptor);
    }
  });

  it("refreshes stale routing metadata once when the active release changes", async () => {
    let activeReleaseId = "release-old";
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(
          metadataResponse([{
            id: "env-production",
            name: "production",
            active_release_id: activeReleaseId,
          }]),
        );
      },
    );

    await cache.resolve(bindingRequest({ releaseId: "release-old" }));
    activeReleaseId = "release-new";
    const binding = await cache.resolve(bindingRequest({
      releaseId: "release-new",
    }));

    assertEquals(binding.activeReleaseId, "release-new");
    assertEquals(binding.sourceContext, {
      productionMode: true,
      releaseId: "release-new",
      environmentName: "production",
    });
    assertEquals(fetchCount, 2);
  });

  it("isolates cached authorization by token fingerprint", async () => {
    const authorizations: Array<string | null> = [];
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      (_input, init) => {
        authorizations.push(
          new Headers(fetchInit(init).headers).get("authorization"),
        );
        return Promise.resolve(metadataResponse());
      },
    );

    await cache.resolve(bindingRequest({ token: "token-a" }));
    await cache.resolve(bindingRequest({ token: "token-a" }));
    await cache.resolve(bindingRequest({ token: "token-b" }));

    assertEquals(authorizations, ["Bearer token-a", "Bearer token-b"]);
  });

  it("rejects missing tuple identities before any upstream request", async () => {
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(metadataResponse());
      },
    );

    const projectError = await expectVeryfrontError(
      () => cache.resolve(bindingRequest({ projectId: undefined })),
      400,
    );
    const environmentError = await expectVeryfrontError(
      () => cache.resolve(bindingRequest({ environmentId: undefined })),
      400,
    );

    assertEquals(projectError.slug, "invalid-argument");
    assertEquals(environmentError.slug, "invalid-argument");
    assertEquals(fetchCount, 0);
  });

  it("rejects oversized and ambiguous upstream metadata", async () => {
    const oversized = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () =>
        Promise.resolve(
          new Response("{}", {
            headers: { "content-length": String(512 * 1_024 + 1) },
          }),
        ),
      { ttlMs: 0 },
    );
    const oversizedError = await expectVeryfrontError(
      () => oversized.resolve(bindingRequest()),
      502,
    );
    assertEquals(oversizedError.context, {
      code: "invalid-upstream-response",
    });

    const duplicate = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () =>
        Promise.resolve(
          metadataResponse([
            {
              id: "env-a",
              name: "production",
              active_release_id: "release-current",
            },
            {
              id: "env-b",
              name: "PRODUCTION",
              active_release_id: "release-current",
            },
          ]),
        ),
      { ttlMs: 0 },
    );
    const duplicateError = await expectVeryfrontError(
      () => duplicate.resolve(bindingRequest()),
      502,
    );
    assertEquals(duplicateError.context, {
      code: "invalid-upstream-response",
    });

    const excessiveCardinality = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () =>
        Promise.resolve(
          metadataResponse(
            Array.from({ length: 1_001 }, (_, index) => ({
              id: `env-${index}`,
              name: `environment-${index}`,
              active_release_id: null,
            })),
          ),
        ),
      { ttlMs: 0 },
    );
    const cardinalityError = await expectVeryfrontError(
      () => excessiveCardinality.resolve(bindingRequest()),
      502,
    );
    assertEquals(cardinalityError.context, {
      code: "invalid-upstream-response",
    });
  });

  it("cancels one waiter without cancelling shared routing work", async () => {
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<Response>();
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        started.resolve();
        return resume.promise;
      },
    );
    const first = cache.resolve(bindingRequest());
    await started.promise;
    const controller = new AbortController();
    const cancelled = cache.resolve(bindingRequest({ signal: controller.signal }));
    await Promise.resolve();
    controller.abort(new Error("request cancelled"));

    await assertRejects(() => cancelled, Error, "request cancelled");
    resume.resolve(metadataResponse());
    const binding = await first;

    assertEquals(binding.environmentId, "env-production");
    assertEquals(fetchCount, 1);
  });

  it("observes a flight rejection when fetch aborts the first waiter reentrantly", async () => {
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event.reason);
      event.preventDefault();
    };
    globalThis.addEventListener("unhandledrejection", onUnhandled);
    try {
      const cache = new HostedProxyRoutingBindingCache(
        API_BASE_URL,
        () => {
          controller.abort(new Error("caller aborted reentrantly"));
          return Promise.resolve(new Response(null, { status: 500 }));
        },
      );

      await assertRejects(
        () => cache.resolve(bindingRequest({ signal: controller.signal })),
        Error,
        "caller aborted reentrantly",
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      assertEquals(unhandled, []);
    } finally {
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
    }
  });

  it("does not let invalidated in-flight metadata repopulate the cache", async () => {
    const firstResponse = Promise.withResolvers<Response>();
    const firstStarted = Promise.withResolvers<void>();
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          firstStarted.resolve();
          return firstResponse.promise;
        }
        return Promise.resolve(metadataResponse());
      },
    );

    const pending = cache.resolve(bindingRequest());
    await firstStarted.promise;
    cache.invalidate("demo-project");
    firstResponse.resolve(metadataResponse());
    await pending;

    await cache.resolve(bindingRequest());
    assertEquals(fetchCount, 2);
  });

  it("invalidates mismatched metadata by the requested project identity", async () => {
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(
          Response.json({
            id: "project-1",
            slug: "different-project",
            environments: [{
              id: "env-production",
              name: "production",
              active_release_id: "release-current",
            }],
          }),
        );
      },
    );

    await expectVeryfrontError(
      () => cache.resolve(bindingRequest()),
      502,
    );
    assertEquals(fetchCount, 2);

    cache.invalidate("demo-project");
    await expectVeryfrontError(
      () => cache.resolve(bindingRequest()),
      502,
    );
    assertEquals(fetchCount, 4);
  });

  it("keeps invalidation generations distinct after ambient marker creation is poisoned", async () => {
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
    if (typeof freezeDescriptor?.value !== "function") {
      throw new TypeError("Object.freeze is unavailable");
    }
    const intrinsicFreeze = freezeDescriptor.value as typeof Object.freeze;
    const sharedEmptyMarker = intrinsicFreeze({});
    const firstResponse = Promise.withResolvers<Response>();
    const secondResponse = Promise.withResolvers<Response>();
    const firstStarted = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    let fetchCount = 0;
    const response = (releaseId: string): Response =>
      metadataResponse([{
        id: "env-production",
        name: "production",
        active_release_id: releaseId,
      }]);
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          firstStarted.resolve();
          return firstResponse.promise;
        }
        secondStarted.resolve();
        return secondResponse.promise;
      },
      { maxInflight: 2, maxInflightPerProject: 2 },
    );

    Object.defineProperty(Object, "freeze", {
      ...freezeDescriptor,
      value(value: object) {
        return Reflect.ownKeys(value).length === 0 ? sharedEmptyMarker : intrinsicFreeze(value);
      },
    });

    let replayOutcome: "pending" | "settled" | undefined;
    try {
      const oldRequest = cache.resolve(bindingRequest({ releaseId: "release-old" }));
      await firstStarted.promise;
      cache.invalidate("demo-project");
      const freshRequest = cache.resolve(bindingRequest({ releaseId: "release-new" }));
      await secondStarted.promise;

      firstResponse.resolve(response("release-old"));
      await oldRequest;

      const replayController = new AbortController();
      const replay = cache.resolve(bindingRequest({
        releaseId: "release-old",
        signal: replayController.signal,
      }));
      replayOutcome = await Promise.race([
        replay.then(
          () => "settled" as const,
          () => "settled" as const,
        ),
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 10)),
      ]);
      if (replayOutcome === "pending") {
        replayController.abort(new Error("replay probe complete"));
        await assertRejects(() => replay, Error, "replay probe complete");
      }

      secondResponse.resolve(response("release-new"));
      await freshRequest;
    } finally {
      secondResponse.resolve(response("release-new"));
      Object.defineProperty(Object, "freeze", freezeDescriptor);
    }

    assertEquals(replayOutcome, "pending");
    assertEquals(fetchCount, 2);
  });

  it("rejects non-cooperative routing work at the deadline without publishing it late", async () => {
    const staleResponse = Promise.withResolvers<Response>();
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        if (fetchCount === 1) return staleResponse.promise;
        return Promise.resolve(metadataResponse());
      },
      {
        fetchTimeoutMs: 5,
        maxInflight: 2,
        maxInflightPerProject: 2,
      },
    );

    const timeout = await expectVeryfrontError(
      () => cache.resolve(bindingRequest()),
      503,
    );
    assertEquals(timeout.context, { code: "fetch-timeout" });

    staleResponse.resolve(metadataResponse());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await cache.resolve(bindingRequest());
    assertEquals(fetchCount, 2);
  });

  it("retains an underlying hard-cap slot after a non-cooperative timeout", async () => {
    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return new Promise<Response>(() => {
          // Deliberately ignores the shared abort signal.
        });
      },
      {
        fetchTimeoutMs: 5,
        maxInflight: 1,
        maxInflightPerProject: 1,
      },
    );

    const timeout = await expectVeryfrontError(
      () => cache.resolve(bindingRequest({ token: "token-a" })),
      503,
    );
    assertEquals(timeout.context, { code: "fetch-timeout" });

    const capacity = await expectVeryfrontError(
      () => cache.resolve(bindingRequest({ token: "token-b" })),
      503,
    );
    assertEquals(capacity.context, { code: "capacity-exceeded" });
    assertEquals(fetchCount, 1);
  });

  it("bounds token fingerprint work before routing fetch admission", async () => {
    const originalDigest = Object.getOwnPropertyDescriptor(
      SubtleCrypto.prototype,
      "digest",
    );
    if (typeof originalDigest?.value !== "function") {
      throw new TypeError("SubtleCrypto.digest is unavailable");
    }
    const digestStarted = Promise.withResolvers<void>();
    const digestResult = Promise.withResolvers<ArrayBuffer>();
    let digestCalls = 0;
    let IsolatedCache: typeof HostedProxyRoutingBindingCache | undefined;

    Object.defineProperty(SubtleCrypto.prototype, "digest", {
      ...originalDigest,
      value() {
        digestCalls += 1;
        digestStarted.resolve();
        return digestResult.promise;
      },
    });
    try {
      const isolatedModule = await import(
        `./proxy-routing-binding.ts?bounded-key-build=${crypto.randomUUID()}`
      );
      IsolatedCache = isolatedModule.HostedProxyRoutingBindingCache;
    } finally {
      Object.defineProperty(SubtleCrypto.prototype, "digest", originalDigest);
    }
    if (!IsolatedCache) throw new Error("Failed to load isolated routing cache");

    const cache = new IsolatedCache(
      API_BASE_URL,
      () => Promise.resolve(metadataResponse()),
      { maxInflight: 1, maxInflightPerProject: 1 },
    );
    const first = cache.resolve(bindingRequest());
    await digestStarted.promise;
    const overflow = await expectVeryfrontError(
      () =>
        cache.resolve(bindingRequest({
          projectSlug: "another-project",
          projectId: "project-2",
          token: "another-token",
        })),
      503,
    );
    assertEquals(overflow.context, { code: "capacity-exceeded" });
    assertEquals(digestCalls, 1);

    digestResult.resolve(new Uint8Array(32).buffer);
    assertEquals((await first).environmentId, "env-production");
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
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => Promise.resolve(metadataResponse()),
    );
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
      assertEquals(
        (await cache.resolve(bindingRequest({ signal }))).environmentId,
        "env-production",
      );
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
      "clear",
      "delete",
      "entries",
      "get",
      "has",
      "keys",
      "set",
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

    let fetchCount = 0;
    const cache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        fetchCount += 1;
        return Promise.resolve(metadataResponse());
      },
    );
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
            "/server/project-env/proxy-routing-binding.ts:",
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

    let firstEnvironmentId: string | undefined;
    let secondEnvironmentId: string | undefined;
    try {
      firstEnvironmentId = (await cache.resolve(bindingRequest())).environmentId;
      cache.invalidate("demo-project");
      secondEnvironmentId = (await cache.resolve(bindingRequest())).environmentId;
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

    assertEquals(firstEnvironmentId, "env-production");
    assertEquals(secondEnvironmentId, "env-production");
    assertEquals(fetchCount, 2);
  });

  it("bounds per-project concurrency and converts fetch timeouts to 503", async () => {
    const started = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<Response>();
    const capacityCache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      () => {
        started.resolve();
        return resume.promise;
      },
      { maxInflightPerProject: 1 },
    );
    const first = capacityCache.resolve(bindingRequest({ token: "token-a" }));
    await started.promise;
    const capacityError = await expectVeryfrontError(
      () => capacityCache.resolve(bindingRequest({ token: "token-b" })),
      503,
    );
    assertEquals(capacityError.context, { code: "capacity-exceeded" });
    resume.resolve(metadataResponse());
    await first;

    const timeoutCache = new HostedProxyRoutingBindingCache(
      API_BASE_URL,
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = fetchInit(init).signal;
          signal?.addEventListener(
            "abort",
            () => reject(signal.reason),
            { once: true },
          );
        }),
      { fetchTimeoutMs: 5 },
    );
    const timeoutError = await expectVeryfrontError(
      () => timeoutCache.resolve(bindingRequest()),
      503,
    );
    assertEquals(timeoutError.context, { code: "fetch-timeout" });
  });

  it("preserves safe upstream authorization and not-found statuses", async () => {
    for (const status of [401, 403, 404, 429]) {
      const cache = new HostedProxyRoutingBindingCache(
        API_BASE_URL,
        () => Promise.resolve(new Response(null, { status })),
        { ttlMs: 0 },
      );
      const error = await expectVeryfrontError(
        () => cache.resolve(bindingRequest()),
        status,
      );
      assertEquals(
        error.slug,
        status === 404 ? "resource-not-found" : "api-client-error",
      );
    }
  });
});
