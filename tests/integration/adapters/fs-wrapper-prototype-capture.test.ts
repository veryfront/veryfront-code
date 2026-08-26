/**
 * Prototype-pollution safety for FSAdapterWrapper optional-method capture.
 *
 * These cases mutate shared constructors and prototypes, so they cannot live
 * beside the colocated unit tests in src/platform/adapters/fs/wrapper.test.ts.
 */

import "../../_helpers/contract-init.ts";
import { assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { MultiProjectFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { ProxyFSAdapterManager } from "#veryfront/platform/adapters/fs/veryfront/proxy-manager.ts";
import { VeryfrontFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/adapter.ts";
import type {
  ContextualFSAdapter,
  FSAdapter,
} from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  getCurrentRequestContext,
  runWithoutRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { ApiCacheBackend } from "#veryfront/cache/backends/api.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  getCachedWithBatching,
  getRequestCacheContext,
  runWithCacheBatching,
  setInRequestCache,
} from "#veryfront/cache/request-cache-batcher.ts";
import { encodeCacheSourceIdentity } from "#veryfront/cache/keys/source-identity.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";

const baseConfig = {
  veryfront: {
    apiBaseUrl: "https://api.example.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    cache: { enabled: false },
  },
};

function createMockFSAdapter(): FSAdapter {
  return {
    readFile: (path: string) => {
      if (path === "/exists.txt") return Promise.resolve("content");
      return Promise.reject(new Error(`File not found: ${path}`));
    },
    exists: (path: string) => Promise.resolve(path === "/exists.txt"),
    stat: (path: string) => {
      if (path === "/exists.txt") {
        return Promise.resolve({
          size: 7,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(0),
        });
      }
      return Promise.reject(new Error(`File not found: ${path}`));
    },
  } as FSAdapter;
}

function createMockContextualAdapter(
  overrides: Partial<ContextualFSAdapter> = {},
): ContextualFSAdapter {
  return {
    ...createMockFSAdapter(),
    ...overrides,
  };
}

function withPollutedObjectPrototype<T>(
  key: string,
  value: unknown,
  run: () => T,
): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
  Object.defineProperty(Object.prototype, key, { configurable: true, value });
  try {
    return run();
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(Object.prototype, key);
    } else {
      Object.defineProperty(Object.prototype, key, original);
    }
  }
}

