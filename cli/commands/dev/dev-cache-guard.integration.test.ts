import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createServer } from "node:net";
import { join } from "#veryfront/compat/path";
import { exists, mkdir, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { runWithCacheDir } from "#veryfront/utils/cache-dir.ts";
import { clearConfigCache } from "#veryfront/config";
import { TEST_TIMEOUTS } from "../../../tests/_helpers/constants.ts";
import { withTestContext } from "../../../tests/_helpers/context.ts";
import { clearLocalCachesIfPortFree } from "./command.ts";
import { handleDevCommand } from "./handler.ts";

/**
 * The on-disk ESM caches live under the project's `.cache` directory, which
 * every dev server rooted at that project shares. Clearing them before the dev
 * port has been resolved and probed means a second `veryfront dev` destroys the
 * running server's compiled modules - the surviving server then has to
 * recompile everything on its next request.
 */

interface SeededCache {
  cacheDir: string;
  mdxEsmEntry: string;
  httpBundleEntry: string;
}

/** Writes the cache entries a dev server that is already running would own. */
async function seedRunningServerCache(projectDir: string): Promise<SeededCache> {
  const cacheDir = join(projectDir, ".cache");
  const mdxEsmDir = join(cacheDir, "veryfront-mdx-esm");
  const httpBundleDir = join(cacheDir, "veryfront-http-bundle");
  await mkdir(mdxEsmDir, { recursive: true });
  await mkdir(httpBundleDir, { recursive: true });

  const mdxEsmEntry = join(mdxEsmDir, "running-server-module.mjs");
  const httpBundleEntry = join(httpBundleDir, "running-server-bundle.mjs");
  await writeTextFile(mdxEsmEntry, "export const compiledByRunningServer = true;\n");
  await writeTextFile(httpBundleEntry, "export const bundledByRunningServer = true;\n");

  return { cacheDir, mdxEsmEntry, httpBundleEntry };
}

/** Stands in for the dev server that is already listening on this project's port. */
async function holdPort(): Promise<{ port: number; release: () => Promise<void> }> {
  const held = createServer();
  const port = await new Promise<number>((resolve, reject) => {
    held.once("error", reject);
    held.listen(0, "127.0.0.1", () => {
      const address = held.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    });
  });
  return {
    port,
    release: () => new Promise<void>((done) => held.close(() => done())),
  };
}

// `handleDevCommand` starts auth preloading it never awaits, so the request it
// kicks off can outlive an aborted command. These tests assert on filesystem
// state, not on that request.
describe("veryfront dev cache guard", { sanitizeOps: false, sanitizeResources: false }, () => {
  it(
    "keeps the shared ESM cache when another dev server holds the port",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-cache-guard-port-taken", async (context) => {
        const cache = await seedRunningServerCache(context.projectDir);
        const { port, release } = await holdPort();

        try {
          const cleared = await runWithCacheDir(
            cache.cacheDir,
            () => clearLocalCachesIfPortFree(port, undefined, undefined, () => false),
          );

          assertEquals(cleared, false, "a taken dev port must not clear the shared cache");
          assert(
            await exists(cache.mdxEsmEntry),
            "the running server's MDX-ESM cache entry must survive a second `veryfront dev`",
          );
          assert(
            await exists(cache.httpBundleEntry),
            "the running server's HTTP bundle cache entry must survive a second `veryfront dev`",
          );
        } finally {
          await release();
        }
      });
    },
  );

  it(
    "still clears the shared ESM cache when the dev port is free and nothing persists it",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-cache-guard-port-free", async (context) => {
        const cache = await seedRunningServerCache(context.projectDir);
        const { port, release } = await holdPort();
        // Release immediately: the port is known-unused, not merely unprobed.
        await release();

        const cleared = await runWithCacheDir(
          cache.cacheDir,
          () => clearLocalCachesIfPortFree(port, undefined, undefined, () => false),
        );

        assertEquals(cleared, true, "a free dev port must still clear stale caches");
        assertEquals(
          await exists(cache.mdxEsmEntry),
          false,
          "a stale MDX-ESM cache entry must be cleared when no server holds the port",
        );
        assertEquals(
          await exists(cache.httpBundleEntry),
          false,
          "a stale HTTP bundle cache entry must be cleared when no server holds the port",
        );
      });
    },
  );

  it(
    "does not clear the shared ESM cache before the dev command owns the port",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-cache-guard-handler-ordering", async (context) => {
        clearConfigCache();

        await writeTextFile(
          join(context.projectDir, "veryfront.config.js"),
          `export default { title: "Cache Guard" };\n`,
        );
        const cache = await seedRunningServerCache(context.projectDir);

        // 70000 is not a bindable TCP port, so the probe inside devCommand
        // fails and the command aborts. Anything that clears the caches ahead
        // of that probe - as the handler itself used to - has already destroyed
        // the running server's modules by the time the command gives up.
        await assertRejects(
          () =>
            runWithCacheDir(
              cache.cacheDir,
              () =>
                handleDevCommand({
                  _: ["dev"],
                  port: 70000,
                  project: context.projectDir,
                  "no-hmr": true,
                }),
            ),
          Error,
          undefined,
          "an unbindable dev port must fail the command",
        );

        assert(
          await exists(cache.mdxEsmEntry),
          "the MDX-ESM cache entry must survive a `veryfront dev` that never took a port",
        );
        assert(
          await exists(cache.httpBundleEntry),
          "the HTTP bundle cache entry must survive a `veryfront dev` that never took a port",
        );
      });
    },
  );

  it(
    "keeps the shared ESM cache when the project persists it across restarts",
    { timeout: TEST_TIMEOUTS.INTEGRATION },
    async () => {
      await withTestContext("dev-cache-guard-persistent", async (context) => {
        const cache = await seedRunningServerCache(context.projectDir);
        const { port, release } = await holdPort();
        // Release immediately: the port is known-unused, not merely unprobed.
        await release();

        const cleared = await runWithCacheDir(
          cache.cacheDir,
          // A local dev server with no distributed cache configured. Its
          // persisted entries point at these files, so wiping them makes every
          // restart cold again.
          () => clearLocalCachesIfPortFree(port, undefined, undefined, () => true),
        );

        assertEquals(cleared, false, "a persistent local dev cache must not be cleared");
        assert(
          await exists(cache.mdxEsmEntry),
          "the persisted MDX-ESM cache entry must survive a dev-server restart",
        );
        assert(
          await exists(cache.httpBundleEntry),
          "the persisted HTTP bundle cache entry must survive a dev-server restart",
        );
      });
    },
  );
});
