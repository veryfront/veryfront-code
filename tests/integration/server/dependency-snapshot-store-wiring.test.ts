import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backends/memory.ts";
import {
  _createSharedDependencySnapshotCacheBackend,
  createCacheBackedDependencySnapshotStore,
  createCacheDependencySnapshotStoreHandle,
} from "#veryfront/cache/dependency-snapshot-store.ts";
import {
  createDependencySnapshotStoreHandle,
  resolveDependencySnapshotStoreHandle,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: null,
    ...overrides,
  };
}

// Both the pinning rollout and the shared-backend resolution read process
// configuration, so every test here pins the environment it needs and
// restores whatever the process had. Activation itself is never environmental:
// the host configures the adapter explicitly, per
// docs/architecture/15-runtime-adapters.md.
const MANAGED_ENV = [
  "VERYFRONT_DEPENDENCY_PINNING",
  "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT",
  "VERYFRONT_API_BASE_URL",
  "PROXY_MODE",
  "REDIS_URL",
] as const;

describe("host-configured dependency snapshot store", () => {
  const prior = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const name of MANAGED_ENV) {
      prior.set(name, getHostEnv(name));
      deleteEnv(name);
    }
    setEnv("VERYFRONT_DEPENDENCY_PINNING", "1");
    setEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT", "100");
    clearReactVersionCache();
  });
  afterEach(() => {
    for (const [name, value] of prior) {
      if (value === undefined) deleteEnv(name);
      else setEnv(name, value);
    }
    clearReactVersionCache();
  });

  it("resolves a pre-writeback snapshot on a cold replica through an adapter-configured store", async () => {
    // The documented host bootstrap pattern: the handle is placed on the
    // adapter before its first request; every handler-created pinning source
    // inherits it through the adapter capability.
    const backend = new MemoryCacheBackend();
    const handle = createDependencySnapshotStoreHandle(
      createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend)),
    );
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, "dependencySnapshotStore", {
      value: handle,
      enumerable: true,
    });
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');

    const renderingReplica = createHandlerDependencyPinningSource(
      makeCtx({ adapter, projectId: "shared-history-project", isLocalProject: false }),
    );
    const document = await getDependencyPinningSnapshot(renderingReplica);
    assertEquals(document.cacheKey.startsWith("on:"), true);

    // Dependency writeback pins the resolved versions, changing the current key.
    adapter.fs.files.set("/project/package.json", '{"dependencies":{"react":"19.2.4"}}');
    // A cold replica holds no process-local history for the rendered key.
    clearReactVersionCache();

    const coldReplica = createHandlerDependencyPinningSource(
      makeCtx({ adapter, projectId: "shared-history-project", isLocalProject: false }),
    );
    const recovered = await resolveRequestedDependencyPinningSnapshot(
      coldReplica,
      document.cacheKey,
    );

    assertEquals(
      recovered?.cacheKey,
      document.cacheKey,
      "a cold replica must recover the rendered snapshot instead of conflicting",
    );
    assertEquals(recovered?.dependencies, document.dependencies);
  });

  it("keeps unconfigured runtimes on process-local history", async () => {
    // Without an adapter-configured provider the framework must not select
    // storage on its own, whatever credentials the environment carries.
    setEnv("VERYFRONT_API_BASE_URL", "https://api.example.com");
    setEnv("PROXY_MODE", "1");
    setEnv("REDIS_URL", "redis://127.0.0.1:1");
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');

    const source = createHandlerDependencyPinningSource(
      makeCtx({ adapter, projectId: "unconfigured-project", isLocalProject: false }),
    );
    const document = await getDependencyPinningSnapshot(source);

    assertEquals(
      document.cacheKey.startsWith("on:"),
      true,
      "rendering must not depend on any shared storage the host never configured",
    );
  });

  it("rejects backend resolution instead of falling back to node-local storage", async () => {
    // Without API cache or Redis configured, backend resolution yields the
    // memory backend. The factory must reject so the distributed-cache
    // accessor records a failure and retries, rather than caching a
    // node-local backend as shared history for the life of the process.
    await assertRejects(() => _createSharedDependencySnapshotCacheBackend());
  });

  it("builds a handle whose operations reject while no shared backend resolves", async () => {
    const store = resolveDependencySnapshotStoreHandle(
      createCacheDependencySnapshotStoreHandle(),
    );

    await assertRejects(() => store.read("a".repeat(64), "on:54uvgwr2ih7p"));
    await assertRejects(() =>
      store.publish("a".repeat(64), "on:54uvgwr2ih7p", "bytes", Date.now() + 60_000)
    );
  });

  it("keeps the backend and stored bytes away from replaced globals", async () => {
    // Project code in the shared realm can replace writable globals between
    // requests. Privileged store operations must run entirely on intrinsics
    // captured at module load, so a replacement hook never observes the
    // backend object or the snapshot bytes.
    const backend = new MemoryCacheBackend();
    const store = createCacheBackedDependencySnapshotStore(() => Promise.resolve(backend));
    const namespace = "a".repeat(64);
    const value = "snapshot-bytes";
    const expiresAt = Date.now() + 60_000;
    const observedLeaks: string[] = [];
    const inspect = (label: string, args: readonly unknown[]) => {
      for (const arg of args) {
        if (arg === backend) observedLeaks.push(`${label}: backend object`);
        if (typeof arg === "string" && arg.includes(value)) {
          observedLeaks.push(`${label}: stored bytes`);
        }
        if (
          arg !== null && typeof arg === "object" &&
          (arg as { value?: unknown }).value === value
        ) observedLeaks.push(`${label}: record object`);
      }
    };
    const originals = {
      apply: Reflect.apply,
      parse: JSON.parse,
      stringify: JSON.stringify,
      hasOwn: Object.hasOwn,
      getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
      getPrototypeOf: Reflect.getPrototypeOf,
      ownKeys: Reflect.ownKeys,
    };
    Reflect.apply = ((target: never, thisArg: unknown, argumentsList: readonly unknown[]) => {
      inspect("Reflect.apply", [thisArg, ...argumentsList]);
      return originals.apply(target, thisArg, argumentsList as never);
    }) as typeof Reflect.apply;
    JSON.parse = ((text: string) => {
      inspect("JSON.parse", [text]);
      return originals.parse(text);
    }) as typeof JSON.parse;
    JSON.stringify = ((input: unknown) => {
      inspect("JSON.stringify", [input]);
      return originals.stringify(input);
    }) as typeof JSON.stringify;
    Object.hasOwn = ((target: object, property: PropertyKey) => {
      inspect("Object.hasOwn", [target]);
      return originals.hasOwn(target, property);
    }) as typeof Object.hasOwn;
    Reflect.getOwnPropertyDescriptor = ((target: object, property: PropertyKey) => {
      inspect("Reflect.getOwnPropertyDescriptor", [target]);
      return originals.getOwnPropertyDescriptor(target, property);
    }) as typeof Reflect.getOwnPropertyDescriptor;
    Reflect.getPrototypeOf = ((target: object) => {
      inspect("Reflect.getPrototypeOf", [target]);
      return originals.getPrototypeOf(target);
    }) as typeof Reflect.getPrototypeOf;
    Reflect.ownKeys = ((target: object) => {
      inspect("Reflect.ownKeys", [target]);
      return originals.ownKeys(target);
    }) as typeof Reflect.ownKeys;
    // deno-lint-ignore no-explicit-any
    (Object.prototype as any).toJSON = function () {
      inspect("Object.prototype.toJSON", [this]);
      return this;
    };

    try {
      await store.publish(namespace, "on:54uvgwr2ih7p", value, expiresAt);
      assertEquals(await store.read(namespace, "on:54uvgwr2ih7p"), { value, expiresAt });
    } finally {
      Reflect.apply = originals.apply;
      JSON.parse = originals.parse;
      JSON.stringify = originals.stringify;
      Object.hasOwn = originals.hasOwn;
      Reflect.getOwnPropertyDescriptor = originals.getOwnPropertyDescriptor;
      Reflect.getPrototypeOf = originals.getPrototypeOf;
      Reflect.ownKeys = originals.ownKeys;
      // deno-lint-ignore no-explicit-any
      delete (Object.prototype as any).toJSON;
    }

    assertEquals(observedLeaks, []);
  });
});
