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
    await withTempDir(async (tempDir) => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await withModuleServerUrl(tempDir, async () => {
          const firstAttempt = await Promise.all([
            loadComponent("layouts/missing.tsx"),
            loadComponent("layouts/missing.tsx"),
          ]);

          assertEquals(firstAttempt, [null, null]);
          assertStrictEquals(getCachedComponent("layouts/missing.tsx"), null);

          await writeModule(
            tempDir,
            "layouts/missing.js",
            'export default function Layout() { return "layout"; }',
          );
          const recovered = await loadComponent("layouts/missing.tsx");
          assertEquals(recovered !== null, true);
          assertStrictEquals(getCachedComponent("layouts/missing.tsx"), recovered);
        });
      } finally {
        console.error = originalError;
      }

      assertEquals(errors.length, 1);
      assertEquals(errors[0]?.includes("layouts/missing.tsx"), true);
      assertEquals(errors[0]?.includes(tempDir), false);
      assertEquals(errors[0]?.includes("at async"), false);
    }, { prefix: "vf-client-loader-" });
  });

  it("does not let an invalidated in-flight import repopulate the cache", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/slow.js",
        `await new Promise((resolve) => setTimeout(resolve, 30));
         export default function Page() { return "slow"; }`,
      );

      await withModuleServerUrl(tempDir, async () => {
        const pending = loadComponent("pages/slow.tsx");
        await new Promise((resolve) => setTimeout(resolve, 5));
        clearComponentCache();

        const loaded = await pending;
        assertStrictEquals(loaded, null);
        assertStrictEquals(getCachedComponent("pages/slow.tsx"), null);

        const reloaded = await loadComponent("pages/slow.tsx");
        assertEquals(reloaded !== null, true);
        assertStrictEquals(getCachedComponent("pages/slow.tsx"), reloaded);
      });
    }, { prefix: "vf-client-loader-invalidation-" });
  });

  it("can recover from a runtime-cached import failure after the cache is cleared", async () => {
    await withTempDir(async (tempDir) => {
      const originalError = console.error;
      console.error = () => {};
      try {
        await withModuleServerUrl(tempDir, async () => {
          assertStrictEquals(await loadComponent("pages/created-later.tsx"), null);
          clearComponentCache();

          await writeModule(
            tempDir,
            "pages/created-later.js",
            'export default function Page() { return "created"; }',
          );

          assertEquals(await loadComponent("pages/created-later.tsx") !== null, true);
        });
      } finally {
        console.error = originalError;
      }
    }, { prefix: "vf-client-loader-clear-retry-" });
  });

  it("uses the normalized module URL as the cache identity", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/home.js",
        'export default function Page() { return "home"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        const component = await loadComponent("pages/home.tsx");

        assertStrictEquals(getCachedComponent("/_vf_modules/pages/home.js"), component);
        assertStrictEquals(await loadComponent("/_vf_modules/pages/home.js"), component);
      });
    }, { prefix: "vf-client-loader-alias-" });
  });

  it("rejects modules that do not export a React component", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(tempDir, "pages/data.js", "export const answer = 42;");

      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await withModuleServerUrl(tempDir, async () => {
          assertStrictEquals(await loadComponent("pages/data.tsx"), null);
          assertStrictEquals(getCachedComponent("pages/data.tsx"), null);
        });
      } finally {
        console.error = originalError;
      }

      assertEquals(errors.length, 1);
      assertEquals(errors[0]?.includes("pages/data.tsx"), true);
      assertEquals(errors[0]?.includes("TypeError"), true);
      assertEquals(errors[0]?.includes(tempDir), false);
    }, { prefix: "vf-client-loader-invalid-" });
  });

  it("accepts React exotic component types", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "components/Memo.js",
        `import React from "react";
         function Component() { return React.createElement("span", null, "memo"); }
         export default React.memo(Component);`,
      );

      await withModuleServerUrl(tempDir, async () => {
        const component = await loadComponent("components/Memo.tsx");
        assertEquals(component !== null, true);
        assertStrictEquals(getCachedComponent("components/Memo.tsx"), component);
      });
    }, { prefix: "vf-client-loader-exotic-" });
  });

  it("fails asynchronously when module URL configuration is malformed", async () => {
    const globalRecord = globalThis as unknown as {
      MODULE_SERVER_URL?: unknown;
      window?: unknown;
    };
    const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
    const previousWindow = globalRecord.window;
    const originalError = console.error;
    const errors: string[] = [];
    globalRecord.window = globalThis;
    globalRecord.MODULE_SERVER_URL = {};
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));

    try {
      const result = await loadComponent("pages/home.tsx");
      assertStrictEquals(result, null);
      assertStrictEquals(getCachedComponent("pages/home.tsx"), null);
      assertEquals(errors.length, 1);
      assertEquals(errors[0]?.includes("pages/home.tsx"), true);
    } finally {
      console.error = originalError;
      clearComponentCache();
      if (previousModuleServerUrl === undefined) delete globalRecord.MODULE_SERVER_URL;
      else globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
      if (previousWindow === undefined) delete globalRecord.window;
      else globalRecord.window = previousWindow;
    }
  });
});
