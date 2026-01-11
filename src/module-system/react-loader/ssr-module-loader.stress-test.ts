/**
 * Stress test for SSR Module Loader
 *
 * Tests the race condition fix by simulating concurrent requests
 * for components with deep dependency trees.
 *
 * Run with: deno test --allow-all src/module-system/react-loader/ssr-module-loader.stress-test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { clearSSRModuleCache, SSRModuleLoader } from "./ssr-module-loader.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

// Create a real temp directory for tests
async function createTempProjectDir(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "ssr-stress-test-" });
  await Deno.mkdir(join(tempDir, "components"), { recursive: true });
  await Deno.mkdir(join(tempDir, "node_modules", ".cache"), { recursive: true });
  return tempDir;
}

// Write component files to disk
async function writeComponentFiles(
  projectDir: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const fullPath = path.startsWith(projectDir) ? path : join(projectDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });
    await Deno.writeTextFile(fullPath, content);
  }
}

// Create adapter that uses real filesystem
function createRealAdapter(_projectDir: string): RuntimeAdapter {
  return {
    name: "deno",
    fs: {
      readFile: async (path: string) => {
        return await Deno.readTextFile(path);
      },
      writeFile: async () => {},
      readDir: async function* () {},
      stat: () => Promise.resolve(null),
      exists: async (path: string) => {
        try {
          await Deno.stat(path);
          return true;
        } catch {
          return false;
        }
      },
      mkdir: async () => {},
      rm: async () => {},
      realPath: (path: string) => Promise.resolve(path),
    },
    env: {
      get: (key: string) => {
        if (key === "SSR_MAX_CONCURRENT_TRANSFORMS") return "3";
        return undefined;
      },
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
      has: () => false,
    },
    serve: () => Promise.resolve({ stop: () => Promise.resolve() }),
    exit: () => {},
  } as unknown as RuntimeAdapter;
}

// Generate a component that imports N dependencies
function generateComponent(name: string, deps: string[]): string {
  const imports = deps.map((d, i) => `import Dep${i} from './${d}.js';`).join("\n");
  return `
${imports}
import React from 'react';

export default function ${name}() {
  return React.createElement('div', null, '${name}');
}
`;
}

// Generate a simple leaf component (no deps)
function generateLeafComponent(name: string): string {
  return `
import React from 'react';

export default function ${name}() {
  return React.createElement('div', null, '${name}');
}
`;
}

Deno.test({
  name: "SSRModuleLoader - concurrent requests for same file should not race",
  async fn() {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      const files: Record<string, string> = {
        [`${projectDir}/components/Button.tsx`]: generateLeafComponent("Button"),
      };
      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);
      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "test-concurrent",
        adapter,
        dev: true,
      });

      // Simulate 10 concurrent requests for the same component
      const concurrentRequests = 10;
      const buttonPath = `${projectDir}/components/Button.tsx`;
      const buttonSource = files[buttonPath]!;
      const promises = Array.from(
        { length: concurrentRequests },
        () => loader.loadModule(buttonPath, buttonSource).catch((err) => ({ error: err })),
      );

      const results = await Promise.all(promises);

      // All requests should succeed (no race condition)
      const errors = results.filter((r) => r && typeof r === "object" && "error" in r);
      assertEquals(errors.length, 0, `Expected no errors, got: ${JSON.stringify(errors)}`);

      console.log(`✓ ${concurrentRequests} concurrent requests completed without race condition`);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "SSRModuleLoader - deep dependency tree should not deadlock",
  async fn() {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      // Create a dependency tree:
      // App -> [Header, Footer, Sidebar]
      // Header -> [Logo, Nav]
      // Footer -> [Links, Copyright]
      // Sidebar -> [Menu, Search]
      // Logo, Nav, Links, Copyright, Menu, Search -> (leaf components)

      const files: Record<string, string> = {
        // Leaf components
        [`${projectDir}/components/Logo.tsx`]: generateLeafComponent("Logo"),
        [`${projectDir}/components/Nav.tsx`]: generateLeafComponent("Nav"),
        [`${projectDir}/components/Links.tsx`]: generateLeafComponent("Links"),
        [`${projectDir}/components/Copyright.tsx`]: generateLeafComponent("Copyright"),
        [`${projectDir}/components/Menu.tsx`]: generateLeafComponent("Menu"),
        [`${projectDir}/components/Search.tsx`]: generateLeafComponent("Search"),

        // Mid-level components
        [`${projectDir}/components/Header.tsx`]: generateComponent("Header", ["Logo", "Nav"]),
        [`${projectDir}/components/Footer.tsx`]: generateComponent("Footer", [
          "Links",
          "Copyright",
        ]),
        [`${projectDir}/components/Sidebar.tsx`]: generateComponent("Sidebar", ["Menu", "Search"]),

        // Root component
        [`${projectDir}/components/App.tsx`]: generateComponent("App", [
          "Header",
          "Footer",
          "Sidebar",
        ]),
      };
      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);

      // Create multiple loaders (simulating different requests)
      const loaders = Array.from({ length: 5 }, () =>
        new SSRModuleLoader({
          projectDir,
          projectId: "test-deep-deps",
          adapter,
          dev: true,
        }));

      // Simulate concurrent requests for the root component
      // With semaphore=3 and deep deps, this would deadlock if not handled properly
      const startTime = Date.now();
      const timeout = 10000; // 10 second timeout - deadlock would hang forever
      const appPath = `${projectDir}/components/App.tsx`;
      const appSource = files[appPath]!;

      const promises = loaders.map((loader) =>
        Promise.race([
          loader.loadModule(appPath, appSource),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("TIMEOUT - possible deadlock")), timeout)
          ),
        ]).catch((err) => ({ error: err }))
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      // Check for deadlock (timeout)
      const timeouts = results.filter((r) =>
        r && typeof r === "object" && "error" in r &&
        (r as { error: Error }).error.message.includes("TIMEOUT")
      );
      assertEquals(timeouts.length, 0, "Deadlock detected! Some requests timed out.");

      // Check for other errors
      const errors = results.filter((r) => r && typeof r === "object" && "error" in r);

      console.log(`✓ Deep dependency tree (3 levels) completed in ${elapsed}ms`);
      console.log(`  - 5 concurrent requests, semaphore=3`);
      console.log(`  - No deadlock detected`);
      console.log(`  - ${errors.length} errors (0 = success)`);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

Deno.test({
  name: "SSRModuleLoader - wide dependency tree should complete",
  async fn() {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      // Create a wide dependency tree:
      // Page -> [Comp1, Comp2, Comp3, Comp4, Comp5, Comp6, Comp7, Comp8, Comp9, Comp10]
      // Each Comp is a leaf

      const leafComponents = Array.from({ length: 10 }, (_, i) => `Comp${i + 1}`);

      const files: Record<string, string> = {};

      // Create leaf components
      for (const name of leafComponents) {
        files[`${projectDir}/components/${name}.tsx`] = generateLeafComponent(name);
      }

      // Create root component that imports all 10
      files[`${projectDir}/components/Page.tsx`] = generateComponent("Page", leafComponents);

      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);

      // Simulate 20 concurrent requests (more than deps)
      const concurrentRequests = 20;
      const loaders = Array.from({ length: concurrentRequests }, () =>
        new SSRModuleLoader({
          projectDir,
          projectId: "test-wide-deps",
          adapter,
          dev: true,
        }));

      const startTime = Date.now();
      const pagePath = `${projectDir}/components/Page.tsx`;
      const pageSource = files[pagePath]!;

      const promises = loaders.map((loader) =>
        loader.loadModule(pagePath, pageSource).catch((err) => ({ error: err }))
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      // Check for errors
      const errors = results.filter((r) => r && typeof r === "object" && "error" in r);

      console.log(`✓ Wide dependency tree (10 deps) completed in ${elapsed}ms`);
      console.log(`  - ${concurrentRequests} concurrent requests`);
      console.log(`  - ${errors.length} errors (0 = success)`);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Run a quick sanity check
if (import.meta.main) {
  console.log("Running SSR Module Loader stress tests...\n");
  console.log("These tests verify:");
  console.log("1. No race condition when multiple requests hit same file");
  console.log("2. No deadlock with deep dependency trees");
  console.log("3. Wide dependency trees complete without issues\n");
}
