/**
 * Stress test for SSR Module Loader
 *
 * Tests the race condition fix by simulating concurrent requests
 * for components with deep dependency trees.
 *
 * Run with: deno test --allow-all src/modules/react-loader/ssr-module-loader.stress.test.ts
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./ssr-module-loader/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem, makeTempDir } from "#veryfront/platform/compat/fs.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { scaleMs } from "#veryfront/testing";

// This test uses dynamic import() which behaves differently in Node.js vs Deno
// The module path resolution for temp files doesn't work the same way
const denoOnlyIt = isDeno ? it : it.skip;

// Create a real temp directory for tests
async function createTempProjectDir(): Promise<string> {
  const fs = createFileSystem();
  const tempDir = await makeTempDir({ prefix: "ssr-stress-test-" });
  await fs.mkdir(join(tempDir, "components"), { recursive: true });
  await fs.mkdir(join(tempDir, "node_modules", ".cache"), { recursive: true });
  return tempDir;
}

// Write component files to disk
async function writeComponentFiles(
  projectDir: string,
  files: Record<string, string>,
): Promise<void> {
  const fs = createFileSystem();
  for (const [path, content] of Object.entries(files)) {
    const fullPath = path.startsWith(projectDir) ? path : join(projectDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeTextFile(fullPath, content);
  }
}

// Create adapter that uses real filesystem
function createRealAdapter(_projectDir: string): RuntimeAdapter {
  const fs = createFileSystem();
  return {
    name: "deno",
    fs: {
      readFile: async (path: string) => {
        return await fs.readTextFile(path);
      },
      writeFile: async () => {},
      readDir: async function* () {},
      stat: () => Promise.resolve(null),
      exists: async (path: string) => {
        return await fs.exists(path);
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

describe("SSRModuleLoader Stress Tests", { sanitizeResources: false, sanitizeOps: false }, () => {
  denoOnlyIt("concurrent requests for same file should not race", async () => {
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
      await createFileSystem().remove(projectDir, { recursive: true });
    }
  });

  denoOnlyIt("deep dependency tree should not deadlock", async () => {
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
      const timeout = scaleMs(10000); // 10 second timeout - deadlock would hang forever
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
      await createFileSystem().remove(projectDir, { recursive: true });
    }
  });

  denoOnlyIt("wide dependency tree should complete", async () => {
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
      await createFileSystem().remove(projectDir, { recursive: true });
    }
  });
});
