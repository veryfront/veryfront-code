import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  createDependencySnapshotStoreHandle,
  type DependencySnapshotRecord,
} from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { handleRSCEndpoint } from "#veryfront/server/services/rsc/endpoints/endpoint-router.ts";
import { __resetRSCHandlerForTests } from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import {
  makeParams,
  rscEnabledConfig,
} from "#veryfront/server/services/rsc/endpoints/endpoint-router.test-helpers.ts";

describe("RSC stream snapshot revalidation", () => {
  for (const failure of ["expired", "unavailable"] as const) {
    it(`fails closed when history becomes ${failure} after initial validation`, async () => {
      const flags = [
        "VERYFRONT_DEPENDENCY_PINNING",
        "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT",
      ];
      const previous = flags.map(getHostEnv);
      const adapter = createMockAdapter();
      const records = new Map<string, DependencySnapshotRecord>();
      let rendererStarted = false;
      let historicalReads = 0;
      Object.defineProperty(adapter, "dependencySnapshotStore", {
        value: createDependencySnapshotStoreHandle({
          publish: (namespace, key, value, expiresAt) => {
            records.set(`${namespace}:${key}`, { value, expiresAt });
            return Promise.resolve();
          },
          read: (namespace, key) => {
            historicalReads++;
            if (rendererStarted && failure === "unavailable") {
              return Promise.reject(new Error("unavailable"));
            }
            const record = records.get(`${namespace}:${key}`);
            return Promise.resolve(
              record && rendererStarted ? { ...record, expiresAt: Date.now() - 1 } : record ?? null,
            );
          },
        }),
      });
      try {
        setEnv(flags[0]!, "1");
        setEnv(flags[1]!, "100");
        clearReactVersionCache();
        __resetRSCHandlerForTests();
        adapter.fs.files.set("/project/package.json", '{"dependencies":{}}');
        const source = createDependencyPinningSource({
          projectDir: "/project",
          projectId: "stream-test",
          adapter,
          isLocalProject: false,
        });
        const original = await getDependencyPinningSnapshot(source);
        adapter.fs.files.set("/project/package.json", '{"dependencies":{"react":"19.2.4"}}');
        clearReactVersionCache();
        adapter.fs.readDir = async function* () {
          rendererStarted = true;
          // Model L1 eviction while renderer initialization is in flight.
          clearReactVersionCache();
          yield* [];
        };
        const pathname = "/_veryfront/rsc/stream/";
        const response = await handleRSCEndpoint(makeParams({
          projectDir: "/project",
          projectId: "stream-test",
          pathname,
          adapter,
          isLocalProject: false,
          config: rscEnabledConfig,
          dependencyPinningSource: source,
          req: new Request(`http://localhost${pathname}`, {
            headers: { "x-veryfront-dependency-pins": original.cacheKey },
          }),
        }));
        const body = await response?.text();
        assertEquals(
          rendererStarted,
          true,
          "the initial snapshot check must precede renderer startup",
        );
        assertEquals(historicalReads, 2, "rendering must observe the later history failure");
        assertEquals(response?.status, failure === "expired" ? 409 : 503);
        assertEquals(response?.headers.get("cache-control"), "no-store");
        assertEquals(response?.headers.get("vary"), "x-veryfront-dependency-pins");
        assertEquals(
          body,
          failure === "expired"
            ? "Unknown dependency snapshot"
            : "Dependency snapshot storage is unavailable",
        );
      } finally {
        flags.forEach((name, index) => {
          const value = previous[index];
          if (value === undefined) deleteEnv(name);
          else setEnv(name, value);
        });
        clearReactVersionCache();
        __resetRSCHandlerForTests();
      }
    });
  }
});
