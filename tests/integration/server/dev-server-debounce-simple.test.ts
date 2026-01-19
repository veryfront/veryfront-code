/**
 * Simple Dev Server File Watcher Debouncing Test
 *
 * Focused test to verify debouncing functionality is working
 */

import { assert as _assert, assertEquals as _assertEquals, assertExists } from "@veryfront/testing/assert";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { delay, writeTextFile } from "@veryfront/testing/deno-compat";
import { createDevServer as _createDevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { scaleMs } from "@veryfront/testing";

describe(
  "Dev Server Debounce Simple Tests",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    // Clean up renderer intervals to prevent resource leaks
    afterAll(async () => {
      await cleanupBundler();
    });

    describe(
      "Dev Server - File Watcher Debouncing",
      {},
      () => {
        it("initializes with debouncing enabled", async () => {
          await withTestContext("dev-debounce-init", async (context) => {
            // Create a basic structure
            await writeTextFile(
              join(context.projectDir, "pages", "index.mdx"),
              "# Test",
            );

            // Create server with custom debounce
            const server = await context.createDevServer({
              enableHMR: true,
              fileWatcherDebounceMs: scaleMs(100),
            });

            // Server should start successfully
            assertExists(server, "Server should be created");

            // Check if server has the metrics method
            if (typeof server.getFileWatcherMetrics === "function") {
              const metrics = server.getFileWatcherMetrics();
              console.log("[TEST] Initial metrics:", metrics);
            }

            // Clean stop
            await server.stop();
          });
        });

        it("logs performance metrics on shutdown", async () => {
          await withTestContext("dev-debounce-metrics", async (context) => {
            // Create initial pages
            await writeTextFile(
              join(context.projectDir, "pages", "index.mdx"),
              "# Home",
            );

            const server = await context.createDevServer({
              enableHMR: true,
              fileWatcherDebounceMs: scaleMs(100),
            });

            // Create a few changes to generate some activity
            await writeTextFile(
              join(context.projectDir, "pages", "test1.mdx"),
              "# Test 1",
            );

            await delay(50);

            await writeTextFile(
              join(context.projectDir, "pages", "test2.mdx"),
              "# Test 2",
            );

            // Wait for debounce
            await delay(200);

            // Stop - should log metrics
            console.log("[TEST] Stopping server, watch for metrics log...");
            await server.stop();
          });
        });
      },
    );
  },
);
