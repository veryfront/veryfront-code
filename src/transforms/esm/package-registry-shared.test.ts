import "#veryfront/schemas/_test-setup.ts";
import { createDependencySnapshotStoreHandle } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
  getRememberedDependencyPinningSnapshot,
  isCurrentDependencyPinningSnapshot,
  readProjectDependencyVersions,
  resolveRequestedDependencyPinningSnapshot,
  withDependencyPinningSourceFileSystem,
} from "./package-registry.ts";
import type {
  DependencySnapshotRecord,
  DependencySnapshotStore,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import {
  __resetRSCHandlerForTests,
  getRSCHandler,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";

function storeFixture(): DependencySnapshotStore {
  const records = new Map<string, DependencySnapshotRecord>();
  return {
    publish: (namespace: string, key: string, value: string, expiresAt: number) => {
      records.set(`${namespace}:${key}`, { value, expiresAt });
      return Promise.resolve();
    },
    read: (namespace: string, key: string) =>
      Promise.resolve(records.get(`${namespace}:${key}`) ?? null),
  } satisfies DependencySnapshotStore;
}

describe("shared dependency history", () => {
  const prior = new Map<string, string | undefined>();
  beforeEach(() => {
    for (
      const name of ["VERYFRONT_DEPENDENCY_PINNING", "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT"]
    ) {
      prior.set(name, getHostEnv(name));
      setEnv(name, name.endsWith("PERCENT") ? "100" : "1");
    }
    clearReactVersionCache();
  });
  afterEach(() => {
    for (const [name, value] of prior) {
      if (value === undefined) deleteEnv(name);
      else setEnv(name, value);
    }
    clearReactVersionCache();
  });
  function sourceFixture(store: DependencySnapshotStore) {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "test-project",
      adapter,
      isLocalProject: false,
      snapshotStore: createDependencySnapshotStoreHandle(store),
    });
    return { adapter, source };
  }
  it("shares explicit standalone project identity across different mount paths", async () => {
    const store = storeFixture();
    const a = createDependencyPinningSource({
      projectDir: "/mount-a",
      projectId: "same-project",
      isLocalProject: true,
      snapshotStore: createDependencySnapshotStoreHandle(store),
    });
    const b = createDependencyPinningSource({
      projectDir: "/mount-b",
      projectId: "same-project",
      isLocalProject: true,
      snapshotStore: createDependencySnapshotStoreHandle(store),
    });
    assertEquals(a.cacheNamespace, b.cacheNamespace);
    assertEquals(typeof a.cacheNamespace, "string");
  });
  it("keeps the privileged provider out of recursively inspected renderer state", () => {
    const { source, adapter } = sourceFixture(storeFixture());
    const originalAdd = WeakSet.prototype.add;
    let exposed = false;
    try {
      WeakSet.prototype.add = function (value) {
        if (value && typeof value === "object" && "publish" in value && "read" in value) {
          exposed = true;
        }
        return originalAdd.call(this, value);
      };
      getRSCHandler("/project", "test-project", { adapter, dependencyPinningSource: source });
    } finally {
      WeakSet.prototype.add = originalAdd;
      __resetRSCHandlerForTests();
    }
    assertEquals(exposed, false);
    assertEquals(Object.hasOwn(source, "snapshotStore"), false);
    assertEquals(Reflect.set(source, "cacheNamespace", "other-project"), false);
  });
  it("preserves private history when filesystem tracking rebinds a source", async () => {
    const { source, adapter } = sourceFixture(storeFixture());
    const snapshot = await getDependencyPinningSnapshot(source);
    const tracked = withDependencyPinningSourceFileSystem(source, "/project", adapter.fs);
    adapter.fs.files.set("/project/package.json", '{"dependencies":{"react":"19.2.4"}}');
    clearReactVersionCache();
    assertEquals(
      await resolveRequestedDependencyPinningSnapshot(tracked, snapshot.cacheKey),
      snapshot,
    );
    assertEquals(Object.hasOwn(tracked, "snapshotStore"), false);
  });
  it("captures adapter storage and absence before renderer callbacks can replace them", async () => {
    for (const configured of [false, true]) {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
      let hostWrites = 0, injectedWrites = 0;
      const host = storeFixture();
      const runtimeAdapter = {
        ...adapter,
        dependencySnapshotStore: configured
          ? createDependencySnapshotStoreHandle({
            ...host,
            publish: async (...args: Parameters<DependencySnapshotStore["publish"]>) => {
              hostWrites++;
              await host.publish(...args);
            },
          })
          : undefined,
      };
      const options = {
        projectDir: "/project",
        projectId: `configured-${configured}`,
        adapter: runtimeAdapter,
        isLocalProject: false,
      };
      createDependencyPinningSource(options);
      runtimeAdapter.dependencySnapshotStore = createDependencySnapshotStoreHandle({
        publish: () => {
          injectedWrites++;
          return Promise.resolve();
        },
        read: () => Promise.resolve(null),
      });
      const source = createDependencyPinningSource(options);
      const originalAdd = WeakSet.prototype.add;
      let exposed = false;
      try {
        WeakSet.prototype.add = function (value) {
          if (value && typeof value === "object" && "publish" in value && "read" in value) {
            exposed = true;
          }
          return originalAdd.call(this, value);
        };
        getRSCHandler("/project", options.projectId, {
          adapter: runtimeAdapter,
          dependencyPinningSource: source,
        });
      } finally {
        WeakSet.prototype.add = originalAdd;
        __resetRSCHandlerForTests();
      }
      await getDependencyPinningSnapshot(source);
      assertEquals(exposed, false);
      assertEquals(injectedWrites, 0);
      assertEquals(hostWrites, configured ? 1 : 0);
    }
  });
  it("honors an explicit source provider before a malformed adapter override", async () => {
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
    Object.defineProperty(adapter, "dependencySnapshotStore", { value: {} });
    const store = storeFixture();
    let publications = 0;
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "source-priority",
      adapter,
      isLocalProject: false,
      snapshotStore: createDependencySnapshotStoreHandle({
        ...store,
        publish: async (...args: Parameters<DependencySnapshotStore["publish"]>) => {
          publications++;
          await store.publish(...args);
        },
      }),
    });
    await getDependencyPinningSnapshot(source);
    assertEquals(publications, 1);
  });
  it("does not acquire a Cloud transport from environment variables", async () => {
    const names = [
      "VERYFRONT_SHARED_DEPENDENCY_SNAPSHOTS",
      "VERYFRONT_API_BASE_URL",
      "VERYFRONT_API_INTERNAL_USER",
      "VERYFRONT_API_INTERNAL_PASS",
    ];
    const values = [
      "1",
      "https://snapshot.example.invalid",
      "synthetic-user",
      "synthetic-password",
    ];
    const previous = names.map((name) => getHostEnv(name));
    try {
      names.forEach((name, index) => setEnv(name, values[index]!));
      let requests = 0;
      await withMockFetch((_input, init) => {
        requests++;
        const body = JSON.parse(String(init?.body));
        return Promise.resolve(Response.json({ expires_at: body.expires_at }));
      }, async () => {
        for (const configured of [false, true]) {
          const adapter = createMockAdapter();
          adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
          const store = storeFixture();
          let publications = 0;
          if (configured) {
            Object.defineProperty(adapter, "dependencySnapshotStore", {
              value: createDependencySnapshotStoreHandle({
                ...store,
                publish: async (...args: Parameters<DependencySnapshotStore["publish"]>) => {
                  publications++;
                  await store.publish(...args);
                },
              }),
            });
          }
          const source = createDependencyPinningSource({
            projectDir: "/project",
            projectId: `explicit-storage-${configured}`,
            adapter,
            isLocalProject: false,
          });
          await getDependencyPinningSnapshot(source);
          assertEquals(publications, configured ? 1 : 0);
        }
      });
      assertEquals(requests, 0);
    } finally {
      names.forEach((name, index) => {
        const value = previous[index];
        if (value === undefined) deleteEnv(name);
        else setEnv(name, value);
      });
    }
  });
  it("ignores inherited store overrides when capturing and resolving sources", async () => {
    let hostPublications = 0, injectedOperations = 0;
    const host = storeFixture();
    const adapter = createMockAdapter();
    adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
    const hostedAdapter = {
      ...adapter,
      dependencySnapshotStore: createDependencySnapshotStoreHandle({
        ...host,
        publish: async (...args: Parameters<DependencySnapshotStore["publish"]>) => {
          hostPublications++;
          await host.publish(...args);
        },
      }),
    };
    Object.defineProperty(Object.prototype, "snapshotStore", {
      configurable: true,
      value: {
        publish: () => {
          injectedOperations++;
          return Promise.resolve();
        },
        read: () => {
          injectedOperations++;
          return Promise.resolve(null);
        },
      },
    });
    try {
      const source = createDependencyPinningSource({
        projectDir: "/project",
        projectId: "test-project",
        adapter: hostedAdapter,
        isLocalProject: false,
      });
      await getDependencyPinningSnapshot(source);
      await getDependencyPinningSnapshot({ projectDir: "/project", fs: adapter.fs });
    } finally {
      Reflect.deleteProperty(Object.prototype, "snapshotStore");
    }
    assertEquals(hostPublications, 1);
    assertEquals(injectedOperations, 0);
  });
  it("loads published historical dependencies after all process-local history is cleared", async () => {
    const { adapter, source } = sourceFixture(storeFixture());
    const original = await getDependencyPinningSnapshot(source);
    adapter.fs.files.set("/project/package.json", '{"dependencies":{"react":"19.2.4"}}');
    clearReactVersionCache();
    const recovered = await resolveRequestedDependencyPinningSnapshot(source, original.cacheKey);
    assertEquals(recovered, original);
    assertEquals(isCurrentDependencyPinningSnapshot(source, original.cacheKey), false);
    const current = await getDependencyPinningSnapshot(source);
    assertEquals(current.cacheKey === original.cacheKey, false);
    assertEquals(isCurrentDependencyPinningSnapshot(source, current.cacheKey), true);
  });
  it("does not return or remember a snapshot when publication fails", async () => {
    const { source } = sourceFixture({
      publish: () => Promise.reject(new Error("unavailable")),
      read: () => Promise.resolve(null),
    });
    await assertRejects(() => getDependencyPinningSnapshot(source));
    assertEquals(getRememberedDependencyPinningSnapshot(source, "on:54uvgwr2ih7p"), undefined);
    assertEquals(isCurrentDependencyPinningSnapshot(source, "on:54uvgwr2ih7p"), false);
  });
  it("rejects noncanonical requested pins without consulting shared storage", async () => {
    let reads = 0;
    const { source } = sourceFixture({
      publish: () => Promise.resolve(),
      read: () => {
        reads++;
        return Promise.reject(new Error("Must not read"));
      },
    });
    for (
      const key of ["on:unknown", "on:no-project", "on:UPPERCASE", "on:0001", "on:3w5e11264sgsg"]
    ) {
      assertEquals(await resolveRequestedDependencyPinningSnapshot(source, key), undefined);
    }
    assertEquals(reads, 0);
  });
  it("does not let slow publication restore superseded writeback authority", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => release = resolve);
    let started!: () => void;
    const entered = new Promise<void>((resolve) => started = resolve);
    const shared = storeFixture();
    const { adapter, source } = sourceFixture({
      ...shared,
      publish: async (...args) => {
        if (args[1] === "on:54uvgwr2ih7p") {
          started();
          await pending;
        }
        await shared.publish(...args);
      },
    });
    const older = getDependencyPinningSnapshot(source);
    await entered;
    adapter.fs.files.set("/project/package.json", '{"dependencies":{"react":"19.2.4"}}');
    const newer = await getDependencyPinningSnapshot(source);
    release();
    const original = await older;
    assertEquals(isCurrentDependencyPinningSnapshot(source, original.cacheKey), false);
    assertEquals(isCurrentDependencyPinningSnapshot(source, newer.cacheKey), true);
  });
  it("does not reauthorize a capture after a newer raw metadata refresh", async () => {
    for (const replacement of ['{"dependencies":{"react":"19.2.4"}}', '{"invalid"', undefined]) {
      let entered!: () => void, release!: () => void;
      const started = new Promise<void>((resolve) => entered = resolve);
      const pending = new Promise<void>((resolve) => release = resolve);
      const { adapter, source } = sourceFixture({
        publish: () => {
          entered();
          return pending;
        },
        read: () => Promise.resolve(null),
      });
      const captured = getDependencyPinningSnapshot(source);
      try {
        await started;
        if (replacement === undefined) adapter.fs.files.delete("/project/package.json");
        else adapter.fs.files.set("/project/package.json", replacement);
        await readProjectDependencyVersions(source);
      } finally {
        release();
      }
      const old = await captured;
      assertEquals(isCurrentDependencyPinningSnapshot(source, old.cacheKey), false);
      clearReactVersionCache();
    }
  });
  it("does not restore authority after its source metadata was evicted", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => entered = resolve);
    const pending = new Promise<void>((resolve) => release = resolve);
    const { adapter, source } = sourceFixture({
      publish: () => {
        entered();
        return pending;
      },
      read: () => Promise.resolve(null),
    });
    const captured = getDependencyPinningSnapshot(source);
    try {
      await started;
      for (let i = 0; i < 256; i++) {
        await readProjectDependencyVersions({
          projectDir: "/project",
          fs: adapter.fs,
          cacheNamespace: `other-${i}`,
        });
      }
    } finally {
      release();
    }
    const snapshot = await captured;
    assertEquals(isCurrentDependencyPinningSnapshot(source, snapshot.cacheKey), false);
  });
});
