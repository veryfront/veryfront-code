import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import {
  clearComponentCache,
  getCachedComponent,
  loadComponent,
  preloadComponent,
} from "./component-loader.ts";

function createFileModuleServerUrl(tempDir: string): string {
  return `file://${tempDir}`;
}

async function writeModule(
  tempDir: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const filePath = `${tempDir}/${relativePath}`;
  const directory = filePath.slice(0, filePath.lastIndexOf("/"));
  await mkdir(directory, { recursive: true });
  await writeTextFile(filePath, source);
}

async function withModuleServerUrl<T>(tempDir: string, fn: () => Promise<T>): Promise<T> {
  const globalRecord = globalThis as unknown as {
    MODULE_SERVER_URL?: string;
    window?: unknown;
  };
  const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
  const previousWindow = globalRecord.window;
  globalRecord.window = globalThis;
  globalRecord.MODULE_SERVER_URL = createFileModuleServerUrl(tempDir);
  clearComponentCache();

  try {
    return await fn();
  } finally {
    clearComponentCache();

    if (previousModuleServerUrl === undefined) {
      delete globalRecord.MODULE_SERVER_URL;
    } else {
      globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
    }

    if (previousWindow === undefined) {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  }
}

describe("client/spa/component-loader", () => {
  it("loads a module once and reuses the cached component", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/home.js",
        'export default function Page() { return "home"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        const first = await loadComponent("pages/home.tsx");
        const second = await loadComponent("pages/home.tsx");

        assertStrictEquals(first, second);
        assertStrictEquals(getCachedComponent("pages/home.tsx"), first);
      });
    }, { prefix: "vf-client-loader-" });
  });

  it("preloadComponent warms the cache without changing the return contract", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "components/Card.js",
        'export default function Card() { return "card"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        await preloadComponent("components/Card.jsx");

        assertEquals(getCachedComponent("components/Card.jsx") !== null, true);
      });
    }, { prefix: "vf-client-loader-" });
  });

  it("clears failed in-flight loads so a later retry can succeed", async () => {
    await withTempDir(async (missingTempDir) => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await withModuleServerUrl(missingTempDir, async () => {
          const firstAttempt = await Promise.all([
            loadComponent("layouts/missing.tsx"),
            loadComponent("layouts/missing.tsx"),
          ]);

          assertEquals(firstAttempt, [null, null]);
          assertStrictEquals(getCachedComponent("layouts/missing.tsx"), null);
        });
      } finally {
        console.error = originalError;
      }

      assertEquals(errors.length, 1);
      assertEquals(errors[0]?.includes("layouts/missing.tsx"), true);
      assertEquals(errors[0]?.includes("TypeError"), true);
      assertEquals(errors[0]?.includes(missingTempDir), false);
      assertEquals(errors[0]?.includes("at async"), false);
    }, { prefix: "vf-client-loader-" });

    await withTempDir(async (recoveredTempDir) => {
      await writeModule(
        recoveredTempDir,
        "layouts/missing.js",
        'export default function Layout() { return "layout"; }',
      );

      await withModuleServerUrl(recoveredTempDir, async () => {
        const recovered = await loadComponent("layouts/missing.tsx");
        assertEquals(recovered !== null, true);
      });
    }, { prefix: "vf-client-loader-" });
  });
});
