import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  BrowserModuleBundleError,
  bundleBrowserModule,
  bundleBrowserModuleWithMetadata,
  getSafeBrowserModuleIdentity,
  validateBrowserModuleBundle,
} from "./browser-module-bundler.ts";

describe(
  "server/shared/browser-module-bundler",
  () => {
    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    it("does not expose the project path through dependency module identities", async () => {
      const tenantMarker = "PRIVATE_TENANT_PATH_MARKER";
      const projectDir = `/private/tenants/${tenantMarker}/project`;
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(
        dependencyPath,
        'export const marker = "SHARED_BROWSER_DEPENDENCY";',
      );

      const output = await bundleBrowserModule(entryPath, { adapter, projectDir });

      assertStringIncludes(output, "SHARED_BROWSER_DEPENDENCY");
      assertEquals(output.includes(projectDir), false);
      assertEquals(output.includes(tenantMarker), false);
    });

    it("rejects a browser entry reached through a symbolic link", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Leak.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        'export const marker = "SYMLINKED_ENTRY_MARKER";',
      );
      const readDir = adapter.fs.readDir;
      adapter.fs.readDir = (path: string) =>
        path === `${projectDir}/app`
          ? (async function* () {
            yield {
              name: "Leak.ts",
              isFile: false,
              isDirectory: false,
              isSymlink: true,
            };
          })()
          : readDir(path);

      await assertRejects(
        () => bundleBrowserModule(entryPath, { adapter, projectDir }),
        Error,
      );
    });

    it("rejects entries outside the project before reading them", async () => {
      const projectDir = "/project";
      const entryPath = "/outside/Leak.ts";
      const adapter = createMockAdapter();
      let wasRead = false;
      adapter.fs.readFile = () => {
        wasRead = true;
        return Promise.resolve('export const marker = "OUTSIDE_ENTRY_MARKER";');
      };

      await assertRejects(
        () => bundleBrowserModule(entryPath, { adapter, projectDir }),
        Error,
      );
      assertEquals(wasRead, false);
    });

    it("fails closed when the bundler produces no output", async () => {
      const projectDir = "/private/tenants/PRIVATE_NO_OUTPUT_MARKER/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, '"use client"; export default null;');
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const error = await assertRejects(
          () => bundleBrowserModule(entryPath, { adapter, projectDir }),
          Error,
          "Browser module bundler produced no output",
        );
        assertEquals(String(error).includes(entryPath), false);
        assertEquals(String(error).includes("PRIVATE_NO_OUTPUT_MARKER"), false);
      } finally {
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("rejects a browser entry containing a function-local server action", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const marker = "ENTRY_FUNCTION_LOCAL_SERVER_SECRET_MARKER";
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          "export async function save() {",
          '  "use server";',
          `  return "${marker}";`,
          "}",
          "export default function Counter() { return null; }",
        ].join("\n"),
      );

      let error: unknown;
      try {
        await bundleBrowserModule(entryPath, { adapter, projectDir });
      } catch (caught) {
        error = caught;
      }

      assertEquals(error instanceof Error, true);
      assertEquals(String(error).includes(marker), false);
    });

    it("invalidates bundle metadata when entry or dependency content changes", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared.ts";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(dependencyPath, 'export const marker = "FIRST";');

      const first = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      assertEquals(await validateBrowserModuleBundle(first, { adapter, projectDir }), true);

      adapter.fs.files.set(dependencyPath, 'export const marker = "SECOND";');
      assertEquals(await validateBrowserModuleBundle(first, { adapter, projectDir }), false);

      const second = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      adapter.fs.files.set(
        entryPath,
        adapter.fs.files.get(entryPath)!.replace("return marker", "return marker + marker"),
      );
      assertEquals(await validateBrowserModuleBundle(second, { adapter, projectDir }), false);
    });

    it("invalidates when a new higher-priority import resolution candidate appears", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import { marker } from "./shared";',
          "export default function Counter() { return marker; }",
        ].join("\n"),
      );
      adapter.fs.files.set(dependencyPath, 'export const marker = "TYPESCRIPT";');

      const bundle = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
      });
      adapter.fs.files.set(
        `${projectDir}/app/shared.tsx`,
        'export const marker = "NEW_HIGHER_PRIORITY_TSX";',
      );

      assertEquals(await validateBrowserModuleBundle(bundle, { adapter, projectDir }), false);
    });

    it("uses the supplied effective import map for the bundle", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'import marker from "custom-package";',
          "export default marker;",
        ].join("\n"),
      );

      const ownedImportMapJson = JSON.stringify({
        imports: { "custom-package": "https://cdn.example/custom-package.js" },
      });
      const unownedImportMapJson = JSON.stringify({ imports: {} });
      const owned = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        importMapJson: ownedImportMapJson,
      });
      const unowned = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        importMapJson: unownedImportMapJson,
      });

      assertStringIncludes(owned.source, 'from "custom-package"');
      assertStringIncludes(unowned.source, 'from "https://esm.sh/custom-package"');
      assertEquals(owned.importMapHash, await computeHash(ownedImportMapJson));
      assertEquals(unowned.importMapHash, await computeHash(unownedImportMapJson));
      assertEquals(owned.importMapHash === unowned.importMapHash, false);
    });

    it("pins direct same-origin HTTP module imports and preserves foreign URLs", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          'import A from "https://preview.example/_vf_modules/A.js";',
          'import B from "//preview.example/_vf_modules/B.js";',
          'import C from "HTTPS://preview.example/_vf_modules/C.js";',
          'import Foreign from "https://cdn.example/_vf_modules/Foreign.js";',
          "export default [A, B, C, Foreign];",
        ].join("\n"),
      );

      const bundle = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        moduleServerOrigin: "https://preview.example",
        dependencyPinningCacheKey: "on:54uvgwr2ih7p",
        dependencyPinningDependencies: {},
      });

      assertStringIncludes(
        bundle.source,
        'from "/_vf_modules/_pins/on%3A54uvgwr2ih7p/A.js"',
      );
      assertStringIncludes(
        bundle.source,
        'from "/_vf_modules/_pins/on%3A54uvgwr2ih7p/B.js"',
      );
      assertStringIncludes(
        bundle.source,
        'from "/_vf_modules/_pins/on%3A54uvgwr2ih7p/C.js"',
      );
      assertStringIncludes(
        bundle.source,
        'from "https://cdn.example/_vf_modules/Foreign.js"',
      );
    });

    it("accepts top-level await in browser modules", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Counter.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        [
          '"use client";',
          'const marker = await Promise.resolve("BROWSER_TLA_MARKER");',
          "export default marker;",
        ].join("\n"),
      );

      const output = await bundleBrowserModule(entryPath, { adapter, projectDir });

      assertStringIncludes(output, 'await Promise.resolve("BROWSER_TLA_MARKER")');
    });

    it("enforces dependency, aggregate input, and aggregate output limits", async () => {
      const projectDir = "/bounded-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, 'import "./a.ts"; import "./b.ts"; export default 1;');
      adapter.fs.files.set(`${projectDir}/app/a.ts`, "export const a = 1;");
      adapter.fs.files.set(`${projectDir}/app/b.ts`, "export const b = 1;");

      const dependencyError = await assertRejects(
        () =>
          bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            importMapJson: "{}",
            limits: { maxDependencies: 2 },
          }),
        BrowserModuleBundleError,
      );
      assertEquals((dependencyError as BrowserModuleBundleError).kind, "limit");

      const encoder = new TextEncoder();
      const aggregateInputLimit = encoder.encode(adapter.fs.files.get(entryPath)!).byteLength +
        encoder.encode(adapter.fs.files.get(`${projectDir}/app/a.ts`)!).byteLength;
      const inputError = await assertRejects(
        () =>
          bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            importMapJson: "{}",
            limits: { maxAggregateInputBytes: aggregateInputLimit },
          }),
        BrowserModuleBundleError,
      );
      assertEquals((inputError as BrowserModuleBundleError).kind, "limit");

      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: () =>
          Promise.resolve({
            outputFiles: [
              {
                path: "out-1.js",
                contents: new Uint8Array(5),
                text: "12345",
              },
              {
                path: "out-2.js",
                contents: new Uint8Array(5),
                text: "67890",
              },
            ],
            warnings: [],
            errors: [],
          }),
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });
      try {
        const outputError = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              adapter,
              projectDir,
              importMapJson: "{}",
              limits: { maxOutputBytes: 8 },
            }),
          BrowserModuleBundleError,
        );
        assertEquals((outputError as BrowserModuleBundleError).kind, "limit");
      } finally {
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("keeps distinct entries separate when a caller reuses a singleflight key", async () => {
      const projectDir = "/distinct-entry-project";
      const firstPath = `${projectDir}/app/first.ts`;
      const secondPath = `${projectDir}/app/second.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(firstPath, "export default 1;");
      adapter.fs.files.set(secondPath, "export default 2;");
      let calls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: (options) => {
          calls += 1;
          const source = options.stdin?.contents ?? "";
          return Promise.resolve({
            outputFiles: [{
              path: "out.js",
              contents: new TextEncoder().encode(source),
              text: source,
            }],
            warnings: [],
            errors: [],
          });
        },
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const common = {
          adapter,
          projectDir,
          importMapJson: "{}",
          singleflightKey: "accidentally-reused",
        };
        const [first, second] = await Promise.all([
          bundleBrowserModuleWithMetadata(firstPath, common),
          bundleBrowserModuleWithMetadata(secondPath, common),
        ]);
        assertEquals(calls, 2);
        assertEquals(first.source, "export default 1;");
        assertEquals(second.source, "export default 2;");
      } finally {
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("coalesces equivalent work and bounds distinct bundles per project", async () => {
      const projectDir = "/coalesced-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");
      const release = Promise.withResolvers<void>();
      const twoActive = Promise.withResolvers<void>();
      let calls = 0;
      let active = 0;
      let maximumActive = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: async () => {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (active === 2) twoActive.resolve();
          await release.promise;
          active -= 1;
          return {
            outputFiles: [{
              path: "out.js",
              contents: new TextEncoder().encode("export default 1;"),
              text: "export default 1;",
            }],
            warnings: [],
            errors: [],
          };
        },
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const common = {
          adapter,
          projectDir,
          importMapJson: "{}",
          limits: { maxConcurrentPerIdentity: 2, maxQueuedPerIdentity: 2 },
        };
        const first = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          singleflightKey: "same",
        });
        const joined = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          singleflightKey: "same",
        });
        const second = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          singleflightKey: "different-1",
        });
        const queued = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          singleflightKey: "different-2",
        });

        await twoActive.promise;
        assertEquals(calls, 2);
        assertEquals(maximumActive, 2);
        release.resolve();
        const [firstResult, joinedResult] = await Promise.all([first, joined, second, queued]);
        assertEquals(firstResult === joinedResult, true);
        assertEquals(calls, 3);
        assertEquals(maximumActive, 2);
      } finally {
        release.resolve();
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("rejects excess per-project bundle queues without starting more work", async () => {
      const projectDir = "/capacity-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const createAdapter = () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(entryPath, "export default 1;");
        return adapter;
      };
      const activeAdapter = createAdapter();
      const queuedAdapter = createAdapter();
      const rejectedAdapter = createAdapter();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let calls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: async () => {
          calls += 1;
          started.resolve();
          await release.promise;
          return {
            outputFiles: [{
              path: "out.js",
              contents: new TextEncoder().encode("export default 1;"),
              text: "export default 1;",
            }],
            warnings: [],
            errors: [],
          };
        },
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const common = {
          projectDir,
          projectId: "capacity-project",
          importMapJson: "{}",
          limits: { maxConcurrentPerIdentity: 1, maxQueuedPerIdentity: 1 },
        };
        const active = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          adapter: activeAdapter,
          singleflightKey: "active",
        });
        await started.promise;
        const queued = bundleBrowserModuleWithMetadata(entryPath, {
          ...common,
          adapter: queuedAdapter,
          singleflightKey: "queued",
        });
        void queued.catch(() => undefined);
        const rejected = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              ...common,
              adapter: rejectedAdapter,
              singleflightKey: "rejected",
            }),
          BrowserModuleBundleError,
        );
        assertEquals((rejected as BrowserModuleBundleError).kind, "capacity");
        assertEquals(calls, 1);

        release.resolve();
        await Promise.all([active, queued]);
        assertEquals(calls, 2);
      } finally {
        release.resolve();
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("propagates request cancellation and a hard deadline into the bundler", async () => {
      const projectDir = "/cancelled-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");
      const started = Promise.withResolvers<void>();
      const cancelled = Promise.withResolvers<unknown>();
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: (options) =>
          new Promise((_resolve, reject) => {
            started.resolve();
            const onAbort = () => {
              cancelled.resolve(options.signal?.reason);
              reject(options.signal?.reason);
            };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            if (options.signal?.aborted) onAbort();
          }),
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      });

      try {
        const controller = new AbortController();
        const bundling = bundleBrowserModuleWithMetadata(entryPath, {
          adapter,
          projectDir,
          importMapJson: "{}",
          signal: controller.signal,
          singleflightKey: "cancel-me",
        });
        await started.promise;
        controller.abort(new DOMException("request cancelled", "AbortError"));
        await assertRejects(() => bundling, DOMException);
        const reason = await cancelled.promise;
        assertEquals(reason instanceof DOMException, true);

        const deadlineError = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              adapter,
              projectDir,
              importMapJson: "{}",
              singleflightKey: "deadline",
              limits: { maxDurationMs: 10 },
            }),
          BrowserModuleBundleError,
        );
        assertEquals((deadlineError as BrowserModuleBundleError).kind, "deadline");
      } finally {
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("uses only project-relative identities for source files and spans", () => {
      assertEquals(
        getSafeBrowserModuleIdentity(
          "/private/tenant/project/app/Counter.tsx",
          "/private/tenant/project",
        ),
        "/app/Counter.tsx",
      );
      assertEquals(
        getSafeBrowserModuleIdentity("/private/tenant/secret.ts", "/project"),
        "/secret.ts",
      );
    });
  },
);
