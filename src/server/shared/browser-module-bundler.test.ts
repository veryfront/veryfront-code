import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import type { Bundler } from "#veryfront/extensions/bundler/bundler.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
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
      const readSnapshot = adapter.fs.readFileSnapshotWithinLimit!;
      adapter.fs.readFileSnapshotWithinLimit = (path, root, limit) =>
        path === entryPath
          ? Promise.reject(new Error("snapshot rejected symbolic link"))
          : readSnapshot(path, root, limit);

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

    it("rejects import-map aliases targeting configured esm.sh packages", async () => {
      const projectDir = "/project";
      const entryPath = `${projectDir}/app/Database.tsx`;
      const directPath = `${projectDir}/app/DirectDatabase.tsx`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        '"use client"; import database from "db"; export default database;',
      );
      adapter.fs.files.set(
        directPath,
        '"use client"; import database from "https://esm.sh/knex@3.1.0"; export default database;',
      );

      for (
        const target of [
          "https://esm.sh/v135/knex@3.1.0/",
          " https://esm.sh/knex@3.1.0",
          String.raw`https:\\esm.sh\knex@3.1.0`,
          "h\tttps://esm.sh/knex@3.1.0",
        ]
      ) {
        await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              adapter,
              projectDir,
              importMapJson: JSON.stringify({ imports: { db: target } }),
              config: { build: { serverExternalPackages: ["knex"] } },
            }),
          Error,
          "build.serverExternalPackages",
        );
      }
      await assertRejects(
        () =>
          bundleBrowserModuleWithMetadata(directPath, {
            adapter,
            projectDir,
            config: { build: { serverExternalPackages: ["knex"] } },
          }),
        Error,
        "build.serverExternalPackages",
      );
    });

    describe("configured server external browser boundaries", () => {
      const projectDir = "/project";
      const declaredPath = `${projectDir}/app/Declared.tsx`;
      const scopedNpmPath = `${projectDir}/app/ScopedNpm.tsx`;
      const optionalCommonJsPath = `${projectDir}/app/OptionalCommonJs.tsx`;
      const ambientRequirePath = `${projectDir}/app/AmbientRequire.tsx`;
      const ambientModulePath = `${projectDir}/app/AmbientModule.tsx`;
      const typeImportRequirePath = `${projectDir}/app/TypeImportRequire.tsx`;
      const typeImportEqualsRequirePath = `${projectDir}/app/TypeImportEqualsRequire.tsx`;
      const typeImportEqualsModulePath = `${projectDir}/app/TypeImportEqualsModule.tsx`;
      const dependencyEntryPath = `${projectDir}/app/DependencyEntry.tsx`;
      const dependencyPath = `${projectDir}/app/database.ts`;
      const localRequirePath = `${projectDir}/app/LocalRequire.tsx`;
      const localSequencePath = `${projectDir}/app/LocalSequence.tsx`;
      const namespaceModulePath = `${projectDir}/app/NamespaceModule.tsx`;
      const declaredNamespaceMemberPath = `${projectDir}/app/DeclaredNamespaceMember.tsx`;
      const nestedNamespaceModulePath = `${projectDir}/app/NestedNamespaceModule.tsx`;
      const typeOnlyNamespaceModulePath = `${projectDir}/app/TypeOnlyNamespaceModule.tsx`;
      const typeOnlyNamespaceRequirePath = `${projectDir}/app/TypeOnlyNamespaceRequire.tsx`;
      const compatiblePath = `${projectDir}/app/Compatible.tsx`;
      const wrappedCommonJsModules = [
        String.raw`requ\u0069re?.("knex")`,
        String.raw`module?.requ\u0069re?.("knex")`,
        String.raw`module["requ\u0069re"]?.("knex")`,
        `(require as any)?.("knex")`,
        `require!?.("knex")`,
        `(<any> require)?.("knex")`,
        `(require satisfies any)?.("knex")`,
        `require<string>?.("knex")`,
        `require.resolve?.("knex")`,
        `require("https://esm.sh/knex@3.1.0")`,
        `require.resolve("https://esm.sh/knex@3.1.0")`,
        `require.call(null, "knex")`,
        `require.resolve.call(null, "knex")`,
        `module.require.call(module, "knex")`,
        `require.apply(null, ["knex"])`,
        `require.resolve.apply(null, ["knex"])`,
        `module.require.apply(module, ["knex"])`,
        `require.bind(null, "knex")()`,
        `require.resolve.bind(null, "knex")()`,
        `module.require.bind(module, "knex")()`,
        `require.bind(null)("knex")`,
        `require.resolve.bind(null)("knex")`,
        `module.require.bind(module)("knex")`,
        `require.main.require("knex")`,
        `module.parent.require("knex")`,
        `module?.parent?.require?.("knex")`,
        `(0, require)("knex")`,
        `(require, require)("knex")`,
        `new require("knex")`,
        `new module.require("knex")`,
        `module["requ" + "ire"]("knex")`,
        `require["res" + "olve"]("knex")`,
        'module[`requ${"ire"}`](`kn${"ex"}`)',
        'require.resolve(`kn${"ex"}`)',
        `(module as any)?.require?.("knex")`,
        `module!?.require?.("knex")`,
        `module!.require?.("knex")`,
        `module["require" as any]?.("knex")`,
        `module.require<string>?.("knex")`,
        `require?.("knex" as const)`,
        `require?.(<string> "knex")`,
        `module.require?.("knex" satisfies string)`,
        `require?.("knex"!)`,
        "require?.((`knex`) as const)",
      ].map((source, index) => ({
        path: `${projectDir}/app/WrappedCommonJs${index}.ts`,
        source,
      }));
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        declaredPath,
        '"use client"; import knex from "knex"; export default knex;',
      );
      adapter.fs.files.set(
        scopedNpmPath,
        '"use client"; import prisma from "npm:@prisma/client/runtime/library"; export default prisma;',
      );
      adapter.fs.files.set(
        compatiblePath,
        '"use client"; import lodash from "lodash"; export default lodash;',
      );
      adapter.fs.files.set(
        optionalCommonJsPath,
        '"use client"; const knex = require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        ambientRequirePath,
        '"use client"; declare const require: ((name: string) => unknown) | undefined; const knex = require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        ambientModulePath,
        '"use client"; declare const module: { require?: (name: string) => unknown }; const knex = module?.require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        typeImportRequirePath,
        '"use client"; import type require from "./types.ts"; const knex = require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        typeImportEqualsRequirePath,
        '"use client"; import type require = require("./types.ts"); const knex = require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        typeImportEqualsModulePath,
        '"use client"; import type module = require("./types.ts"); const knex = module?.require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        dependencyEntryPath,
        '"use client"; import database from "./database.ts"; export default database;',
      );
      adapter.fs.files.set(
        dependencyPath,
        'const knex = module?.require?.("knex"); export default knex;',
      );
      adapter.fs.files.set(
        localRequirePath,
        '"use client"; function load(require: (name: string) => unknown) { return require("knex"); } export default load;',
      );
      adapter.fs.files.set(
        localSequencePath,
        '"use client"; const local = (name: string) => name; export default (require, local)("knex");',
      );
      adapter.fs.files.set(
        namespaceModulePath,
        '"use client"; namespace module { export function require(name: string) { return `local:${name}`; } } export default module.require("knex");',
      );
      adapter.fs.files.set(
        declaredNamespaceMemberPath,
        '"use client"; namespace module { export declare const value: string; } export default module.require("knex");',
      );
      adapter.fs.files.set(
        nestedNamespaceModulePath,
        '"use client"; namespace outer { export namespace module { export function require(name: string) { return `nested:${name}`; } } export const value = module.require("knex"); } export default outer.value;',
      );
      adapter.fs.files.set(
        typeOnlyNamespaceModulePath,
        '"use client"; namespace module { export type Value = string; } export default module.require("knex");',
      );
      adapter.fs.files.set(
        typeOnlyNamespaceRequirePath,
        '"use client"; namespace require { export type Value = string; } export default require?.("knex");',
      );
      for (const moduleFixture of wrappedCommonJsModules) {
        adapter.fs.files.set(
          moduleFixture.path,
          `"use client"; export default ${moduleFixture.source};`,
        );
      }
      const config = { build: { serverExternalPackages: ["knex"] } };

      it("rejects declared ESM and scoped npm packages", async () => {
        const error = await assertRejects(() =>
          bundleBrowserModule(declaredPath, { adapter, projectDir, config })
        );
        assertStringIncludes(String(error), "knex");
        assertStringIncludes(String(error), "build.serverExternalPackages");
        assertStringIncludes(String(error), "server-only-in-client");

        const scopedNpmError = await assertRejects(() =>
          bundleBrowserModule(scopedNpmPath, {
            adapter,
            projectDir,
            config: { build: { serverExternalPackages: ["@prisma/client"] } },
          })
        );
        assertStringIncludes(String(scopedNpmError), "server-only-in-client");
        assertStringIncludes(String(scopedNpmError), "npm:@prisma/client/runtime/library");
      });

      it("rejects declared CommonJS forms and transitive dependencies", async () => {
        for (
          const commonJsPath of [
            optionalCommonJsPath,
            ambientRequirePath,
            ambientModulePath,
            typeImportRequirePath,
            typeImportEqualsRequirePath,
            typeImportEqualsModulePath,
            typeOnlyNamespaceModulePath,
            typeOnlyNamespaceRequirePath,
            ...wrappedCommonJsModules.map((moduleFixture) => moduleFixture.path),
            dependencyEntryPath,
          ]
        ) {
          const commonJsError = await assertRejects(
            () => bundleBrowserModule(commonJsPath, { adapter, projectDir, config }),
            `Expected ${commonJsPath} to reject`,
          );
          assertStringIncludes(
            String(commonJsError),
            "build.serverExternalPackages",
            commonJsPath,
          );
          assertStringIncludes(String(commonJsError), "knex", commonJsPath);
        }
      });

      it("preserves undeclared browser packages", async () => {
        const compatible = await bundleBrowserModule(compatiblePath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(compatible, "esm.sh/lodash");
      });

      it("preserves runtime-shadowed CommonJS calls", async () => {
        const localRequire = await bundleBrowserModule(localRequirePath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(localRequire, '"knex"');

        const localSequence = await bundleBrowserModule(localSequencePath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(localSequence, '"knex"');

        const namespaceModule = await bundleBrowserModule(namespaceModulePath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(namespaceModule, "local:");

        const declaredNamespaceMember = await bundleBrowserModule(declaredNamespaceMemberPath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(declaredNamespaceMember, '"knex"');

        const nestedNamespaceModule = await bundleBrowserModule(nestedNamespaceModulePath, {
          adapter,
          projectDir,
          config,
        });
        assertStringIncludes(nestedNamespaceModule, "nested:");
      });
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

    it("uses stable bounded snapshots without raw reads or directory walks", async () => {
      const projectDir = "/snapshot-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const dependencyPath = `${projectDir}/app/shared.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        entryPath,
        'import "./shared.ts"; import "./shared.ts"; export default 1;',
      );
      adapter.fs.files.set(dependencyPath, "export const shared = true;");
      const snapshotRead = adapter.fs.readFileSnapshotWithinLimit!;
      const stat = adapter.fs.stat;
      let snapshotReads = 0;
      let dependencyStats = 0;
      adapter.fs.readFile = () => Promise.reject(new Error("raw read must not be used"));
      adapter.fs.readDir = () => {
        throw new Error("directory walk must not be used");
      };
      adapter.fs.readFileSnapshotWithinLimit = (path, root, limit) => {
        snapshotReads += 1;
        return snapshotRead(path, root, limit);
      };
      adapter.fs.stat = (path) => {
        if (path === dependencyPath) dependencyStats += 1;
        return stat(path);
      };

      const bundle = await bundleBrowserModuleWithMetadata(entryPath, {
        adapter,
        projectDir,
        importMapJson: "{}",
      });

      assertEquals(bundle.dependencies.length, 2);
      assertEquals(snapshotReads, 2);
      assertEquals(dependencyStats, 1);
    });

    it("charges package metadata to the exact aggregate input budget", async () => {
      const projectDir = "/bounded-package-metadata";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const packagePath = `${projectDir}/package.json`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");
      adapter.fs.files.set(packagePath, "{}" + " ".repeat(2 * 1024 * 1024));
      let rawReads = 0;
      adapter.fs.readFile = () => {
        rawReads++;
        return Promise.reject(new Error("raw package metadata read is forbidden"));
      };
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      try {
        const error = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              adapter,
              projectDir,
              projectId: "bounded-package-metadata",
              requestedDependencyPinningCacheKey: `on:${hashString("[]")}`,
              dependencyPinningSource: {
                projectDir,
                fs: adapter.fs,
                cacheNamespace: "bounded-package-metadata",
              },
              limits: { maxAggregateInputBytes: 1024 * 1024 },
            }),
          BrowserModuleBundleError,
        );

        assertEquals((error as BrowserModuleBundleError).kind, "limit");
        assertEquals(rawReads, 0);
      } finally {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
      }
    });

    it("rejects invalid UTF-8 through the stable bounded reader", async () => {
      const projectDir = "/invalid-utf8-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.byteFiles.set(entryPath, new Uint8Array([0xff]));

      await assertRejects(
        async () =>
          await bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            importMapJson: "{}",
          }),
        TypeError,
        "valid UTF-8",
      );
    });

    it("does not accept inherited no-symlink authority", async () => {
      const projectDir = "/inherited-capability-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");
      const inherited = Object.create({ symlinkSemantics: "none" }) as typeof adapter.fs;
      for (const key of Reflect.ownKeys(adapter.fs)) {
        if (key === "symlinkSemantics" || key === "readFileSnapshotWithinLimit") continue;
        const descriptor = Object.getOwnPropertyDescriptor(adapter.fs, key);
        if (descriptor) Object.defineProperty(inherited, key, descriptor);
      }
      adapter.fs = inherited;

      await assertRejects(
        () => bundleBrowserModule(entryPath, { adapter, projectDir }),
        TypeError,
        "stable bounded snapshot reader",
      );
    });

    it("rejects attempts to raise production graph ceilings", async () => {
      const projectDir = "/raised-limit-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");

      await assertRejects(
        async () =>
          await bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            limits: { maxDependencies: 1_001 },
          }),
        RangeError,
        "cannot exceed",
      );
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
      const adapters = Array.from({ length: 11 }, createAdapter);
      const twoStarted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let calls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: async () => {
          calls += 1;
          if (calls === 2) twoStarted.resolve();
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
        };
        const admitted = adapters.slice(0, 10).map((adapter, index) =>
          bundleBrowserModuleWithMetadata(entryPath, {
            ...common,
            adapter,
            singleflightKey: `admitted-${index}`,
          })
        );
        admitted.forEach((promise) => void promise.catch(() => undefined));
        await twoStarted.promise;
        const rejected = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(entryPath, {
              ...common,
              adapter: adapters[10]!,
              singleflightKey: "rejected",
            }),
          BrowserModuleBundleError,
        );
        assertEquals((rejected as BrowserModuleBundleError).kind, "capacity");
        assertEquals(calls, 2);

        release.resolve();
        await Promise.all(admitted);
        assertEquals(calls, 10);
      } finally {
        release.resolve();
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("bounds aggregate bundle work across project identities", async () => {
      const release = Promise.withResolvers<void>();
      const eightStarted = Promise.withResolvers<void>();
      let active = 0;
      let maximumActive = 0;
      let calls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: async () => {
          calls += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          if (active === 8) eightStarted.resolve();
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
        const admitted = Array.from({ length: 40 }, (_, index) => {
          const projectDir = `/global-capacity-${index}`;
          const entryPath = `${projectDir}/app/Counter.ts`;
          const adapter = createMockAdapter();
          adapter.fs.files.set(entryPath, "export default 1;");
          return bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            projectId: `global-capacity-${index}`,
            importMapJson: "{}",
            singleflightKey: `global-capacity-${index}`,
          });
        });
        admitted.forEach((promise) => void promise.catch(() => undefined));
        await eightStarted.promise;

        const overflowProjectDir = "/global-capacity-overflow";
        const overflowEntryPath = `${overflowProjectDir}/app/Counter.ts`;
        const overflowAdapter = createMockAdapter();
        overflowAdapter.fs.files.set(overflowEntryPath, "export default 1;");
        const rejected = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(overflowEntryPath, {
              adapter: overflowAdapter,
              projectDir: overflowProjectDir,
              projectId: "global-capacity-overflow",
              importMapJson: "{}",
              singleflightKey: "global-capacity-overflow",
            }),
          BrowserModuleBundleError,
        );
        assertEquals((rejected as BrowserModuleBundleError).kind, "capacity");
        assertEquals(maximumActive, 8);

        release.resolve();
        await Promise.all(admitted);
        assertEquals(calls, 40);
        assertEquals(maximumActive, 8);
      } finally {
        release.resolve();
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("defers requested snapshot metadata I/O until project admission is held", async () => {
      const projectDir = "/snapshot-admission-project";
      const packagePath = `${projectDir}/package.json`;
      const dependencies = { react: "19.2.4" };
      const requestedCacheKey = `on:${hashString(JSON.stringify(Object.entries(dependencies)))}`;
      const adapter = createMockAdapter();
      const entryPaths = ["One", "Two", "Three"].map(
        (name) => `${projectDir}/app/${name}.ts`,
      );
      for (const entryPath of entryPaths) {
        adapter.fs.files.set(entryPath, "export default 1;");
      }
      adapter.fs.files.set(packagePath, JSON.stringify({ dependencies }));
      const snapshotRead = adapter.fs.readFileSnapshotWithinLimit!;
      const stat = adapter.fs.stat;
      let packageReads = 0;
      let packageStats = 0;
      adapter.fs.readFileSnapshotWithinLimit = (path, root, limit) => {
        if (path === packagePath) packageReads += 1;
        return snapshotRead(path, root, limit);
      };
      adapter.fs.stat = (path) => {
        if (path === packagePath) packageStats += 1;
        return stat(path);
      };

      const release = Promise.withResolvers<void>();
      const twoStarted = Promise.withResolvers<void>();
      let buildCalls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      register<Bundler>("Bundler", {
        bundle: async () => {
          buildCalls += 1;
          if (buildCalls === 2) twoStarted.resolve();
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
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();

      try {
        const occupying = entryPaths.slice(0, 2).map((entryPath, index) =>
          bundleBrowserModuleWithMetadata(entryPath, {
            adapter,
            projectDir,
            projectId: "snapshot-admission-project",
            dependencyPinningCacheKey: "off",
            importMapJson: "{}",
            singleflightKey: `occupying-${index}`,
          })
        );
        occupying.forEach((promise) => void promise.catch(() => undefined));
        await twoStarted.promise;

        const queued = bundleBrowserModuleWithMetadata(entryPaths[2]!, {
          adapter,
          projectDir,
          projectId: "snapshot-admission-project",
          requestedDependencyPinningCacheKey: requestedCacheKey,
          dependencyPinningSource: {
            projectDir,
            fs: adapter.fs,
            cacheNamespace: "snapshot-admission-project",
          },
          singleflightKey: "queued-snapshot",
        });
        void queued.catch(() => undefined);
        await Promise.resolve();
        await Promise.resolve();

        assertEquals(packageStats, 0);
        assertEquals(packageReads, 0);

        release.resolve();
        await Promise.all([...occupying, queued]);
        assertEquals(packageStats, 1);
        assertEquals(packageReads, 1);
      } finally {
        release.resolve();
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
        if (previous) register("Bundler", previous);
        else unregister("Bundler");
      }
    });

    it("counts project-lane waiters against the isolate-wide queue ceiling", async () => {
      const release = Promise.withResolvers<void>();
      const eightStarted = Promise.withResolvers<void>();
      let calls = 0;
      const previous = tryResolve<Bundler>("Bundler");
      register<Bundler>("Bundler", {
        bundle: async () => {
          calls += 1;
          if (calls === 8) eightStarted.resolve();
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
        const admitted = Array.from(
          { length: 4 },
          (_, projectIndex) =>
            Array.from({ length: 10 }, (_, operationIndex) => {
              const projectDir = `/nested-global-capacity-${projectIndex}`;
              const entryPath = `${projectDir}/app/Counter.ts`;
              const adapter = createMockAdapter();
              adapter.fs.files.set(entryPath, "export default 1;");
              return bundleBrowserModuleWithMetadata(entryPath, {
                adapter,
                projectDir,
                projectId: `nested-global-capacity-${projectIndex}`,
                importMapJson: "{}",
                singleflightKey: `operation-${operationIndex}`,
              });
            }),
        ).flat();
        admitted.forEach((promise) => void promise.catch(() => undefined));
        await eightStarted.promise;

        const overflowProjectDir = "/nested-global-capacity-overflow";
        const overflowEntryPath = `${overflowProjectDir}/app/Counter.ts`;
        const overflowAdapter = createMockAdapter();
        overflowAdapter.fs.files.set(overflowEntryPath, "export default 1;");
        const rejected = await assertRejects(
          () =>
            bundleBrowserModuleWithMetadata(overflowEntryPath, {
              adapter: overflowAdapter,
              projectDir: overflowProjectDir,
              projectId: "nested-global-capacity-overflow",
              importMapJson: "{}",
              singleflightKey: "overflow",
            }),
          BrowserModuleBundleError,
        );
        assertEquals((rejected as BrowserModuleBundleError).kind, "capacity");
        assertEquals(calls, 8);

        release.resolve();
        await Promise.all(admitted);
        assertEquals(calls, 40);
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

    it("cancels a bounded requested-snapshot metadata read without releasing its permit early", async () => {
      const projectDir = "/cancelled-snapshot-project";
      const entryPath = `${projectDir}/app/Counter.ts`;
      const packagePath = `${projectDir}/package.json`;
      const dependencies = { react: "19.2.4" };
      const adapter = createMockAdapter();
      adapter.fs.files.set(entryPath, "export default 1;");
      adapter.fs.files.set(packagePath, JSON.stringify({ dependencies }));
      const snapshotRead = adapter.fs.readFileSnapshotWithinLimit!;
      const metadataStarted = Promise.withResolvers<void>();
      const releaseMetadata = Promise.withResolvers<void>();
      adapter.fs.readFileSnapshotWithinLimit = async (path, root, limit) => {
        if (path === packagePath) {
          metadataStarted.resolve();
          await releaseMetadata.promise;
        }
        return await snapshotRead(path, root, limit);
      };
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();

      try {
        const controller = new AbortController();
        const bundling = bundleBrowserModuleWithMetadata(entryPath, {
          adapter,
          projectDir,
          projectId: "cancelled-snapshot-project",
          requestedDependencyPinningCacheKey: `on:${
            hashString(JSON.stringify(Object.entries(dependencies)))
          }`,
          dependencyPinningSource: {
            projectDir,
            fs: adapter.fs,
            cacheNamespace: "cancelled-snapshot-project",
          },
          signal: controller.signal,
        });
        await metadataStarted.promise;
        controller.abort(new DOMException("metadata cancelled", "AbortError"));
        await assertRejects(() => bundling, DOMException, "metadata cancelled");

        releaseMetadata.resolve();
        const next = await bundleBrowserModuleWithMetadata(entryPath, {
          adapter,
          projectDir,
          projectId: "cancelled-snapshot-project",
          requestedDependencyPinningCacheKey: `on:${
            hashString(JSON.stringify(Object.entries(dependencies)))
          }`,
          dependencyPinningSource: {
            projectDir,
            fs: adapter.fs,
            cacheNamespace: "cancelled-snapshot-project-next",
          },
        });
        assertEquals(next.dependencyPinningCacheKey?.startsWith("on:"), true);
      } finally {
        releaseMetadata.resolve();
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
        clearReactVersionCache();
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
