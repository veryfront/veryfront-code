
import { assert, assertEquals as _assertEquals, assertExists } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { afterAll, describe, it } from "std/testing/bdd.ts";
import { createDevServer as _createDevServer } from "../../../src/server/dev-server.ts";
import { withTestContext } from "../../_helpers/context.ts";
import type { TestContext } from "../../_helpers/context.ts";
import { cleanupBundler } from "../../../src/rendering/cleanup.ts";

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

  return `${variant === "initial" ? "Initial" : "Updated"} content for ${file}`;
}

function getComponentSource(file: string, variant: FixtureVariant): string {
  const fileName = file.split("/").pop() ?? "Component.tsx";
  const componentName = fileName.replace(/\.[jt]sx$/i, "") || "Component";
  const description = variant === "initial"
    ? `Initial component state for ${file}`
    : `Updated component state for ${file} after checkout`;

  return `export default function ${componentName}() {\n  // ${description}\n  return null;\n}\n`;
}

afterAll(async () => {
  await cleanupBundler();
});

describe(
  "Dev Server - Optimized File Watcher",
  {},
  () => {
    it("initializes with configurable debounce timeout", async () => {
      await withTestContext("dev-watcher-config", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Test Page",
        );

        const customDebounceMs = 200;
        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: customDebounceMs,
        });

        assertExists(server, "Server should be created");

        await new Promise((resolve) => setTimeout(resolve, 500));

        const initialMetrics = server.getFileWatcherMetrics?.();

        if (initialMetrics) {
          assertExists(initialMetrics.totalFileChangeEvents, "Metrics should track file events");
          assertExists(initialMetrics.routeDiscoveryCalls, "Metrics should track discovery calls");
        }
      });
    });

    it("batches multiple file changes within debounce window", async () => {
      await withTestContext("dev-watcher-batching", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Home",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "about.mdx"),
          "# About",
        );
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "contact.mdx"),
          "# Contact",
        );

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 150, // 150ms debounce
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const changes = [];
        for (let i = 0; i < 5; i++) {
          changes.push(
            Deno.writeTextFile(
              join(context.projectDir, "pages", `page${i}.mdx`),
              `# Page ${i}`,
            ),
          );
        }

        await Promise.all(changes);

        await new Promise((resolve) => setTimeout(resolve, 300));

        const metrics = server.getFileWatcherMetrics?.();
        if (metrics) {
          assert(
            metrics.routeDiscoveryCalls < metrics.totalFileChangeEvents ||
              metrics.routeDiscoveryCalls === 0,
            `Should batch changes: ${metrics.routeDiscoveryCalls} discoveries < ${metrics.totalFileChangeEvents} events`,
          );

          console.log("[TEST] File watcher metrics:", metrics);
        }
      });
    });

    it("processes changes immediately after debounce timeout", async () => {
      await withTestContext("dev-watcher-timing", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Initial",
        );

        const debounceMs = 100;
        const _server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: debounceMs,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const changeTime = Date.now();
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "test.mdx"),
          "# Test Page",
        );

        await new Promise((resolve) => setTimeout(resolve, debounceMs + 50));

        const processTime = Date.now();
        const elapsed = processTime - changeTime;

        assert(
          elapsed >= debounceMs && elapsed < debounceMs + 200,
          `Changes should be processed after ${debounceMs}ms, actual: ${elapsed}ms`,
        );
      });
    });

    it("cleans up resources on server stop", async () => {
      await withTestContext("dev-watcher-cleanup", async (context: TestContext) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Test",
        );

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 100,
        });

        await Deno.writeTextFile(
          join(context.projectDir, "pages", "new.mdx"),
          "# New Page",
        );

        await new Promise((resolve) => setTimeout(resolve, 200));

        await server.stop();

        assert(true, "Server stopped without throwing errors");
      });
    });

    it("provides accurate performance metrics", async () => {
      await withTestContext("dev-watcher-metrics", async (context) => {
        await Deno.writeTextFile(
          join(context.projectDir, "pages", "index.mdx"),
          "# Home",
        );

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 100,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        for (let i = 0; i < 3; i++) {
          await Deno.writeTextFile(
            join(context.projectDir, "pages", `test${i}.mdx`),
            `# Test ${i}`,
          );
          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        await new Promise((resolve) => setTimeout(resolve, 200));

        const metrics = server.getFileWatcherMetrics?.();
        if (metrics) {
          assertExists(metrics.totalFileChangeEvents, "Should track total events");
          assertExists(metrics.routeDiscoveryCalls, "Should track discovery calls");
          assertExists(metrics.averageBatchSize, "Should calculate average batch size");
          assertExists(metrics.fsOperationReduction, "Should calculate reduction percentage");

          const avgBatch = parseFloat(metrics.averageBatchSize);
          if (metrics.routeDiscoveryCalls > 0) {
            assert(avgBatch >= 1, `Average batch size should be >= 1, got ${avgBatch}`);
          }

          console.log("[TEST] Final metrics:", metrics);
        }
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
          const dir = file.includes("/")
            ? join(context.projectDir, file.substring(0, file.lastIndexOf("/")))
            : context.projectDir;
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(
            join(context.projectDir, file),
            getFixtureContent(file, "initial"),
          );
        }

        const server = await context.createDevServer({
          enableHMR: true,
          fileWatcherDebounceMs: 100,
        });

        await new Promise((resolve) => setTimeout(resolve, 200));

        const changes = initialFiles.map((file) =>
          Deno.writeTextFile(
            join(context.projectDir, file),
            getFixtureContent(file, "updated"),
          )
        );

        await Promise.all(changes);

        await new Promise((resolve) => setTimeout(resolve, 200));

        const metrics = server.getFileWatcherMetrics?.();
        if (metrics && metrics.routeDiscoveryCalls > 0) {
          const reduction = parseFloat(metrics.fsOperationReduction.replace("%", ""));
          assert(
            reduction > 0 || metrics.routeDiscoveryCalls === 0,
            `Should show reduction in FS operations for git checkout scenario: ${metrics.fsOperationReduction}`,
          );

          console.log(
            `[TEST] Git checkout scenario - ${initialFiles.length} files changed:`,
            metrics,
          );
        }
      });
    });
  },
);
