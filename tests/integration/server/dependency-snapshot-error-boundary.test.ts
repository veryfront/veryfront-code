import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { createDependencySnapshotStoreHandle } from "#veryfront/platform/adapters/dependency-snapshot-store.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  clearReactVersionCache,
  createDependencyPinningSource,
} from "#veryfront/transforms/esm/package-registry.ts";
import { serveModule } from "#veryfront/modules/server/module-server.ts";
import { handleRSCEndpoint } from "#veryfront/server/services/rsc/endpoints/endpoint-router.ts";
import {
  makeParams,
  rscEnabledConfig,
} from "#veryfront/server/services/rsc/endpoints/endpoint-router.test-helpers.ts";

describe("dependency snapshot HTTP error boundaries", () => {
  for (const hook of ["false", "throw"] as const) {
    for (const endpoint of ["module", "rsc/module", "rsc/action", "rsc/page"]) {
      it(`preserves ${endpoint} storage errors when hasInstance returns ${hook}`, async () => {
        const names = [
          "VERYFRONT_DEPENDENCY_PINNING",
          "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT",
        ];
        const prior = names.map((name) => getHostEnv(name));
        const descriptor = Object.getOwnPropertyDescriptor(VeryfrontError, Symbol.hasInstance);
        let calls = 0;
        try {
          setEnv(names[0]!, "1");
          setEnv(names[1]!, "100");
          clearReactVersionCache();
          const adapter = createMockAdapter();
          adapter.fs.files.set("/project/app/page.ts", "export const value = 1;");
          Object.defineProperty(adapter, "dependencySnapshotStore", {
            value: createDependencySnapshotStoreHandle({
              publish: () => Promise.reject(new Error("synthetic store failure")),
              read: () => Promise.reject(new Error("synthetic store failure")),
            }),
          });
          Object.defineProperty(VeryfrontError, Symbol.hasInstance, {
            configurable: true,
            value: () => {
              calls++;
              if (hook === "throw") throw new Error("Classification hook must not run");
              return false;
            },
          });
          const source = createDependencyPinningSource({
            projectDir: "/project",
            projectId: "error-boundary",
            adapter,
            isLocalProject: false,
          });
          const pathname = `/_veryfront/${endpoint}`;
          const response = endpoint === "module"
            ? await serveModule(
              new Request(
                "http://localhost/_vf_modules/_pins/on%3A1/app/page.js",
              ),
              {
                projectDir: "/project",
                projectId: "error-boundary",
                adapter,
                isLocalProject: false,
                isProxyMode: true,
                dev: false,
                mode: "preview",
                dependencyPinningSource: source,
              },
            )
            : await handleRSCEndpoint(makeParams({
              projectDir: "/project",
              projectId: "error-boundary",
              pathname,
              adapter,
              isLocalProject: false,
              config: rscEnabledConfig,
              dependencyPinningSource: source,
              req: new Request(`http://localhost${pathname}?rel=app/page.ts&pins=on%3A1`, {
                method: endpoint === "rsc/action" ? "POST" : "GET",
                headers: { "x-veryfront-dependency-pins": "on:1" },
              }),
            }));
          assertEquals(response?.status, 503);
          assertEquals(response?.headers.get("cache-control"), "no-store");
          await response?.body?.cancel();
          assertEquals(calls, 0);
        } finally {
          if (descriptor) Object.defineProperty(VeryfrontError, Symbol.hasInstance, descriptor);
          else Reflect.deleteProperty(VeryfrontError, Symbol.hasInstance);
          names.forEach((name, index) => {
            if (prior[index] === undefined) deleteEnv(name);
            else setEnv(name, prior[index]!);
          });
          clearReactVersionCache();
        }
      });
    }
  }
});
