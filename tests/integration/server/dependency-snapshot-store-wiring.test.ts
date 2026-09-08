import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backends/memory.ts";
import {
  _createSharedDependencySnapshotCacheBackend,
  _setSharedDependencySnapshotStoreBackendForTest,
  getSharedDependencySnapshotStoreHandle,
} from "#veryfront/cache/dependency-snapshot-store.ts";
import { createDependencySnapshotStoreHandle } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
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

// Both the pinning rollout and the shared-backend predicates read process
// configuration, so every test here pins the environment it needs and
// restores whatever the process had.
const MANAGED_ENV = [
  "VERYFRONT_DEPENDENCY_PINNING",
  "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT",
  "VERYFRONT_API_BASE_URL",
  "PROXY_MODE",
  "REDIS_URL",
] as const;

describe("shared dependency snapshot store wiring", () => {
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
    _setSharedDependencySnapshotStoreBackendForTest(undefined);
    clearReactVersionCache();
  });

  it("resolves a pre-writeback snapshot on a cold replica through the shared store", async () => {
    _setSharedDependencySnapshotStoreBackendForTest(new MemoryCacheBackend());
    const adapter = createMockAdapter();
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

  it("keeps local projects on process-local history", async () => {
    // A CLI-authenticated local dev process can satisfy the shared-backend
    // predicates without holding a cache-authorized tenant context, and a
    // failing publication would break local rendering. Local projects never
    // get the automatic store.
    const backend = new MemoryCacheBackend();
    _setSharedDependencySnapshotStoreBackendForTest(backend);
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');

    const source = createHandlerDependencyPinningSource(
      makeCtx({ adapter, projectId: "local-history-project", isLocalProject: true }),
    );
    const document = await getDependencyPinningSnapshot(source);

    assertEquals(document.cacheKey.startsWith("on:"), true);
    assertEquals(backend.size, 0, "a local project must not publish to the shared store");
  });

  it("defers to an adapter that configures its own snapshot store", async () => {
    _setSharedDependencySnapshotStoreBackendForTest(new MemoryCacheBackend());
    const published: string[] = [];
    const adapterStore = createDependencySnapshotStoreHandle({
      publish: (_namespace: string, key: string) => {
        published.push(key);
        return Promise.resolve();
      },
      read: () => Promise.resolve(null),
    });
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
    Object.defineProperty(adapter, "dependencySnapshotStore", {
      value: adapterStore,
      enumerable: true,
    });

    const source = createHandlerDependencyPinningSource(
      makeCtx({ adapter, projectId: "adapter-store-project", isLocalProject: false }),
    );
    const document = await getDependencyPinningSnapshot(source);

    assertEquals(
      published,
      [document.cacheKey],
      "the host-configured adapter store must receive the publication",
    );
  });

  it("returns no handle when no shared cache backend is configured", () => {
    assertEquals(getSharedDependencySnapshotStoreHandle(), undefined);
  });

  it("returns a handle once a shared backend is configured", () => {
    setEnv("REDIS_URL", "redis://127.0.0.1:1");
    assertExists(getSharedDependencySnapshotStoreHandle());
  });

  it("rejects backend resolution instead of falling back to node-local storage", async () => {
    // Without API cache or Redis configured, backend resolution yields the
    // memory backend. The factory must reject so the distributed-cache
    // accessor records a failure and retries, rather than caching a
    // node-local backend as shared history for the life of the process.
    await assertRejects(() => _createSharedDependencySnapshotCacheBackend());
  });
});
