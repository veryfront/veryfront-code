import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { VERSION } from "#veryfront/utils/version-constant.ts";
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

  it("shares cache entries with release-versioned hydration loads", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/release.js",
        'export default function Page() { return "release"; }',
      );
      const previousReleaseId = Object.getOwnPropertyDescriptor(
        globalThis,
        "__veryfrontReleaseId",
      );

      await withModuleServerUrl(tempDir, async () => {
        Object.defineProperty(globalThis, "__veryfrontReleaseId", {
          configurable: true,
          value: "rel-1",
          writable: true,
        });
        try {
          const hydrationComponent = await loadComponent(
            `pages/release.tsx?vf_release=rel-1&vf_runtime=${VERSION}`,
          );
          const clientComponent = await loadComponent("pages/release.tsx");

          assertStrictEquals(clientComponent, hydrationComponent);
          assertStrictEquals(getCachedComponent("pages/release.tsx"), hydrationComponent);
        } finally {
          if (previousReleaseId) {
            Object.defineProperty(globalThis, "__veryfrontReleaseId", previousReleaseId);
          } else {
            delete (globalThis as Record<string, unknown>).__veryfrontReleaseId;
          }
        }
      });
    }, { prefix: "vf-client-loader-release-" });
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
      assertEquals(errors[0]?.includes("layouts/missing.tsx"), false);
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

  it("contains import failures with hostile thrown values", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/hostile.js",
        `throw new Proxy({}, {
          getPrototypeOf() { throw new Error("prototype trap"); }
        });`,
      );

      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await withModuleServerUrl(tempDir, async () => {
          assertStrictEquals(await loadComponent("pages/hostile.tsx"), null);
        });
      } finally {
        console.error = originalError;
      }
      assertEquals(errors, ["[Veryfront] Component load failed (UnknownError)"]);
    }, { prefix: "vf-client-loader-hostile-" });
  });

  it("keys cached components by their resolved module URL", async () => {
    await withTempDir(async (firstTempDir) => {
      await withTempDir(async (secondTempDir) => {
        await writeModule(
          firstTempDir,
          "pages/same.js",
          'export default function Page() { return "first"; }',
        );
        await writeModule(
          secondTempDir,
          "pages/same.js",
          'export default function Page() { return "second"; }',
        );

        const globalRecord = globalThis as unknown as {
          MODULE_SERVER_URL?: string;
          window?: unknown;
        };
        const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
        const previousWindow = globalRecord.window;
        globalRecord.window = globalThis;
        clearComponentCache();

        try {
          globalRecord.MODULE_SERVER_URL = createFileModuleServerUrl(firstTempDir);
          const first = await loadComponent("pages/same.tsx");

          globalRecord.MODULE_SERVER_URL = createFileModuleServerUrl(secondTempDir);
          const second = await loadComponent("pages/same.tsx");

          assertEquals((first as () => string)(), "first");
          assertEquals((second as () => string)(), "second");
        } finally {
          clearComponentCache();
          if (previousModuleServerUrl === undefined) delete globalRecord.MODULE_SERVER_URL;
          else globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
          if (previousWindow === undefined) delete globalRecord.window;
          else globalRecord.window = previousWindow;
        }
      }, { prefix: "vf-client-loader-second-" });
    }, { prefix: "vf-client-loader-first-" });
  });

  it("separates default and content-layout exports that share a module URL", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "layouts/aliased.js",
        `export default function Page() { return "default"; }
         export function MDXLayout() { return "content-layout"; }`,
      );

      await withModuleServerUrl(tempDir, async () => {
        const DefaultComponent = await loadComponent("layouts/aliased.js");
        const ContentLayout = await loadComponent("layouts/aliased.mdx");

        assertEquals((DefaultComponent as () => string)(), "default");
        assertEquals((ContentLayout as () => string)(), "content-layout");
        assertStrictEquals(
          getCachedComponent("layouts/aliased.js"),
          DefaultComponent,
        );
        assertStrictEquals(
          getCachedComponent("layouts/aliased.mdx"),
          ContentLayout,
        );
      });
    }, { prefix: "vf-client-loader-export-kind-" });
  });

  it("does not repopulate the cache from a load invalidated by clear", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/slow.js",
        'await new Promise((resolve) => setTimeout(resolve, 25)); export default function Page() { return "slow"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        const pending = loadComponent("pages/slow.tsx");
        clearComponentCache();
        assertStrictEquals(await pending, null);

        assertStrictEquals(getCachedComponent("pages/slow.tsx"), null);
      });
    }, { prefix: "vf-client-loader-clear-" });
  });

  it("keeps the physical import concurrency bounded across cache invalidation", async () => {
    await withTempDir(async (tempDir) => {
      const loadGlobal = globalThis as typeof globalThis & {
        __vfClientLoadGate?: Promise<void>;
        __vfClientLoadStarts?: number;
      };
      let releaseGate!: () => void;
      loadGlobal.__vfClientLoadGate = new Promise((resolve) => {
        releaseGate = resolve;
      });
      loadGlobal.__vfClientLoadStarts = 0;

      await Promise.all(
        Array.from({ length: 65 }, (_, index) =>
          writeModule(
            tempDir,
            `pages/concurrent-${index}.js`,
            `globalThis.__vfClientLoadStarts = (globalThis.__vfClientLoadStarts || 0) + 1;
             await globalThis.__vfClientLoadGate;
             export default function Page() { return "${index}"; }`,
          )),
      );

      await withModuleServerUrl(tempDir, async () => {
        const initialLoads = Array.from(
          { length: 64 },
          (_, index) => loadComponent(`pages/concurrent-${index}.tsx`),
        );
        let queuedLoad: Promise<unknown> | undefined;
        try {
          for (
            let attempt = 0;
            attempt < 100 && loadGlobal.__vfClientLoadStarts !== 64;
            attempt++
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          assertEquals(loadGlobal.__vfClientLoadStarts, 64);

          clearComponentCache();
          queuedLoad = loadComponent("pages/concurrent-64.tsx");
          await new Promise((resolve) => setTimeout(resolve, 5));
          assertEquals(loadGlobal.__vfClientLoadStarts, 64);
        } finally {
          releaseGate();
          await Promise.allSettled([...initialLoads, queuedLoad]);
        }

        assertEquals(loadGlobal.__vfClientLoadStarts, 65);
        assertEquals(await queuedLoad !== null, true);
      });

      delete loadGlobal.__vfClientLoadGate;
      delete loadGlobal.__vfClientLoadStarts;
    }, { prefix: "vf-client-loader-concurrency-" });
  });

  it("bounds synchronous load bursts and reports saturation once", async () => {
    await withTempDir(async (tempDir) => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
      try {
        await withModuleServerUrl(tempDir, async () => {
          const loads = Array.from(
            { length: 300 },
            (_, index) => loadComponent(`pages/missing-burst-${index}.tsx`),
          );
          await Promise.all(loads);
        });
      } finally {
        console.error = originalError;
      }

      assertEquals(
        errors.filter((message) => message.includes("queue limit reached")).length,
        1,
      );
    }, { prefix: "vf-client-loader-burst-" });
  });

  it("rejects modules without a default component export", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/named.js",
        'export function Page() { return "named"; }',
      );

      const originalError = console.error;
      console.error = () => {};
      try {
        await withModuleServerUrl(tempDir, async () => {
          assertStrictEquals(await loadComponent("pages/named.tsx"), null);
          assertStrictEquals(getCachedComponent("pages/named.tsx"), null);
        });
      } finally {
        console.error = originalError;
      }
    }, { prefix: "vf-client-loader-export-" });
  });

  it("does not invoke component resolution option accessors", async () => {
    let getterCalls = 0;
    const originalError = console.error;
    console.error = () => {};
    try {
      for (const key of ["releaseAssetModules", "releaseId"] as const) {
        const options: Parameters<typeof loadComponent>[1] = {};
        Object.defineProperty(options, key, {
          enumerable: true,
          get() {
            getterCalls++;
            return null;
          },
        });
        assertStrictEquals(await loadComponent(`pages/${key}.tsx`, options), null);
        assertEquals(getterCalls, 0);
      }
    } finally {
      console.error = originalError;
    }
  });

  it("distinguishes invalid cache keys from ordinary cache misses", () => {
    assertStrictEquals(getCachedComponent("pages/not-loaded.tsx"), null);
    assertThrows(() => getCachedComponent("pages/../private.tsx"), TypeError);
  });

  it("uses the compiled MDX layout export for MDX modules", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "layouts/docs.js",
        'export function MDXLayout() { return "mdx-layout"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        const component = await loadComponent("layouts/docs.mdx");
        assertEquals((component as () => string)(), "mdx-layout");
      });
    }, { prefix: "vf-client-loader-mdx-" });
  });

  it("uses the compiled MDX layout export for Markdown modules", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "layouts/docs-markdown.js",
        'export function MDXLayout() { return "markdown-layout"; }',
      );

      await withModuleServerUrl(tempDir, async () => {
        const component = await loadComponent("layouts/docs-markdown.md");

        assertEquals((component as () => string)(), "markdown-layout");
      });
    }, { prefix: "vf-client-loader-markdown-" });
  });
});
