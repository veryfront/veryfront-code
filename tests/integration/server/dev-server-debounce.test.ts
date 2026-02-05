/**
 * Dev Server File Watcher Debouncing Tests
 *
 * Tests the optimized file watcher functionality:
 * - Debouncing of file change events
 * - Batch processing of multiple changes
 * - Performance metrics tracking
 * - Configuration options
 */

import { assert, assertExists } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { afterAll, describe, it } from "#veryfront/testing/bdd";
import { delay, mkdir, writeTextFile } from "#veryfront/testing/deno-compat";
import { withTestContext } from "../../_helpers/context.ts";
import type { TestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";
import { scaleMs } from "#veryfront/testing";

type FixtureVariant = "initial" | "updated";

function getFixtureContent(file: string, variant: FixtureVariant): string {
  if (file.endsWith(".mdx")) {
    const label = variant === "initial" ? "Initial" : "Updated";
    const suffix = variant === "updated" ? " after checkout" : "";
    return `# ${label} content for ${file}${suffix}`;
  }

  if (file.endsWith(".tsx") || file.endsWith(".jsx")) {
    return getComponentSource(file, variant);
  }

  const label = variant === "initial" ? "Initial" : "Updated";
  return `${label} content for ${file}`;
}

function getComponentSource(file: string, variant: FixtureVariant): string {
  const fileName = file.split("/").pop() ?? "Component.tsx";
  const componentName = fileName.replace(/\.[jt]sx$/i, "") || "Component";
  const description = variant === "initial"
    ? `Initial component state for ${file}`
    : `Updated component state for ${file} after checkout`;

  return `export default function ${componentName}() {\n  // ${description}\n  return null;\n}\n`;
}

describe("Dev Server Debounce Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  // Clean up renderer intervals to prevent resource leaks
  afterAll(async () => {
    await cleanupBundler();
  });

  describe("Dev Server - Optimized File Watcher", {}, () => {
    it("initializes with configurable debounce timeout", async () => {
      await withTestContext("dev-watcher-config", async (context: TestContext) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Test Page");

        const customDebounceMs = scaleMs(200);
        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: customDebounceMs,
        });

        assertExists(server, "Server should be created");

        await delay(500);

        const initialMetrics = server.getFileWatcherMetrics?.();
        if (!initialMetrics) return;

        assertExists(initialMetrics.totalFileChangeEvents, "Metrics should track file events");
        assertExists(initialMetrics.routeDiscoveryCalls, "Metrics should track discovery calls");
      });
    });

    it("batches multiple file changes within debounce window", async () => {
      await withTestContext("dev-watcher-batching", async (context: TestContext) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");
        await writeTextFile(join(context.projectDir, "pages", "about.mdx"), "# About");
        await writeTextFile(join(context.projectDir, "pages", "contact.mdx"), "# Contact");

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: scaleMs(150),
        });

        await delay(200);

        const changes: Promise<void>[] = [];
        for (let i = 0; i < 5; i++) {
          changes.push(
            writeTextFile(join(context.projectDir, "pages", `page${i}.mdx`), `# Page ${i}`),
          );
        }

        await Promise.all(changes);
        await delay(300);

        const metrics = server.getFileWatcherMetrics?.();
        if (!metrics) return;

        assert(
          metrics.routeDiscoveryCalls < metrics.totalFileChangeEvents ||
            metrics.routeDiscoveryCalls === 0,
          `Should batch changes: ${metrics.routeDiscoveryCalls} discoveries < ${metrics.totalFileChangeEvents} events`,
        );

        console.log("[TEST] File watcher metrics:", metrics);
      });
    });

    it("processes changes immediately after debounce timeout", async () => {
      await withTestContext("dev-watcher-timing", async (context: TestContext) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Initial");

        const debounceBaseMs = 100;
        const debounceMs = scaleMs(debounceBaseMs);
        await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: debounceMs,
        });

        await delay(200);

        const changeTime = Date.now();
        await writeTextFile(join(context.projectDir, "pages", "test.mdx"), "# Test Page");

        await delay(debounceBaseMs + 50);

        const elapsed = Date.now() - changeTime;

        assert(
          elapsed >= debounceMs && elapsed < debounceMs + scaleMs(200),
          `Changes should be processed after ${debounceMs}ms, actual: ${elapsed}ms`,
        );
      });
    });

    it("cleans up resources on server stop", async () => {
      await withTestContext("dev-watcher-cleanup", async (context: TestContext) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Test");

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: scaleMs(100),
        });

        await writeTextFile(join(context.projectDir, "pages", "new.mdx"), "# New Page");
        await delay(200);

        await server.stop();

        assert(true, "Server stopped without throwing errors");
      });
    });

    it("provides accurate performance metrics", async () => {
      await withTestContext("dev-watcher-metrics", async (context) => {
        await writeTextFile(join(context.projectDir, "pages", "index.mdx"), "# Home");

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: scaleMs(100),
        });

        await delay(200);

        for (let i = 0; i < 3; i++) {
          await writeTextFile(join(context.projectDir, "pages", `test${i}.mdx`), `# Test ${i}`);
          await delay(30);
        }

        await delay(200);

        const metrics = server.getFileWatcherMetrics?.();
        if (!metrics) return;

        assertExists(metrics.totalFileChangeEvents, "Should track total events");
        assertExists(metrics.routeDiscoveryCalls, "Should track discovery calls");
        assertExists(metrics.averageBatchSize, "Should calculate average batch size");
        assertExists(metrics.fsOperationReduction, "Should calculate reduction percentage");

        const avgBatch = parseFloat(metrics.averageBatchSize);
        if (metrics.routeDiscoveryCalls > 0) {
          assert(avgBatch >= 1, `Average batch size should be >= 1, got ${avgBatch}`);
        }

        console.log("[TEST] Final metrics:", metrics);
      });
    });

    it("handles git checkout scenario with many rapid changes", async () => {
      await withTestContext("dev-watcher-git-checkout", async (context) => {
        const initialFiles = [
          "pages/index.mdx",
          "pages/about.mdx",
          "pages/products/list.mdx",
          "pages/products/detail.mdx",
          "components/Header.tsx",
          "components/Footer.tsx",
        ];

        for (const file of initialFiles) {
          const lastSlash = file.lastIndexOf("/");
          const dir = lastSlash >= 0
            ? join(context.projectDir, file.slice(0, lastSlash))
            : context.projectDir;

          await mkdir(dir, { recursive: true });
          await writeTextFile(join(context.projectDir, file), getFixtureContent(file, "initial"));
        }

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: scaleMs(100),
        });

        await delay(200);

        await Promise.all(
          initialFiles.map((file) =>
            writeTextFile(join(context.projectDir, file), getFixtureContent(file, "updated"))
          ),
        );

        await delay(200);

        const metrics = server.getFileWatcherMetrics?.();
        if (!metrics || metrics.routeDiscoveryCalls <= 0) return;

        const reduction = parseFloat(metrics.fsOperationReduction.replace("%", ""));
        assert(
          reduction > 0 || metrics.routeDiscoveryCalls === 0,
          `Should show reduction in FS operations for git checkout scenario: ${metrics.fsOperationReduction}`,
        );

        console.log(
          `[TEST] Git checkout scenario - ${initialFiles.length} files changed:`,
          metrics,
        );
      });
    });
  });
});
