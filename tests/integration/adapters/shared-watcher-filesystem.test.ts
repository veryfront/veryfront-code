/**
 * Shared watcher filesystem integration test.
 *
 * Exercises `setupNodeFsWatcher` against a real directory. Creating and
 * watching files on the host is a filesystem effect, so the case lives here
 * rather than beside the shared watcher module.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolve } from "node:path";
import type { FileChangeEvent } from "#veryfront/platform/adapters/base.ts";
import { setupNodeFsWatcher } from "#veryfront/platform/adapters/runtime/shared/shared-watcher.ts";
import { makeTempDir, waitFor } from "#veryfront/testing/deno-compat.ts";

describe("setupNodeFsWatcher on a real directory", () => {
  it("emits the resolved path of a file changed inside the watched root", async () => {
    const root = await Deno.realPath(
      await makeTempDir({ prefix: "veryfront-shared-watcher-" }),
    );
    const changedFile = resolve(root, "file.ts");
    const eventQueue: FileChangeEvent[] = [];
    const watchers: Array<import("node:fs").FSWatcher> = [];
    const failures: Error[] = [];
    let closed = false;

    try {
      await setupNodeFsWatcher(root, {
        recursive: true,
        closed: () => closed,
        signal: undefined,
        eventQueue,
        getResolver: () => null,
        setResolver: () => {},
        watchers,
        onError: (error) => {
          failures.push(error);
        },
      });

      // Host watchers arm asynchronously, so keep rewriting the file until the
      // first event lands instead of racing a single write against setup.
      await waitFor(
        async () => {
          await Deno.writeTextFile(changedFile, "export const value = 1;\n");
          return eventQueue.some((event) => event.paths.includes(changedFile));
        },
        { message: "the watcher never reported the file created inside the root" },
      );

      const event = eventQueue.find((candidate) => candidate.paths.includes(changedFile));
      assertExists(event, "the watcher must report the file created inside the root");
      assertEquals(
        event.paths,
        [changedFile],
        "the watcher must emit the resolved path of the changed file inside the watched root",
      );
      assertEquals(
        event.kind === "modify" || event.kind === "any",
        true,
        "a created file must be reported as a modify or any change",
      );
      assertEquals(failures, [], "watching a plain temp directory must not raise errors");
    } finally {
      closed = true;
      for (const watcher of watchers) watcher.close();
      await Deno.remove(root, { recursive: true });
    }
  });
});
