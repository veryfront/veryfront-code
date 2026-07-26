import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { API_CLIENT_ERROR } from "#veryfront/errors";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { VeryfrontFSAdapter } from "./adapter.ts";
import { ProxyFSAdapterManager } from "./proxy-manager.ts";
import { runWithRequestContext } from "./request-context.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";

const baseConfig = {
  veryfront: {
    apiBaseUrl: "https://api.example.com",
    apiToken: "test-token",
    projectSlug: "test-project",
    cache: { enabled: false },
  },
};

function createManager(
  options: Partial<ConstructorParameters<typeof ProxyFSAdapterManager>[0]> = {},
): ProxyFSAdapterManager {
  return new ProxyFSAdapterManager({ baseConfig, ...options });
}

async function assertGetAdapterRejects(
  manager: ProxyFSAdapterManager,
  args: Parameters<ProxyFSAdapterManager["getAdapter"]>,
  messageIncludes: string,
): Promise<void> {
  try {
    await manager.getAdapter(...args);
    assertEquals(true, false, "Should have thrown");
  } catch (e) {
    assertExists(e);
    assertEquals(e instanceof Error, true);
    assertEquals((e as Error).message.includes(messageIncludes), true);
  }
}

describe("ProxyFSAdapterManager", () => {
  describe("request credential isolation", () => {
    it("keeps interleaved requests on a shared adapter bound to their own tokens", async () => {
      const projectId = "550e8400-e29b-41d4-a716-446655440000";
      const firstAdapterReady = Promise.withResolvers<void>();
      const secondAdapterReady = Promise.withResolvers<void>();
      const bothFetchesStarted = Promise.withResolvers<void>();
      const releaseFetches = Promise.withResolvers<void>();
      const authorizations: string[] = [];
      let sharedAdapter: VeryfrontFSAdapter | undefined;

      const manager = createManager({
        baseConfig: {
          veryfront: {
            ...baseConfig.veryfront,
            apiToken: "must-not-be-used",
            proxyMode: true,
          },
        },
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        await withMockFetch(
          async (input, init) => {
            const headers = init && "headers" in init
              ? init.headers
              : input instanceof Request
              ? input.headers
              : undefined;
            const authorization = new Headers(headers).get("Authorization");
            authorizations.push(authorization ?? "");
            if (authorizations.length === 2) bothFetchesStarted.resolve();
            await releaseFetches.promise;

            return new Response(
              JSON.stringify({
                id: projectId,
                name: "Shared Project",
                slug: "shared-project",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              },
            );
          },
          async () => {
            const firstRequest = runWithRequestContext(
              {
                projectSlug: "shared-project",
                projectId,
                token: "token-a",
              },
              async () => {
                const adapter = await manager.getAdapter(
                  "shared-project",
                  "token-a",
                  projectId,
                  false,
                  null,
                  null,
                  "main",
                );
                sharedAdapter = adapter;
                firstAdapterReady.resolve();
                await secondAdapterReady.promise;
                return adapter.getClient().getProject(projectId);
              },
            );

            const secondRequest = runWithRequestContext(
              {
                projectSlug: "shared-project",
                projectId,
                token: "token-b",
              },
              async () => {
                await firstAdapterReady.promise;
                const adapter = await manager.getAdapter(
                  "shared-project",
                  "token-b",
                  projectId,
                  false,
                  null,
                  null,
                  "main",
                );
                assertEquals(adapter, sharedAdapter);
                secondAdapterReady.resolve();
                return adapter.getClient().getProject(projectId);
              },
            );

            await bothFetchesStarted.promise;
            releaseFetches.resolve();
            await Promise.all([firstRequest, secondRequest]);
          },
        );

        assertEquals(authorizations.toSorted(), [
          "Bearer token-a",
          "Bearer token-b",
        ]);
        const adapterUnderTest = sharedAdapter;
        assertExists(adapterUnderTest);

        const noContextError = assertThrows(
          () => adapterUnderTest.getClient().getToken(),
          VeryfrontError,
          "No immutable request API credential",
        );
        assertEquals(noContextError.status, 401);

        await runWithRequestContext(
          {
            projectSlug: "shared-project",
            projectId: "c0a8012e-7b91-4f75-8202-ef70b4133abc",
            token: "wrong-project-token",
          },
          async () => {
            const mismatchError = assertThrows(
              () => adapterUnderTest.getClient().getToken(),
              VeryfrontError,
              "does not match",
            );
            assertEquals(mismatchError.status, 403);
          },
        );

        const mutationError = assertThrows(
          () => adapterUnderTest.setRequestToken("replacement-token"),
          VeryfrontError,
          "immutable",
        );
        assertEquals(mutationError.status, 409);
      } finally {
        releaseFetches.resolve();
        manager.dispose();
      }
    });

    it("rejects cache reuse when the request project ID changes", async () => {
      const manager = createManager({
        baseConfig: {
          veryfront: {
            ...baseConfig.veryfront,
            proxyMode: true,
          },
        },
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });

      try {
        await manager.getAdapter(
          "shared-project",
          "token-a",
          "550e8400-e29b-41d4-a716-446655440000",
          false,
          null,
          null,
          "main",
        );

        await assertGetAdapterRejects(
          manager,
          [
            "shared-project",
            "token-b",
            "c0a8012e-7b91-4f75-8202-ef70b4133abc",
            false,
            null,
            null,
            "main",
          ],
          "project identity does not match",
        );
      } finally {
        manager.dispose();
      }
    });
  });

  describe("bounded lifecycle", () => {
    it("evicts the registry generation owned by a disposed adapter", async () => {
      const adapterManager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      const registry = new ProjectScopedRegistryManager<string>("adapter-lifecycle");
      const projectSlug = "registry-lifecycle-project";
      const projectId = "registry:lifecycle:id";
      const requestOptions = {
        projectSlug,
        projectId,
        token: "registry-token",
        branch: "main",
      };

      try {
        await runWithRequestContext(requestOptions, async () => {
          await adapterManager.getAdapter(
            projectSlug,
            requestOptions.token,
            projectId,
            false,
            null,
            null,
            "main",
          );
          registry.register("item", "generation");
        });

        adapterManager.evictAdapter(projectSlug, false, null, "main");

        await runWithRequestContext(requestOptions, async () => {
          assertEquals(registry.get("item"), undefined);
        });
      } finally {
        adapterManager.dispose();
      }
    });

    it("releases request leases after post-import collection poisoning", async () => {
      let disposeCalls = 0;
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            disposeCalls++;
          };
          return adapter;
        },
      });

      const expectedAdapter = await runWithRequestContext(
        { projectSlug: "primordial-project", token: "token-a" },
        () =>
          manager.getAdapter(
            "primordial-project",
            "token-a",
            undefined,
            false,
            null,
            null,
            "main",
          ),
      );

      const requestHoldingLease = Promise.withResolvers<void>();
      const releaseRequest = Promise.withResolvers<void>();
      const originalMapClear = Map.prototype.clear;
      const originalMapDelete = Map.prototype.delete;
      const originalMapForEach = Map.prototype.forEach;
      const originalMapGet = Map.prototype.get;
      const originalMapHas = Map.prototype.has;
      const originalMapSet = Map.prototype.set;
      const originalSetAdd = Set.prototype.add;
      const originalSetDelete = Set.prototype.delete;
      const originalSetHas = Set.prototype.has;
      const originalWeakMapDelete = WeakMap.prototype.delete;
      const originalWeakMapGet = WeakMap.prototype.get;
      const originalWeakMapSet = WeakMap.prototype.set;
      let selectedAdapter: VeryfrontFSAdapter | undefined;
      let capacityError: unknown;
      let activeRequest: Promise<void> | undefined;

      try {
        Map.prototype.clear = (() => {
          throw new Error("ambient Map.clear must not run");
        }) as typeof Map.prototype.clear;
        Map.prototype.delete = (() => {
          throw new Error("ambient Map.delete must not run");
        }) as typeof Map.prototype.delete;
        Map.prototype.forEach = (() => {
          throw new Error("ambient Map.forEach must not run");
        }) as typeof Map.prototype.forEach;
        Map.prototype.get = (() => {
          throw new Error("ambient Map.get must not run");
        }) as typeof Map.prototype.get;
        Map.prototype.has = (() => {
          throw new Error("ambient Map.has must not run");
        }) as typeof Map.prototype.has;
        Map.prototype.set = (() => {
          throw new Error("ambient Map.set must not run");
        }) as typeof Map.prototype.set;
        Set.prototype.add = (() => {
          throw new Error("ambient Set.add must not run");
        }) as typeof Set.prototype.add;
        Set.prototype.delete = (() => {
          throw new Error("ambient Set.delete must not run");
        }) as typeof Set.prototype.delete;
        Set.prototype.has = (() => {
          throw new Error("ambient Set.has must not run");
        }) as typeof Set.prototype.has;
        WeakMap.prototype.delete = (() => {
          throw new Error("ambient WeakMap.delete must not run");
        }) as typeof WeakMap.prototype.delete;
        WeakMap.prototype.get = (() => {
          throw new Error("ambient WeakMap.get must not run");
        }) as typeof WeakMap.prototype.get;
        WeakMap.prototype.set = (() => {
          throw new Error("ambient WeakMap.set must not run");
        }) as typeof WeakMap.prototype.set;

        activeRequest = runWithRequestContext(
          { projectSlug: "primordial-project", token: "token-b" },
          async () => {
            selectedAdapter = await manager.getAdapter(
              "primordial-project",
              "token-b",
              undefined,
              false,
              null,
              null,
              "main",
            );
            requestHoldingLease.resolve();
            await releaseRequest.promise;
          },
        );
        await requestHoldingLease.promise;

        try {
          await runWithRequestContext(
            { projectSlug: "second-project", token: "token-c" },
            () =>
              manager.getAdapter(
                "second-project",
                "token-c",
                undefined,
                false,
                null,
                null,
                "main",
              ),
          );
        } catch (error) {
          capacityError = error;
        }

        releaseRequest.resolve();
        await activeRequest;
      } finally {
        releaseRequest.resolve();
        Map.prototype.clear = originalMapClear;
        Map.prototype.delete = originalMapDelete;
        Map.prototype.forEach = originalMapForEach;
        Map.prototype.get = originalMapGet;
        Map.prototype.has = originalMapHas;
        Map.prototype.set = originalMapSet;
        Set.prototype.add = originalSetAdd;
        Set.prototype.delete = originalSetDelete;
        Set.prototype.has = originalSetHas;
        WeakMap.prototype.delete = originalWeakMapDelete;
        WeakMap.prototype.get = originalWeakMapGet;
        WeakMap.prototype.set = originalWeakMapSet;
        await activeRequest;
      }

      try {
        assertEquals(selectedAdapter, expectedAdapter);
        assertEquals(capacityError instanceof Error, true);
        assertEquals(
          (capacityError as Error).message.includes("fully leased or initializing"),
          true,
        );
        manager.evictAdapter("primordial-project", false, null, "main");
        assertEquals(disposeCalls, 1);
        assertEquals(
          manager.hasAdapter("primordial-project", false, null, "main"),
          false,
        );
      } finally {
        manager.dispose();
      }
    });

    it("runs every manager disposal even when an earlier adapter throws", async () => {
      const firstCleanupError = new Error("first adapter cleanup failed");
      const disposedProjects: string[] = [];
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          const projectSlug = config.veryfront?.projectSlug ?? "";
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            disposedProjects.push(projectSlug);
            if (projectSlug === "first-project") throw firstCleanupError;
          };
          return adapter;
        },
      });

      for (const projectSlug of ["first-project", "second-project"]) {
        await runWithRequestContext(
          { projectSlug, token: "token" },
          () =>
            manager.getAdapter(
              projectSlug,
              "token",
              undefined,
              false,
              null,
              null,
              "main",
            ),
        );
      }

      let caught: unknown;
      try {
        manager.dispose();
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, firstCleanupError);
      assertEquals(disposedProjects, ["first-project", "second-project"]);
      assertEquals(manager.getStats().adapters, 0);
    });

    it("keeps initialization failure primary when adapter cleanup also throws", async () => {
      const initializationError = new Error("initialization failed");
      const cleanupError = new Error("cleanup failed");
      let disposeCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.reject(initializationError);
          adapter.dispose = () => {
            disposeCalls++;
            throw cleanupError;
          };
          return adapter;
        },
      });

      let caught: unknown;
      try {
        await runWithRequestContext(
          { projectSlug: "failed-project", token: "token" },
          () =>
            manager.getAdapter(
              "failed-project",
              "token",
              undefined,
              false,
              null,
              null,
              "main",
            ),
        );
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, initializationError);
      assertEquals(disposeCalls, 1);
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
    });

    it("cleans late-opened resources after manager disposal even when disposal throws", async () => {
      const initializationStarted = Promise.withResolvers<void>();
      const releaseInitialization = Promise.withResolvers<void>();
      const cleanupError = new Error("cleanup failed");
      let disposeCalls = 0;
      let resourceOpen = false;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            initializationStarted.resolve();
            await releaseInitialization.promise;
            resourceOpen = true;
          };
          adapter.dispose = () => {
            disposeCalls++;
            resourceOpen = false;
            throw cleanupError;
          };
          return adapter;
        },
      });

      const pending = runWithRequestContext(
        { projectSlug: "pending-project", token: "token" },
        () =>
          manager.getAdapter(
            "pending-project",
            "token",
            undefined,
            false,
            null,
            null,
            "main",
          ),
      );

      await initializationStarted.promise;
      let disposeCaught: unknown;
      try {
        manager.dispose();
      } catch (error) {
        disposeCaught = error;
      }
      assertEquals(disposeCaught, cleanupError);
      assertEquals(disposeCalls, 1);

      releaseInitialization.resolve();
      await assertRejects(
        () => pending,
        VeryfrontError,
        "disposed during adapter initialization",
      );
      assertEquals(disposeCalls, 2);
      assertEquals(resourceOpen, false);
      assertEquals(manager.getStats().adapters, 0);
    });

    it("removes an evicted adapter even when its disposal throws", async () => {
      const cleanupError = new Error("cleanup failed");
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            throw cleanupError;
          };
          return adapter;
        },
      });

      await runWithRequestContext(
        { projectSlug: "evicted-project", token: "token" },
        () =>
          manager.getAdapter(
            "evicted-project",
            "token",
            undefined,
            false,
            null,
            null,
            "main",
          ),
      );

      let caught: unknown;
      try {
        manager.evictAdapter("evicted-project", false, null, "main");
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, cleanupError);
      assertEquals(
        manager.hasAdapter("evicted-project", false, null, "main"),
        false,
      );
      manager.dispose();
    });

    it("preserves a request failure when deferred eviction cleanup also throws", async () => {
      const primaryError = new Error("request failed");
      const cleanupError = new Error("cleanup failed");
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            throw cleanupError;
          };
          return adapter;
        },
      });

      let caught: unknown;
      try {
        await runWithRequestContext(
          { projectSlug: "leased-project", token: "token" },
          async () => {
            await manager.getAdapter(
              "leased-project",
              "token",
              undefined,
              false,
              null,
              null,
              "main",
            );
            manager.evictAdapter("leased-project", false, null, "main");
            throw primaryError;
          },
        );
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, primaryError);
      assertEquals(
        manager.hasAdapter("leased-project", false, null, "main"),
        false,
      );
      manager.dispose();
    });

    it("does not publish an adapter whose manager was disposed during initialization", async () => {
      const initializationStarted = Promise.withResolvers<void>();
      const releaseInitialization = Promise.withResolvers<void>();
      let disposeCalls = 0;
      let resourceOpen = false;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            initializationStarted.resolve();
            await releaseInitialization.promise;
            resourceOpen = true;
          };
          adapter.dispose = () => {
            disposeCalls++;
            resourceOpen = false;
          };
          return adapter;
        },
      });

      const pending = runWithRequestContext(
        { projectSlug: "pending-project", token: "token-a" },
        () =>
          manager.getAdapter(
            "pending-project",
            "token-a",
            undefined,
            false,
            null,
            null,
            "main",
          ),
      );

      await initializationStarted.promise;
      manager.dispose();
      assertEquals(disposeCalls, 1);
      releaseInitialization.resolve();

      await assertRejects(
        () => pending,
        VeryfrontError,
        "disposed during adapter initialization",
      );
      assertEquals(manager.getStats().adapters, 0);
      await assertRejects(
        () =>
          manager.getAdapter(
            "pending-project",
            "token-a",
            undefined,
            false,
            null,
            null,
            "main",
          ),
        VeryfrontError,
        "after the manager is disposed",
      );
      assertEquals(disposeCalls, 2);
      assertEquals(resourceOpen, false);
    });

    it("cancels late publication when a pending adapter is invalidated", async () => {
      const initializationStarted = Promise.withResolvers<void>();
      const releaseInitialization = Promise.withResolvers<void>();
      let disposeCalls = 0;
      let resourceOpen = false;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            initializationStarted.resolve();
            await releaseInitialization.promise;
            resourceOpen = true;
          };
          adapter.dispose = () => {
            disposeCalls++;
            resourceOpen = false;
          };
          return adapter;
        },
      });

      try {
        const pending = runWithRequestContext(
          { projectSlug: "pending-project", token: "token-a" },
          () =>
            manager.getAdapter(
              "pending-project",
              "token-a",
              undefined,
              false,
              null,
              null,
              "main",
            ),
        );

        await initializationStarted.promise;
        manager.evictAdapter("pending-project", false, null, "main");
        assertEquals(disposeCalls, 1);
        releaseInitialization.resolve();

        await assertRejects(
          () => pending,
          VeryfrontError,
          "initialization was invalidated",
        );
        assertEquals(
          manager.hasAdapter("pending-project", false, null, "main"),
          false,
        );
        assertEquals(disposeCalls, 2);
        assertEquals(resourceOpen, false);
      } finally {
        releaseInitialization.resolve();
        manager.dispose();
      }
    });

    it("counts pending initializations against the adapter capacity", async () => {
      const initializationStarted = Promise.withResolvers<void>();
      const releaseInitialization = Promise.withResolvers<void>();
      let createdAdapters = 0;
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          createdAdapters++;
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            initializationStarted.resolve();
            await releaseInitialization.promise;
          };
          return adapter;
        },
      });

      try {
        const first = runWithRequestContext(
          { projectSlug: "first-project", token: "token-a" },
          () =>
            manager.getAdapter(
              "first-project",
              "token-a",
              undefined,
              false,
              null,
              null,
              "main",
            ),
        );
        await initializationStarted.promise;

        await assertRejects(
          () =>
            runWithRequestContext(
              { projectSlug: "second-project", token: "token-b" },
              () =>
                manager.getAdapter(
                  "second-project",
                  "token-b",
                  undefined,
                  false,
                  null,
                  null,
                  "main",
                ),
            ),
          VeryfrontError,
          "capacity (1) is fully leased or initializing",
        );
        assertEquals(createdAdapters, 1);

        releaseInitialization.resolve();
        await first;
        assertEquals(manager.getStats().adapters, 1);
      } finally {
        releaseInitialization.resolve();
        manager.dispose();
      }
    });

    it("does not evict an adapter leased by an active request", async () => {
      const firstRequestHoldingLease = Promise.withResolvers<void>();
      const releaseFirstRequest = Promise.withResolvers<void>();
      const disposedProjects: string[] = [];
      const manager = createManager({
        maxAdapters: 1,
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            disposedProjects.push(config.veryfront?.projectSlug ?? "");
          };
          return adapter;
        },
      });

      try {
        const firstRequest = runWithRequestContext(
          { projectSlug: "first-project", token: "token-a" },
          async () => {
            await manager.getAdapter(
              "first-project",
              "token-a",
              undefined,
              false,
              null,
              null,
              "main",
            );
            firstRequestHoldingLease.resolve();
            await releaseFirstRequest.promise;
          },
        );
        await firstRequestHoldingLease.promise;

        await assertRejects(
          () =>
            runWithRequestContext(
              { projectSlug: "second-project", token: "token-b" },
              () =>
                manager.getAdapter(
                  "second-project",
                  "token-b",
                  undefined,
                  false,
                  null,
                  null,
                  "main",
                ),
            ),
          VeryfrontError,
          "fully leased or initializing",
        );
        assertEquals(disposedProjects, []);

        releaseFirstRequest.resolve();
        await firstRequest;
        await runWithRequestContext(
          { projectSlug: "second-project", token: "token-b" },
          () =>
            manager.getAdapter(
              "second-project",
              "token-b",
              undefined,
              false,
              null,
              null,
              "main",
            ),
        );
        assertEquals(disposedProjects, ["first-project"]);
      } finally {
        releaseFirstRequest.resolve();
        manager.dispose();
      }
    });

    it("defers explicit invalidation until the active request lease is released", async () => {
      const requestHoldingLease = Promise.withResolvers<void>();
      const releaseRequest = Promise.withResolvers<void>();
      let disposeCalls = 0;
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            disposeCalls++;
          };
          return adapter;
        },
      });

      try {
        const request = runWithRequestContext(
          { projectSlug: "leased-project", token: "token-a" },
          async () => {
            await manager.getAdapter(
              "leased-project",
              "token-a",
              undefined,
              false,
              null,
              null,
              "main",
            );
            requestHoldingLease.resolve();
            await releaseRequest.promise;
          },
        );
        await requestHoldingLease.promise;

        manager.evictAdapter("leased-project", false, null, "main");
        assertEquals(disposeCalls, 0);
        await assertRejects(
          () =>
            runWithRequestContext(
              { projectSlug: "leased-project", token: "token-b" },
              () =>
                manager.getAdapter(
                  "leased-project",
                  "token-b",
                  undefined,
                  false,
                  null,
                  null,
                  "main",
                ),
            ),
          VeryfrontError,
          "eviction is pending",
        );

        releaseRequest.resolve();
        await request;
        assertEquals(disposeCalls, 1);
        assertEquals(
          manager.hasAdapter("leased-project", false, null, "main"),
          false,
        );
      } finally {
        releaseRequest.resolve();
        manager.dispose();
      }
    });

    it("defers idle cleanup until the active request lease is released", async () => {
      const requestHoldingLease = Promise.withResolvers<void>();
      const releaseRequest = Promise.withResolvers<void>();
      let disposeCalls = 0;
      const manager = createManager({
        maxIdleMs: 0,
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          adapter.dispose = () => {
            disposeCalls++;
          };
          return adapter;
        },
      });
      const internals = manager as unknown as {
        adapters: Map<string, { lastAccessed: number }>;
        cleanupIdleAdapters: () => void;
      };

      try {
        const request = runWithRequestContext(
          { projectSlug: "leased-project", token: "token-a" },
          async () => {
            await manager.getAdapter(
              "leased-project",
              "token-a",
              undefined,
              false,
              null,
              null,
              "main",
            );
            requestHoldingLease.resolve();
            await releaseRequest.promise;
          },
        );
        await requestHoldingLease.promise;

        const cached = Array.from(internals.adapters.values())[0];
        assertExists(cached);
        cached.lastAccessed = 0;
        internals.cleanupIdleAdapters();
        assertEquals(disposeCalls, 0);

        releaseRequest.resolve();
        await request;
        internals.cleanupIdleAdapters();
        assertEquals(disposeCalls, 1);
        assertEquals(manager.getStats().adapters, 0);
      } finally {
        releaseRequest.resolve();
        manager.dispose();
      }
    });
  });

  describe("exact preview source", () => {
    it("propagates a missing push branch without loading main", async () => {
      const branch = "push-20260324t121046";
      const error = API_CLIENT_ERROR.create({
        detail: "API request failed: 404 Not Found",
        status: 404,
        context: {
          details: {
            responseText: JSON.stringify({ detail: `Branch '${branch}' not found` }),
            url:
              `https://api.example.com/projects/my-project/files?limit=100&sort_by=updated_at&sort_order=desc&branch=${
                encodeURIComponent(branch)
              }`,
          },
        },
      });
      const attemptedBranches: Array<string | null | undefined> = [];
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = async () => {
            const context = adapter.getContentContext();
            attemptedBranches.push(context?.sourceType === "branch" ? context.branch : null);
            throw error;
          };
          return adapter;
        },
      });

      try {
        await assertRejects(
          () =>
            manager.getAdapter(
              "my-project",
              "test-token",
              undefined,
              false,
              null,
              null,
              branch,
            ),
          Error,
          "API request failed: 404 Not Found",
        );
        assertEquals(attemptedBranches, [branch]);
        assertEquals(manager.hasAdapter("my-project", false, null, "main"), false);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("exact production source", () => {
    it("rejects mutable environment selection without an immutable release", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["my-project", "test-token", undefined, true, null, "Production", null],
          "releaseId is required in production mode",
        );
      } finally {
        manager.dispose();
      }
    });

    it("keeps environment name and release id in the resolved context", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          "Production",
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "environment",
          projectSlug: "my-project",
          environmentName: "Production",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("keeps a release-only source distinct from the production environment", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        const adapter = await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(adapter.getContentContext(), {
          sourceType: "release",
          projectSlug: "my-project",
          releaseId: "release-42",
        });
      } finally {
        manager.dispose();
      }
    });

    it("uses the release-only identity for lookup and eviction", async () => {
      const manager = createManager({
        adapterFactory: (config) => {
          const adapter = new VeryfrontFSAdapter(config);
          adapter.initialize = () => Promise.resolve();
          return adapter;
        },
      });
      try {
        await manager.getAdapter(
          "my-project",
          "test-token",
          undefined,
          true,
          "release-42",
          null,
          null,
        );

        assertEquals(manager.hasAdapter("my-project", true, "release-42"), true);
        assertEquals(
          manager.hasAdapter("my-project", true, "release-42", null, "Production"),
          false,
        );

        manager.evictAdapter("my-project", true, "release-42");
        assertEquals(manager.hasAdapter("my-project", true, "release-42"), false);
      } finally {
        manager.dispose();
      }
    });
  });

  describe("class", () => {
    it("should export ProxyFSAdapterManager class", () => {
      assertExists(ProxyFSAdapterManager);
      assertEquals(typeof ProxyFSAdapterManager, "function");
    });
  });

  describe("constructor", () => {
    it("should be instantiable with minimal config", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxAdapters option", () => {
      const manager = createManager({ maxAdapters: 50 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept maxIdleMs option", () => {
      const manager = createManager({ maxIdleMs: 60000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should accept cleanupIntervalMs option", () => {
      const manager = createManager({ cleanupIntervalMs: 30000 });
      assertExists(manager);
      manager.dispose();
    });

    it("should default maxAdapters to 100", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });
  });

  describe("methods", () => {
    it("should have getAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getAdapter, "function");
      manager.dispose();
    });

    it("should have hasAdapter method", () => {
      const manager = createManager();
      assertEquals(typeof manager.hasAdapter, "function");
      manager.dispose();
    });

    it("should have getStats method", () => {
      const manager = createManager();
      assertEquals(typeof manager.getStats, "function");
      manager.dispose();
    });

    it("should have dispose method", () => {
      const manager = createManager();
      assertEquals(typeof manager.dispose, "function");
      manager.dispose();
    });
  });

  describe("hasAdapter", () => {
    it("should return false for non-existent adapter", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("non-existent-project"), false);
      manager.dispose();
    });

    it("should differentiate adapters by branch in preview mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", false, null, "main"), false);
      assertEquals(manager.hasAdapter("project", false, null, "feature-x"), false);
      assertEquals(manager.hasAdapter("project", false, null, null), false);
      manager.dispose();
    });

    it("should treat null branch as main branch", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", false, null, null),
        manager.hasAdapter("project", false, null, "main"),
      );
      manager.dispose();
    });

    it("should ignore branch for production mode", () => {
      const manager = createManager();
      assertEquals(
        manager.hasAdapter("project", true, "rel-123", "main"),
        manager.hasAdapter("project", true, "rel-123", "feature-x"),
      );
      manager.dispose();
    });

    it("should differentiate by releaseId in production mode", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("project", true, "rel-1"), false);
      assertEquals(manager.hasAdapter("project", true, "rel-2"), false);
      manager.dispose();
    });

    it("rejects release-less production cache lookups", () => {
      const manager = createManager();
      assertThrows(
        () => manager.hasAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
      assertThrows(
        () => manager.evictAdapter("project", true, null, null, "Production"),
        Error,
        "Missing releaseId in production",
      );
      manager.dispose();
    });
  });

  describe("getStats", () => {
    it("should return stats object with zero adapters initially", () => {
      const manager = createManager();
      const stats = manager.getStats();
      assertExists(stats);
      assertEquals(stats.adapters, 0);
      assertExists(stats.stats);
      assertEquals(Object.keys(stats.stats).length, 0);
      manager.dispose();
    });
  });

  describe("dispose", () => {
    it("should dispose without error", () => {
      const manager = createManager();
      manager.dispose();
    });

    it("should allow multiple dispose calls", () => {
      const manager = createManager();
      manager.dispose();
      manager.dispose();
    });

    it("should stop cleanup timer on dispose", () => {
      const manager = createManager({ cleanupIntervalMs: 1000 });
      manager.dispose();
    });

    it("should clear all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });
  });

  describe("getAdapter validation", () => {
    it("should reject empty projectSlug", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["", "valid-token", undefined, false],
          "projectSlug",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should reject empty token", async () => {
      const manager = createManager();
      try {
        await assertGetAdapterRejects(
          manager,
          ["valid-slug", "", undefined, false],
          "token",
        );
      } finally {
        manager.dispose();
      }
    });

    it("should accept valid parameters structurally", () => {
      const manager = createManager();
      assertExists(manager);
      manager.dispose();
    });
  });

  describe("adapter lifecycle", () => {
    it("should not have adapter before getAdapter is called", () => {
      const manager = createManager();
      assertEquals(manager.hasAdapter("test-project", false, null, "main"), false);
      manager.dispose();
    });

    it("should remove all adapters on dispose", () => {
      const manager = createManager();
      assertEquals(manager.getStats().adapters, 0);
      manager.dispose();
      assertEquals(manager.getStats().adapters, 0);
    });
  });
});
