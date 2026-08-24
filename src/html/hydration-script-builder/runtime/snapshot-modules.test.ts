import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModuleNamespace, RuntimeResponse } from "./env.ts";
import {
  createSnapshotModuleImporter,
  isDependencySnapshotConflictResponse,
} from "./snapshot-modules.ts";

function conflictResponse(body: string, status = 409): RuntimeResponse {
  return new Response(body, { status }) as unknown as RuntimeResponse;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the snapshot-bound module import to reject");
}

describe("hydration-script-builder/runtime/snapshot-modules", () => {
  describe("isDependencySnapshotConflictResponse", () => {
    it("recognizes both module-server conflict bodies", async () => {
      assertEquals(
        await isDependencySnapshotConflictResponse(
          conflictResponse("Unknown dependency snapshot"),
        ),
        true,
      );
      assertEquals(
        await isDependencySnapshotConflictResponse(
          conflictResponse("export default null; // Unknown dependency snapshot"),
        ),
        true,
      );
    });

    it("ignores a 409 that is not about the dependency snapshot", async () => {
      assertEquals(
        await isDependencySnapshotConflictResponse(conflictResponse("Application conflict")),
        false,
      );
    });

    it("ignores responses that are not 409", async () => {
      assertEquals(
        await isDependencySnapshotConflictResponse(
          conflictResponse("Unknown dependency snapshot", 200),
        ),
        false,
      );
      assertEquals(await isDependencySnapshotConflictResponse(null), false);
    });
  });

  describe("importSnapshotBoundModule", () => {
    it("returns the imported namespace untouched when the module loads", async () => {
      const namespace = { default: { name: "Page" } } as unknown as ModuleNamespace;
      const recoveryState: Record<string, unknown> = {};
      let probes = 0;
      let reloads = 0;

      const { importSnapshotBoundModule } = createSnapshotModuleImporter({
        importModule: () => Promise.resolve(namespace),
        fetchModule: () => {
          probes++;
          return Promise.resolve(conflictResponse("Unknown dependency snapshot"));
        },
        reloadDocument: () => {
          reloads++;
        },
        recoveryState,
      });

      const loaded = await importSnapshotBoundModule(
        "/_vf_modules/_pins/on%3Asnapshot-a/app/page.js",
      );

      assertStrictEquals(
        loaded,
        namespace,
        "a successful import must return the module namespace it loaded",
      );
      assertEquals(probes, 0, "a successful import must not probe the module server");
      assertEquals(reloads, 0, "a successful import must not reload the document");
      assertEquals(
        recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__,
        undefined,
        "a successful import must not arm snapshot recovery",
      );
    });

    it("reloads once when pinned page, layout, app, and error imports hit snapshot eviction", async () => {
      const importedUrls: string[] = [];
      const probedUrls: string[] = [];
      const cacheModes: (string | undefined)[] = [];
      const recoveryState: Record<string, unknown> = {};
      let reloads = 0;

      for (
        const path of [
          "app/page.tsx",
          "app/layout.tsx",
          "components/app.tsx",
          "app/error.tsx",
        ]
      ) {
        const moduleUrl = `/_veryfront/rsc/module?rel=${
          encodeURIComponent(path)
        }&pins=on%3Asnapshot-a`;
        const importError = new TypeError(`dynamic import failed: ${path}`);
        const { importSnapshotBoundModule } = createSnapshotModuleImporter({
          importModule: (url) => {
            importedUrls.push(url);
            return Promise.reject(importError);
          },
          fetchModule: (url, init) => {
            probedUrls.push(url);
            cacheModes.push(init?.cache);
            return Promise.resolve(
              conflictResponse("export default null; // Unknown dependency snapshot"),
            );
          },
          reloadDocument: () => {
            reloads++;
          },
          recoveryState,
        });

        const thrown = await captureRejection(importSnapshotBoundModule(moduleUrl));
        assertEquals(thrown, importError);
      }

      assertEquals(importedUrls.length, 4);
      assertEquals(probedUrls, importedUrls);
      assertEquals(cacheModes, ["no-store", "no-store", "no-store", "no-store"]);
      assertEquals(reloads, 1);
      assertEquals(recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__, true);
    });

    it("recovers module-server path-pinned imports used by the shared component loader", async () => {
      const moduleUrl = "/_vf_modules/_pins/on%3Asnapshot-a/app/layout.js";
      const importError = new TypeError("dynamic import failed");
      const probedUrls: string[] = [];
      let reloads = 0;

      const { importSnapshotBoundModule } = createSnapshotModuleImporter({
        importModule: () => Promise.reject(importError),
        fetchModule: (url, init) => {
          probedUrls.push(url);
          assertEquals(init?.cache, "no-store");
          return Promise.resolve(conflictResponse("Unknown dependency snapshot"));
        },
        reloadDocument: () => {
          reloads++;
        },
        recoveryState: {},
      });

      const thrown = await captureRejection(importSnapshotBoundModule(moduleUrl));

      assertEquals(thrown, importError);
      assertEquals(probedUrls, [moduleUrl]);
      assertEquals(reloads, 1);
    });

    it("reports speculative snapshot conflicts without reloading the document", async () => {
      const moduleUrl = "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a";
      const recoveryState: Record<string, unknown> = {};
      let reloads = 0;

      const { importSnapshotBoundModule } = createSnapshotModuleImporter({
        importModule: () => Promise.reject(new TypeError("dynamic import failed")),
        fetchModule: () => Promise.resolve(conflictResponse("Unknown dependency snapshot")),
        reloadDocument: () => {
          reloads++;
        },
        recoveryState,
      });

      const thrown = await captureRejection(
        importSnapshotBoundModule(moduleUrl, false),
      ) as Error & { dependencySnapshotConflict?: boolean };

      assertEquals(thrown.name, "DependencySnapshotConflictError");
      assertEquals(thrown.dependencySnapshotConflict, true);
      assertEquals(reloads, 0);
      assertEquals(recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__, undefined);
    });

    it("preserves arbitrary import failures without probing or reloading them", async () => {
      const importError = new SyntaxError("module evaluation failed");
      const recoveryState: Record<string, unknown> = {};
      let probes = 0;
      let reloads = 0;

      function importerFor(body: string): (moduleUrl: string) => Promise<ModuleNamespace> {
        const { importSnapshotBoundModule } = createSnapshotModuleImporter({
          importModule: () => Promise.reject(importError),
          fetchModule: () => {
            probes++;
            return Promise.resolve(conflictResponse(body));
          },
          reloadDocument: () => {
            reloads++;
          },
          recoveryState,
        });
        return importSnapshotBoundModule;
      }

      const unpinnedThrown = await captureRejection(
        importerFor("Unknown dependency snapshot")("/_veryfront/rsc/module?rel=app%2Fpage.tsx"),
      );
      const applicationConflictThrown = await captureRejection(
        importerFor("Application conflict")(
          "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
        ),
      );

      assertEquals(unpinnedThrown, importError);
      assertEquals(applicationConflictThrown, importError);
      assertEquals(probes, 1);
      assertEquals(reloads, 0);
      assertEquals(recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__, undefined);
    });
  });
});
