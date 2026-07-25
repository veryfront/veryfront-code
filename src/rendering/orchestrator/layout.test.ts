import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { LayoutOrchestrator } from "./layout.ts";
import {
  clearImportMapCache,
  createImportMapIdentity,
} from "#veryfront/modules/import-map/index.ts";

describe("rendering/orchestrator/layout", () => {
  it("threads validated hosted config into import-map and MDX preloading", async () => {
    const adapter = createMockAdapter();
    const readPaths: string[] = [];
    let configFileProbes = 0;
    const config = validateVeryfrontConfig({
      react: { version: "19.2.4" },
      resolve: {
        importMap: {
          imports: {
            "hosted-package": "https://config.example/hosted-package.ts",
          },
        },
      },
    });

    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => adapter.fs,
      isMultiProjectMode: () => true,
      isVeryfrontAdapter: () => true,
      exists: async () => {
        configFileProbes += 1;
        return true;
      },
      readFile: async (path: string) => {
        readPaths.push(path);
        if (path === "deno.json") {
          return JSON.stringify({
            imports: {
              "hosted-package": "https://deno.example/hosted-package.ts",
            },
          });
        }
        throw new Error(`Unexpected hosted filesystem read: ${path}`);
      },
    });

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let transformedCode = "";
    mutableRenderer.loadModuleESM = ((code: string) => {
      transformedCode = code;
      return Promise.resolve({ default: () => null });
    }) as typeof mdxRenderer.loadModuleESM;

    const layoutCache: LayoutComponentCache = {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      clear: () => {},
    };
    const orchestrator = new LayoutOrchestrator({
      projectDir: "/hosted-project",
      projectId: "project-1",
      projectSlug: "hosted-project",
      contentSourceId: "release-1",
      adapter,
      config,
      mode: "production",
      layoutCollector: {
        collectLayouts: () =>
          Promise.resolve({
            layoutBundle: undefined,
            nestedLayouts: [],
          }),
      } as unknown as LayoutCollector,
      layoutCompiler: {
        compileLayouts: () => Promise.resolve(),
      } as unknown as LayoutCompiler,
      layoutCache,
      componentRegistry: {},
    });

    try {
      const summary = await orchestrator.preloadLayoutModules([
        {
          kind: "mdx",
          path: "/layouts/root.mdx",
          bundle: {
            compiledCode:
              'import hosted from "https://esm.sh/hosted-package@1"; export default function Layout() { return hosted; }',
          },
        },
      ]);

      assertEquals(summary.importMapSuccess, true);
      assertEquals(summary.mdxSuccess, 1);
      assertEquals(
        summary.requestIdentity.importMapIdentity.importMap.imports?.["hosted-package"],
        "https://config.example/hosted-package.ts",
      );
      assert(
        transformedCode.includes("https://config.example/hosted-package.ts"),
        "MDX preloading should consume the same validated config import map",
      );
      assertEquals(readPaths, ["deno.json"]);
      assertEquals(configFileProbes, 0);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      orchestrator.clearCache();
    }
  });

  it("fails closed when the exact hosted import map cannot be read", async () => {
    const adapter = createMockAdapter();
    let ambientConfigProbes = 0;
    let moduleLoads = 0;
    const config = validateVeryfrontConfig({
      react: { version: "19.2.4" },
      resolve: {
        importMap: {
          imports: {
            package: "https://config.example/package.ts",
          },
        },
      },
    });
    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => adapter.fs,
      isMultiProjectMode: () => true,
      isVeryfrontAdapter: () => true,
      exists: async () => {
        ambientConfigProbes += 1;
        return true;
      },
      readFile: () => Promise.reject(new Error("hosted deno.json read denied")),
    });

    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    mutableRenderer.loadModuleESM = (() => {
      moduleLoads += 1;
      return Promise.resolve({ default: () => null });
    }) as typeof mdxRenderer.loadModuleESM;

    const orchestrator = new LayoutOrchestrator({
      projectDir: "/hosted-read-failure",
      projectId: "project-read-failure",
      projectSlug: "hosted-read-failure",
      contentSourceId: "release-read-failure",
      adapter,
      config,
      mode: "production",
      layoutCollector: {
        collectLayouts: () =>
          Promise.resolve({
            layoutBundle: undefined,
            nestedLayouts: [],
          }),
      } as unknown as LayoutCollector,
      layoutCompiler: {
        compileLayouts: () => Promise.resolve(),
      } as unknown as LayoutCompiler,
      layoutCache: {
        get: () => undefined,
        set: () => {},
        delete: () => {},
        clear: () => {},
      },
      componentRegistry: {},
    });

    try {
      await assertRejects(
        () =>
          orchestrator.preloadLayoutModules([
            {
              kind: "mdx",
              path: "/layouts/root.mdx",
              bundle: {
                compiledCode: 'import value from "package"; export default value;',
              },
            },
          ]),
        Error,
        "hosted deno.json read denied",
      );
      assertEquals(ambientConfigProbes, 0);
      assertEquals(moduleLoads, 0);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      orchestrator.clearCache();
    }
  });

  it("uses per-call project and content-source overrides instead of constructor identity", async () => {
    const adapter = createMockAdapter();
    const config = validateVeryfrontConfig({
      react: { version: "19.2.4" },
      resolve: {
        importMap: {
          imports: {
            package: "https://config.example/package.ts",
          },
        },
      },
    });
    const orchestrator = new LayoutOrchestrator({
      projectDir: "/request-identity",
      projectId: "constructor-project",
      projectSlug: "constructor-slug",
      contentSourceId: "constructor-source",
      adapter,
      config,
      mode: "production",
      layoutCollector: {
        collectLayouts: () =>
          Promise.resolve({
            layoutBundle: undefined,
            nestedLayouts: [],
          }),
      } as unknown as LayoutCollector,
      layoutCompiler: {
        compileLayouts: () => Promise.resolve(),
      } as unknown as LayoutCompiler,
      layoutCache: {
        get: () => undefined,
        set: () => {},
        delete: () => {},
        clear: () => {},
      },
      componentRegistry: {},
    });

    try {
      const first = await orchestrator.preloadLayoutModules([], {
        projectId: "request-project-a",
        projectSlug: "request-slug-a",
        contentSourceId: "request-source-a",
      });
      const second = await orchestrator.preloadLayoutModules([], {
        projectId: "request-project-b",
        projectSlug: "request-slug-b",
        contentSourceId: "request-source-b",
      });

      assertEquals(
        {
          projectId: first.requestIdentity.projectId,
          projectSlug: first.requestIdentity.projectSlug,
          contentSourceId: first.requestIdentity.contentSourceId,
          package: first.requestIdentity.importMapIdentity.importMap.imports?.package,
        },
        {
          projectId: "request-project-a",
          projectSlug: "request-slug-a",
          contentSourceId: "request-source-a",
          package: "https://config.example/package.ts",
        },
      );
      assertEquals(
        {
          projectId: second.requestIdentity.projectId,
          projectSlug: second.requestIdentity.projectSlug,
          contentSourceId: second.requestIdentity.contentSourceId,
          package: second.requestIdentity.importMapIdentity.importMap.imports?.package,
        },
        {
          projectId: "request-project-b",
          projectSlug: "request-slug-b",
          contentSourceId: "request-source-b",
          package: "https://config.example/package.ts",
        },
      );
    } finally {
      clearImportMapCache("request-project-a");
      clearImportMapCache("request-project-b");
      orchestrator.clearCache();
    }
  });

  it("preserves request identity after post-import Promise replacement", async () => {
    const intrinsicPromise = Promise;
    const globalPromiseDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Promise")!;
    const promiseThenDescriptor = Object.getOwnPropertyDescriptor(
      intrinsicPromise.prototype,
      "then",
    )!;
    const intrinsicThen = promiseThenDescriptor.value as typeof intrinsicPromise.prototype.then;
    const ReflectApply = Reflect.apply;
    const adapter = createMockAdapter();
    const config = validateVeryfrontConfig({
      react: { version: "19.2.4" },
      resolve: {
        importMap: {
          imports: {
            package: "https://config.example/exact-package.ts",
          },
        },
      },
    });

    Object.assign(adapter.fs, {
      getUnderlyingAdapter: () => adapter.fs,
      isMultiProjectMode: () => true,
      isVeryfrontAdapter: () => true,
      readFile: async (path: string) => {
        if (path === "deno.json") {
          return JSON.stringify({
            imports: {
              package: "https://deno.example/wrong-package.ts",
            },
          });
        }
        throw new Error(`Unexpected hosted filesystem read: ${path}`);
      },
    });

    const orchestrator = new LayoutOrchestrator({
      projectDir: "/promise-replacement",
      projectId: "promise-replacement-project",
      projectSlug: "promise-replacement-slug",
      contentSourceId: "promise-replacement-source",
      adapter,
      config,
      mode: "production",
      layoutCollector: {
        collectLayouts: () =>
          intrinsicPromise.resolve({
            layoutBundle: undefined,
            nestedLayouts: [],
          }),
      } as unknown as LayoutCollector,
      layoutCompiler: {
        compileLayouts: () => intrinsicPromise.resolve(),
      } as unknown as LayoutCompiler,
      layoutCache: {
        get: () => undefined,
        set: () => {},
        delete: () => {},
        clear: () => {},
      },
      componentRegistry: {},
    });
    class ReplacementPromise {
      constructor() {
        throw new Error("global Promise constructor must not be consulted");
      }

      static all(): never {
        throw new Error("global Promise.all must not be consulted");
      }
    }

    let packageImport: string | undefined;
    let identityThenLookups = 0;
    try {
      Object.defineProperty(globalThis, "Promise", {
        ...globalPromiseDescriptor,
        value: ReplacementPromise,
      });
      Object.defineProperty(intrinsicPromise.prototype, "then", {
        ...promiseThenDescriptor,
        value: function (
          this: Promise<unknown>,
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) {
          if (onFulfilled === createImportMapIdentity) {
            identityThenLookups += 1;
            throw new Error("Promise.prototype.then must not brand request identity");
          }
          return ReflectApply(intrinsicThen, this, [onFulfilled, onRejected]);
        },
      });

      const summary = await orchestrator.preloadLayoutModules([]);
      packageImport = summary.requestIdentity.importMapIdentity.importMap.imports?.package;
    } finally {
      Object.defineProperty(intrinsicPromise.prototype, "then", promiseThenDescriptor);
      Object.defineProperty(globalThis, "Promise", globalPromiseDescriptor);
      orchestrator.clearCache();
    }

    assertEquals(packageImport, "https://config.example/exact-package.ts");
    assertEquals(identityThenLookups, 0);
  });
});
