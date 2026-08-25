/**
 * DevServer start-failure cleanup tests.
 *
 * `DevServer.start()` registers file watchers and ReloadNotifier subscriptions
 * *before* it binds the HTTP port. `startDevServer()` constructs the instance,
 * awaits `start()` and returns it — so when `start()` rejects the half-built
 * instance is dropped without ever being handed to a caller, and nobody can
 * call `stop()` on it. Anything registered before the bind would then survive
 * for the life of the process.
 *
 * These tests force a real bind failure (a port already held by another
 * listener) after the subscriptions are registered, and assert that the
 * registrations are released rather than merely that `start()` rejects.
 *
 * Colocated with the module it covers, but named `*.integration.test.ts`: it
 * needs a real project directory, a full `bootstrapDev()`, a real OS file
 * watcher and a real TCP bind, so it is excluded from the unit shard.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { FileWatcher, WatchOptions } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/registry.ts";
import { ReloadNotifier } from "../reload-notifier.ts";
import { DevServer } from "./server.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";

type WatchFn = (paths: string | string[], options?: WatchOptions) => FileWatcher;

interface WatchTracker {
  /** Watchers opened but not yet closed. */
  readonly open: number;
  /** Watchers opened over the tracker's lifetime (guards against a vacuous test). */
  readonly opened: number;
  restore(): void;
}

/**
 * Wrap the runtime adapter's `fs.watch` so the test can count live watchers.
 * DevServer builds its own adapter from the runtime registry, so patching the
 * registry singleton is the only seam that observes the watcher it really opens.
 */
function trackWatchers(fs: { watch: WatchFn }): WatchTracker {
  const originalWatch = fs.watch.bind(fs);
  let open = 0;
  let opened = 0;

  fs.watch = (paths, options) => {
    const watcher = originalWatch(paths, options);
    open++;
    opened++;
    let closed = false;

    return {
      [Symbol.asyncIterator]: () => watcher[Symbol.asyncIterator](),
      close: () => {
        if (!closed) {
          closed = true;
          open--;
        }
        watcher.close();
      },
      get ready() {
        return watcher.ready;
      },
      get done() {
        return watcher.done;
      },
    };
  };

  return {
    get open() {
      return open;
    },
    get opened() {
      return opened;
    },
    restore: () => {
      fs.watch = originalWatch;
    },
  };
}

describe("DevServer start failure", () => {
  it("releases file watchers and ReloadNotifier subscriptions when the HTTP bind fails", async () => {
    await withTestContext("dev-start-bind-failure", async (context) => {
      // Hold a port so the dev server's own bind is guaranteed to fail. This is
      // the real-world path: the probe-then-bind race in `veryfront dev`, or any
      // other process owning the port between the probe and the bind.
      const blockerController = new AbortController();
      const blocker = Deno.serve({
        hostname: "127.0.0.1",
        port: 0,
        signal: blockerController.signal,
        onListen: () => {},
      }, () => new Response("port already taken"));
      const occupiedPort = (blocker.addr as Deno.NetAddr).port;

      const adapter = await runtime.get();
      const watchers = trackWatchers(adapter.fs as unknown as { watch: WatchFn });

      const before = ReloadNotifier.getMetrics();

      try {
        const server = new DevServer({
          projectDir: context.projectDir,
          port: occupiedPort,
          // HMR must be on: the watchers and both subscriptions are only
          // registered on this branch.
          enableHMR: true,
          enableFastRefresh: false,
        });

        const error = await assertRejects(
          () => server.start(),
          Error,
          undefined,
          "start() must reject when the port is already bound",
        );
        assertStringIncludes(
          String((error as Error).message).toLowerCase(),
          "in use",
          "start() must reject with the underlying bind failure, not a cleanup error or a rewritten message",
        );

        // Guard against a vacuous pass: if the dev server never opened a
        // watcher, the leak assertions below would hold trivially.
        assert(
          watchers.opened > 0,
          "test setup failed — DevServer opened no file watcher, so watcher cleanup is untested",
        );

        // Compared as one object so a regression reports every leaked
        // registration at once instead of short-circuiting on the first.
        const after = ReloadNotifier.getMetrics();
        assertEquals(
          {
            openWatchers: watchers.open,
            reloadListeners: after.activeReloadListeners,
            invalidateListeners: after.activeInvalidateListeners,
          },
          {
            openWatchers: 0,
            reloadListeners: before.activeReloadListeners,
            invalidateListeners: before.activeInvalidateListeners,
          },
          "everything registered before the bind must be released when start() fails",
        );
      } finally {
        watchers.restore();
        blockerController.abort();
        await blocker.finished.catch(() => {});
      }
    });
  });
});
