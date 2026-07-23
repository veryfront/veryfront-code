import "#veryfront/schemas/_test-setup.ts";
import { RateLimiter } from "#veryfront/modules/server/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ReloadProjectInfo } from "../../reload-notifier.ts";
import { HmrRuntimeController, type HmrRuntimeDependencies } from "./hmr-runtime.ts";

describe("server/handlers/preview/hmr-runtime", () => {
  it("completes project cache invalidation before broadcasting a reload", async () => {
    const events: string[] = [];
    let reloadListener:
      | ((changedPaths?: string[], project?: ReloadProjectInfo) => void)
      | undefined;
    let invalidationListener:
      | ((project?: ReloadProjectInfo) => void | Promise<void>)
      | undefined;
    const deps: HmrRuntimeDependencies = {
      broadcast: () => events.push("broadcast"),
      clearClients: () => {},
      clientCount: () => 1,
      createRateLimiter: () => new RateLimiter(10),
      invalidate: async () => {
        events.push("invalidate:start");
        await Promise.resolve();
        events.push("invalidate:end");
      },
      pingIntervalMs: () => 45_000,
      resetMetrics: () => {},
      startPing: () => {},
      stopPing: () => {},
      subscribe: (listener) => {
        reloadListener = listener;
        return () => {};
      },
      subscribeInvalidation: (listener) => {
        invalidationListener = listener;
        return () => {};
      },
    };
    const controller = new HmrRuntimeController(deps);
    controller.initialize();

    assertEquals(typeof invalidationListener, "function");
    await invalidationListener?.({ projectSlug: "project-a", projectId: "proj_123" });
    reloadListener?.(["app/page.tsx"], { projectSlug: "project-a", projectId: "proj_123" });

    assertEquals(events, ["invalidate:start", "invalidate:end", "broadcast"]);
    controller.shutdown();
  });
});
