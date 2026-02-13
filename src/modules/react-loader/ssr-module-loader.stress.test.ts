/**
 * Stress test for SSR Module Loader
 *
 * Tests the race condition fix by simulating concurrent requests
 * for components with deep dependency trees.
 *
 * Run with: deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys src/modules/react-loader/ssr-module-loader.stress.test.ts
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { clearSSRModuleCache, SSRModuleLoader } from "./ssr-module-loader/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem, makeTempDir } from "#veryfront/platform/compat/fs.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { scaleMs } from "#veryfront/testing";

const denoOnlyIt = isDeno ? it : it.skip;

async function createTempProjectDir(): Promise<string> {
  const fs = createFileSystem();
  const tempDir = await makeTempDir({ prefix: "ssr-stress-test-" });
  await fs.mkdir(join(tempDir, "components"), { recursive: true });
  await fs.mkdir(join(tempDir, "node_modules", ".cache"), { recursive: true });
  return tempDir;
}

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

function createRealAdapter(_projectDir: string): RuntimeAdapter {
  const fs = createFileSystem();

  return {
    name: "deno",
    fs: {
      readFile: (path: string) => fs.readTextFile(path),
      writeFile: async () => {},
      readDir: async function* () {},
      stat: () => Promise.resolve(null),
      exists: (path: string) => fs.exists(path),
      mkdir: async () => {},
      rm: async () => {},
      realPath: (path: string) => Promise.resolve(path),
    },
    env: {
      get: (key: string) => (key === "SSR_MAX_CONCURRENT_TRANSFORMS" ? "3" : undefined),
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
      has: () => false,
    },
    serve: () => Promise.resolve({ stop: () => Promise.resolve() }),
    exit: () => {},
  };
}

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

function generateLeafComponent(name: string): string {
  return `
import React from 'react';

export default function ${name}() {
  return React.createElement('div', null, '${name}');
}
`;
}

function hasErrorResult(value: unknown): value is { error: Error } {
  return !!value && typeof value === "object" && "error" in value;
}

async function removeDir(dir: string): Promise<void> {
  await createFileSystem().remove(dir, { recursive: true });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT - possible deadlock")), timeoutMs)
    ),
  ]);
}

describe("SSRModuleLoader Stress Tests", {
  sanitizeResources: false,
  sanitizeOps: false,
  ignore: !isDeno,
}, () => {
  denoOnlyIt("concurrent requests for same file should not race", async () => {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      const buttonPath = `${projectDir}/components/Button.tsx`;
      const files: Record<string, string> = {
        [buttonPath]: generateLeafComponent("Button"),
      };

      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);
      const loader = new SSRModuleLoader({
        projectDir,
        projectId: "test-concurrent",
        contentSourceId: "local-main",
        adapter,
        dev: true,
      });

      const concurrentRequests = 10;
      const buttonSource = files[buttonPath]!;
      const promises = Array.from(
        { length: concurrentRequests },
        () => loader.loadModule(buttonPath, buttonSource).catch((error) => ({ error })),
      );

      const results = await Promise.all(promises);
      const errors = results.filter(hasErrorResult);

      assertEquals(errors.length, 0, `Expected no errors, got: ${JSON.stringify(errors)}`);
      console.log(`✓ ${concurrentRequests} concurrent requests completed without race condition`);
    } finally {
      await removeDir(projectDir);
    }
  });

  denoOnlyIt("deep dependency tree should not deadlock", async () => {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      const appPath = `${projectDir}/components/App.tsx`;

      const files: Record<string, string> = {
        [`${projectDir}/components/Logo.tsx`]: generateLeafComponent("Logo"),
        [`${projectDir}/components/Nav.tsx`]: generateLeafComponent("Nav"),
        [`${projectDir}/components/Links.tsx`]: generateLeafComponent("Links"),
        [`${projectDir}/components/Copyright.tsx`]: generateLeafComponent("Copyright"),
        [`${projectDir}/components/Menu.tsx`]: generateLeafComponent("Menu"),
        [`${projectDir}/components/Search.tsx`]: generateLeafComponent("Search"),

        [`${projectDir}/components/Header.tsx`]: generateComponent("Header", ["Logo", "Nav"]),
        [`${projectDir}/components/Footer.tsx`]: generateComponent("Footer", [
          "Links",
          "Copyright",
        ]),
        [`${projectDir}/components/Sidebar.tsx`]: generateComponent("Sidebar", ["Menu", "Search"]),

        [appPath]: generateComponent("App", ["Header", "Footer", "Sidebar"]),
      };

      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);
      const loaders = Array.from(
        { length: 5 },
        () =>
          new SSRModuleLoader({
            projectDir,
            projectId: "test-deep-deps",
            contentSourceId: "local-main",
            adapter,
            dev: true,
          }),
      );

      const startTime = Date.now();
      const timeout = scaleMs(10000);
      const appSource = files[appPath]!;

      const promises = loaders.map((loader) =>
        withTimeout(loader.loadModule(appPath, appSource), timeout).catch((error) => ({ error }))
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      const timeouts = results.filter(
        (r) => hasErrorResult(r) && r.error.message.includes("TIMEOUT"),
      );
      assertEquals(timeouts.length, 0, "Deadlock detected! Some requests timed out.");

      const errors = results.filter(hasErrorResult);

      console.log(`✓ Deep dependency tree (3 levels) completed in ${elapsed}ms`);
      console.log(`  - 5 concurrent requests, semaphore=3`);
      console.log(`  - No deadlock detected`);
      console.log(`  - ${errors.length} errors (0 = success)`);
    } finally {
      await removeDir(projectDir);
    }
  });

  denoOnlyIt("wide dependency tree should complete", async () => {
    clearSSRModuleCache();

    const projectDir = await createTempProjectDir();

    try {
      const leafComponents = Array.from({ length: 10 }, (_, i) => `Comp${i + 1}`);
      const pagePath = `${projectDir}/components/Page.tsx`;

      const files: Record<string, string> = {
        [pagePath]: generateComponent("Page", leafComponents),
      };

      for (const name of leafComponents) {
        files[`${projectDir}/components/${name}.tsx`] = generateLeafComponent(name);
      }

      await writeComponentFiles(projectDir, files);

      const adapter = createRealAdapter(projectDir);

      const concurrentRequests = 20;
      const loaders = Array.from(
        { length: concurrentRequests },
        () =>
          new SSRModuleLoader({
            projectDir,
            projectId: "test-wide-deps",
            contentSourceId: "local-main",
            adapter,
            dev: true,
          }),
      );

      const startTime = Date.now();
      const pageSource = files[pagePath]!;

      const promises = loaders.map((loader) =>
        loader.loadModule(pagePath, pageSource).catch((error) => ({ error }))
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      const errors = results.filter(hasErrorResult);

      console.log(`✓ Wide dependency tree (10 deps) completed in ${elapsed}ms`);
      console.log(`  - ${concurrentRequests} concurrent requests`);
      console.log(`  - ${errors.length} errors (0 = success)`);
    } finally {
      await removeDir(projectDir);
    }
  });
});
