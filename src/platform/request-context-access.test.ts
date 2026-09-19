import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  currentRequestContext,
  registerRequestScopedFileCacheIsolation,
  runWithoutRequestScopedFileCache,
} from "./request-context-access.ts";

describe("platform/request-context-access", () => {
  describe("runWithoutRequestScopedFileCache", () => {
    it("runs the operation directly outside a request context", () => {
      assertEquals(currentRequestContext(), null);
      assertEquals(runWithoutRequestScopedFileCache(() => "direct"), "direct");
    });

    it("hides the request file cache while keeping the request identity", async () => {
      await runWithRequestContext(
        {
          projectSlug: "isolated-project",
          projectId: "isolated-project-id",
          token: "token",
          branch: "feature/isolated",
          environmentName: "preview",
        },
        () => {
          const outer = getCurrentRequestContext()!;
          outer.fileCache!.set("veryfront.config.ts", "pinned");

          const inner = runWithoutRequestScopedFileCache(() => {
            const context = currentRequestContext()!;
            assertEquals(context.fileCache?.get("veryfront.config.ts"), undefined);
            context.fileCache?.set("veryfront.config.ts", "isolated");
            return context;
          });

          assert(inner !== outer);
          assertEquals(inner.projectSlug, "isolated-project");
          assertEquals(inner.projectId, "isolated-project-id");
          assertEquals(inner.token, "token");
          assertEquals(inner.branch, "feature/isolated");
          assertEquals(inner.environmentName, "preview");
          assertEquals(inner.productionMode, false);
          assertEquals(outer.fileCache!.get("veryfront.config.ts"), "pinned");
          assertStrictEquals(getCurrentRequestContext(), outer);
          return Promise.resolve();
        },
      );
    });

    it("rejects a second, different isolation registration", () => {
      assertThrows(
        () => registerRequestScopedFileCacheIsolation((fn) => fn()),
        TypeError,
        "already registered",
      );
    });
  });
});
