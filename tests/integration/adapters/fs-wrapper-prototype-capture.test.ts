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
        },
      );
    } finally {
      for (const [key, descriptor] of descriptors) {
        Object.defineProperty(AsyncLocalStorage.prototype, key, descriptor);
      }
    }
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
      baseConfig,
      adapterFactory: (config) => {
        const selectedAdapter = new VeryfrontFSAdapter(config);
        selectedAdapter.initialize = () => Promise.resolve();
        return selectedAdapter;
      },
    });
    const adapter = new MultiProjectFSAdapter(baseConfig, manager);
    const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
    let poisonedCalls = 0;

    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => {
        poisonedCalls += 1;
        throw new Error("project timing hook must not run");
      },
    });
    try {
      await adapter.runWithContext(
        "my-slug",
        "signed-user-token",
        () => adapter.getSourceSnapshotFingerprint(),
      );
    } finally {
      if (originalNow) Object.defineProperty(performance, "now", originalNow);
      else Reflect.deleteProperty(performance, "now");
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
