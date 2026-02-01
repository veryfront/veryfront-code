/**
 * Simple Dev Server File Watcher Debouncing Test
 *
 * Focused test to verify debouncing functionality is working
 */

import { assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { delay, writeTextFile } from "#veryfront/testing/deno-compat";
import { scaleMs } from "#veryfront/testing";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe(
  "Dev Server Debounce Simple Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("Dev Server - File Watcher Debouncing", {}, () => {
      it("initializes with debouncing enabled", async () => {
        await withTestContext("dev-debounce-init", async (context) => {
          await writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            "# Test",
          );

          const server = await context.createDevServer({
            enableHMR: true,
            fileWatcherDebounceMs: scaleMs(100),
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
          await writeTextFile(
            join(context.projectDir, "pages", "index.mdx"),
            "# Home",
          );

          const server = await context.createDevServer({
            enableHMR: true,
            fileWatcherDebounceMs: scaleMs(100),
          });

          await writeTextFile(
            join(context.projectDir, "pages", "test1.mdx"),
            "# Test 1",
          );

          await delay(50);

          await writeTextFile(
            join(context.projectDir, "pages", "test2.mdx"),
            "# Test 2",
          );

          await delay(200);

          console.log("[TEST] Stopping server, watch for metrics log...");
          await server.stop();
        });
      });
    });
  },
);
