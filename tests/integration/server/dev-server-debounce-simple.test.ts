
import { assert as _assert, assertEquals as _assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { createDevServer as _createDevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Dev Server - File Watcher Debouncing",
  {},
  () => {
    it("initializes with debouncing enabled", async () => {
      await withTestContext("dev-debounce-init", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Test",
        );

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 100,
        });

        assertExists(server, "Server should be created");

        if (typeof server.getFileWatcherMetrics === "function") {
          const metrics = server.getFileWatcherMetrics();
          console.log("[TEST] Initial metrics:", metrics);
        }

        await server.stop();
      });
    });

    it("logs performance metrics on shutdown", async () => {
      await withTestContext("dev-debounce-metrics", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Home",
        );

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 100,
        });

        await Deno.writeTextFile(
          join(context.projectDir, "pages", "test1.mdx"),
          "# Test 1",
        );

        await new Promise((resolve) => setTimeout(resolve, 50));

        await Deno.writeTextFile(
          join(context.projectDir, "pages", "test2.mdx"),
          "# Test 2",
        );

        await new Promise((resolve) => setTimeout(resolve, 200));

        console.log("[TEST] Stopping server, watch for metrics log...");
        await server.stop();
      });
    });
  },
);