describe("FSAdapterWrapper optional-method capture under prototype pollution", () => {
  it("keeps request and source-policy contexts independent of mutable async hooks", async () => {
    const descriptors = new Map(
      ["disable", "enterWith", "exit", "getStore", "run"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(AsyncLocalStorage.prototype, key)!,
      ]),
    );
    let poisonedCalls = 0;
    const poison = () => {
      poisonedCalls += 1;
      throw new Error("project AsyncLocalStorage hook must not run");
    };
    for (const key of descriptors.keys()) {
      Object.defineProperty(AsyncLocalStorage.prototype, key, {
        configurable: true,
        value: poison,
      });
    }

    try {
      const policy = normalizeSourceIntegrationPolicy({ allow: { gmail: {} } });
      await runWithRequestContext(
        { projectSlug: "my-slug", token: "signed-user-token" },
        async () => {
          assertEquals(getCurrentRequestContext()?.token, "signed-user-token");
          assertEquals(
            runWithoutRequestContext(() => getCurrentRequestContext()),
            null,
          );
          assertEquals(getCurrentRequestContext()?.token, "signed-user-token");
          assertEquals(
            runWithExactSourceIntegrationPolicy(
              policy,
              getActiveSourceIntegrationPolicy,
            ),
            policy,
          );
          assertEquals(
            runWithCacheKeyContext(
              { projectId: "project-id", mode: "preview", versionId: "main" },
              tryGetCacheKeyContext,
            ),
            { projectId: "project-id", mode: "preview", versionId: "main" },
          );
          assertEquals(
            await runWithCacheBatching(async () => getRequestCacheContext() !== undefined),
            true,
          );
        },
      );
    } finally {
      for (const [key, descriptor] of descriptors) {
        Object.defineProperty(AsyncLocalStorage.prototype, key, descriptor);
      }
    }
    assertEquals(poisonedCalls, 0);
  });

  it("keeps API cache credentials independent of the mutable global context bridge", async () => {
    const originalBridge = globalThis.__vf_multi_project_adapter;
    if (originalBridge === undefined) {
      throw new Error("The Veryfront request context bridge must be installed");
    }
    const originalAccessor = originalBridge.getCurrentRequestContext;
    let poisonedCalls = 0;
    let authorization = "";
    globalThis.__vf_multi_project_adapter = {
      ...originalBridge,
      getCurrentRequestContext: () => {
        poisonedCalls += 1;
        return originalAccessor();
      },
    };
    installMockFetch(
      ((_input: RequestInfo | URL, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Promise.resolve(Response.json({ deleted: 1 }));
      }) as typeof fetch,
    );

    try {
      const cache = new ApiCacheBackend({
        circuitBreakerName: "api-cache-trusted-context-accessor-integration-test",
      });
      const deleted = await runWithRequestContext(
        {
          projectSlug: "trusted-project",
          projectId: "trusted-project-id",
          token: "signed-user-token",
        },
        () => cache.delByPattern("agent:*"),
      );

      assertEquals(deleted, 1);
      assertEquals(authorization, "Bearer signed-user-token");
      assertEquals(poisonedCalls, 0);
    } finally {
      globalThis.__vf_multi_project_adapter = originalBridge;
      restoreMockFetch();
    }
  });

  it("keeps request-cache batching independent of mutable Map methods", async () => {
    const keys = ["delete", "get", "has", "set"] as const;
    const descriptors = keys.map((key) =>
      [
        key,
        Object.getOwnPropertyDescriptor(Map.prototype, key)!,
      ] as const
    );
    let poisonedCalls = 0;
    let result: string | null | undefined;
    for (const key of keys) {
      Object.defineProperty(Map.prototype, key, {
        configurable: true,
        value: () => {
          poisonedCalls += 1;
          throw new Error(`project Map.${key} hook must not run`);
        },
      });
    }

    try {
      await runWithRequestContext(
        { projectSlug: "trusted-project", token: "signed-user-token" },
        async () => {
          result = await runWithCacheBatching(async () => {
            setInRequestCache("source-key", "source-value");
            return await getCachedWithBatching(
              {
                type: "memory",
                get: () => Promise.resolve("backend-value"),
                set: () => Promise.resolve(),
                del: () => Promise.resolve(),
              },
              "source-key",
            );
          });
        },
      );
    } finally {
      for (const [key, descriptor] of descriptors) {
        Object.defineProperty(Map.prototype, key, descriptor);
      }
    }
    assertEquals(result, "source-value");
    assertEquals(poisonedCalls, 0);
  });

  it("keeps cache source encoding independent of mutable global hooks", () => {
    const originalEncodeURIComponent = globalThis.encodeURIComponent;
    const originalJoin = Object.getOwnPropertyDescriptor(Array.prototype, "join")!;
    let poisonedCalls = 0;
    globalThis.encodeURIComponent = () => {
      poisonedCalls += 1;
      throw new Error("project URI encoder must not run");
    };
    Object.defineProperty(Array.prototype, "join", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("project array join must not run");
      },
    });
    let result: string | undefined;

    try {
      result = encodeCacheSourceIdentity({
        type: "environment",
        environmentName: "Production:EU",
        releaseId: "release:1",
      }).key;
    } finally {
      globalThis.encodeURIComponent = originalEncodeURIComponent;
      Object.defineProperty(Array.prototype, "join", originalJoin);
    }
    assertEquals(result, "environment:Production%3AEU:release%3A1");
    assertEquals(poisonedCalls, 0);
  });

  it("normalizes host API URLs without mutable string hooks", () => {
    const envKey = "VERYFRONT_API_URL";
    const originalEnv = Deno.env.get(envKey);
    const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")!;
    const originalReplace = Object.getOwnPropertyDescriptor(String.prototype, "replace")!;
    let poisonedCalls = 0;
    let result: string | undefined;
    const poison = () => {
      poisonedCalls += 1;
      throw new Error("project URL normalization hook must not run");
    };
    Deno.env.set(envKey, " https://api.staging.veryfront.org/graphql/ ");
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      value: poison,
    });
    Object.defineProperty(String.prototype, "replace", {
      configurable: true,
      value: poison,
    });

    try {
      result = resolveVeryfrontApiBaseUrlFromHostEnv();
    } finally {
      Object.defineProperty(String.prototype, "trim", originalTrim);
      Object.defineProperty(String.prototype, "replace", originalReplace);
      if (originalEnv === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, originalEnv);
    }
    assertEquals(result, "https://api.staging.veryfront.org/api");
    assertEquals(poisonedCalls, 0);
  });

  it("delegates fingerprints through the captured Reflect.apply intrinsic", async () => {
    const fingerprint = () => "trusted-snapshot";
    const fsAdapter = {
      ...createMockFSAdapter(),
      getSourceSnapshotFingerprint: fingerprint,
    };
    const wrapper = new FSAdapterWrapper(fsAdapter);
    const originalApply = Reflect.apply;
    let result: string | undefined | Promise<string | undefined> | undefined;

    Reflect.apply = ((
      target: (...args: never[]) => unknown,
      thisArgument: unknown,
      argumentsList: ArrayLike<unknown>,
    ) =>
      target === fingerprint
        ? "project-spoofed-snapshot"
        : originalApply(target, thisArgument, argumentsList)) as typeof Reflect.apply;
    try {
      result = wrapper.getSourceSnapshotFingerprint?.();
    } finally {
      Reflect.apply = originalApply;
    }

    assertEquals(await result, "trusted-snapshot");
  });

  it("keeps source reads independent of wrapper prototype mutation", async () => {
    const wrapper = new FSAdapterWrapper(createMockFSAdapter());
    const originalReadFile = Object.getOwnPropertyDescriptor(
      FSAdapterWrapper.prototype,
      "readFile",
    )!;
    let interceptedReads = 0;
    Object.defineProperty(FSAdapterWrapper.prototype, "readFile", {
      configurable: true,
      value: () => {
        interceptedReads += 1;
        return Promise.resolve("project-intercepted");
      },
    });

    try {
      assertEquals(await wrapper.readFile("/exists.txt"), "content");
      assertEquals(interceptedReads, 0);
    } finally {
      Object.defineProperty(FSAdapterWrapper.prototype, "readFile", originalReadFile);
    }
  });

  it("ignores a refreshSourceSnapshot planted on Object.prototype", () => {
    let planted = false;

    withPollutedObjectPrototype(
      "refreshSourceSnapshot",
      () => {
        planted = true;
        return Promise.resolve();
      },
      () => {
        const wrapper = new FSAdapterWrapper(createMockFSAdapter());

        assertEquals(
          wrapper.refreshSourceSnapshot,
          undefined,
          "a refreshSourceSnapshot planted on Object.prototype must not be captured",
        );
        assertEquals(planted, false, "the planted prototype method must never be invoked");
      },
    );
  });

  it("ignores an ensureSourceSnapshotFresh planted on Object.prototype", () => {
    let planted = false;

    withPollutedObjectPrototype(
      "ensureSourceSnapshotFresh",
      () => {
        planted = true;
        return Promise.resolve();
      },
      () => {
        const wrapper = new FSAdapterWrapper(createMockFSAdapter());

        assertEquals(
          wrapper.ensureSourceSnapshotFresh,
          undefined,
          "an ensureSourceSnapshotFresh planted on Object.prototype must not be captured",
        );
        assertEquals(planted, false, "the planted prototype method must never be invoked");
      },
    );
  });

  it("keeps context dispatch independent of wrapper prototype mutation", async () => {
    let delegatedToken: string | undefined;
    const interceptedTokens: string[] = [];
    const fsAdapter = createMockContextualAdapter({
      runWithContext: <T>(_slug: string, token: string, fn: () => Promise<T>) => {
        delegatedToken = token;
        return fn();
      },
    });
    const wrapper = new FSAdapterWrapper(fsAdapter);
    const original = Object.getOwnPropertyDescriptor(
      FSAdapterWrapper.prototype,
      "runWithContext",
    )!;
    let result: string | undefined;

    Object.defineProperty(FSAdapterWrapper.prototype, "runWithContext", {
      configurable: true,
      value: <T>(_slug: string, token: string, fn: () => Promise<T>) => {
        interceptedTokens.push(token);
        return fn();
      },
    });
    try {
      result = await wrapper.runWithContext(
        "my-slug",
        "signed-user-token",
        () => Promise.resolve("result"),
      );
    } finally {
      Object.defineProperty(FSAdapterWrapper.prototype, "runWithContext", original);
    }

    assertEquals(result, "result");
    assertEquals(delegatedToken, "signed-user-token");
    assertEquals(interceptedTokens, []);
  });

  it("keeps context dispatch independent of adapter prototype mutation", async () => {
    const adapter = new MultiProjectFSAdapter(baseConfig);
    const wrapper = new FSAdapterWrapper(adapter);
    const interceptedTokens: string[] = [];
    const original = Object.getOwnPropertyDescriptor(
      MultiProjectFSAdapter.prototype,
      "runWithContext",
    )!;
    let result: string | undefined;

    Object.defineProperty(MultiProjectFSAdapter.prototype, "runWithContext", {
      configurable: true,
      value: <T>(_slug: string, token: string, fn: () => Promise<T>) => {
        interceptedTokens.push(token);
        return fn();
      },
    });
    try {
      result = await wrapper.runWithContext(
        "my-slug",
        "signed-user-token",
        () => Promise.resolve("result"),
      );
    } finally {
      Object.defineProperty(MultiProjectFSAdapter.prototype, "runWithContext", original);
      adapter.dispose();
    }

    assertEquals(result, "result");
    assertEquals(interceptedTokens, []);
  });

  it("keeps credential-bearing adapter lookup independent of mutable timing hooks", async () => {
    const manager = new ProxyFSAdapterManager({
      baseConfig: {
        veryfront: { ...baseConfig.veryfront, proxyMode: true },
      },
      adapterFactory: (config) => {
        const selectedAdapter = new VeryfrontFSAdapter(config);
        selectedAdapter.initialize = () => Promise.resolve();
        return selectedAdapter;
      },
    });
    const adapter = new MultiProjectFSAdapter(baseConfig, manager);
    const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
    const originalDateNow = Object.getOwnPropertyDescriptor(Date, "now")!;
    const originalTrim = Object.getOwnPropertyDescriptor(String.prototype, "trim")!;
    let poisonedCalls = 0;

    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("project timing hook must not run");
      },
    });
    Object.defineProperty(String.prototype, "trim", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("project string hook must not run");
      },
    });
    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("project wall-clock hook must not run");
      },
    });
    try {
      await adapter.runWithContext(
        "my-slug",
        "signed-user-token",
        () => adapter.getSourceSnapshotFingerprint(),
        "project-id",
      );
    } finally {
      if (originalNow) Object.defineProperty(performance, "now", originalNow);
      else Reflect.deleteProperty(performance, "now");
      Object.defineProperty(Date, "now", originalDateNow);
      Object.defineProperty(String.prototype, "trim", originalTrim);
      adapter.dispose();
    }

    assertEquals(poisonedCalls, 0);
  });

  it("keeps credential partitioning independent of mutable Array.from", async () => {
    let poisonedCalls = 0;
    const manager = new ProxyFSAdapterManager({
      baseConfig,
      adapterFactory: (config) => {
        const adapter = new VeryfrontFSAdapter(config);
        adapter.initialize = () => Promise.resolve();
        return adapter;
      },
    });
    const original = Object.getOwnPropertyDescriptor(Array, "from")!;
    let first: VeryfrontFSAdapter | undefined;
    let second: VeryfrontFSAdapter | undefined;

    Object.defineProperty(Array, "from", {
      configurable: true,
      value: () => {
        poisonedCalls++;
        return [];
      },
    });
    try {
      first = await manager.getAdapter(
        "shared-project",
        "credential-one",
        "shared-project-id",
        false,
        null,
        null,
        "main",
      );
      second = await manager.getAdapter(
        "shared-project",
        "credential-two",
        "shared-project-id",
        false,
        null,
        null,
        "main",
      );
    } finally {
      Object.defineProperty(Array, "from", original);
      manager.dispose();
    }

    assertNotStrictEquals(first, second);
    assertEquals(poisonedCalls, 0);
  });
});
