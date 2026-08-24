import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  getCurrentRequestContext,
  runWithRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
  getProjectDependenciesSync,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  createBareExternalPlugin,
  createHttpExternalPlugin,
  createRelativeFsPlugin,
} from "./esbuild-plugins.ts";
import type { LockfileManager } from "#veryfront/utils/import-lockfile.ts";
import * as esbuild from "veryfront/extensions/bundler";
import type {
  OnLoadArgs,
  OnResolveArgs,
  PluginBuild,
  ResolveResult,
} from "veryfront/extensions/bundler";

function createMockBuild(
  onLoad: PluginBuild["onLoad"],
): PluginBuild {
  const resolveResult: ResolveResult = {
    errors: [],
    warnings: [],
    path: "",
    external: false,
    sideEffects: false,
    namespace: "",
    pluginData: null,
  };

  return {
    initialOptions: {},
    resolve: () => Promise.resolve(resolveResult),
    onStart: () => {},
    onEnd: () => {},
    onResolve: () => {},
    onLoad,
    onDispose: () => {},
    esbuild,
  } as unknown as PluginBuild;
}

async function resolveWithBareExternalPlugin(
  path: string,
  importer: string,
  projectDir: string,
  serverExternalPackages: readonly string[],
  kind: OnResolveArgs["kind"] = "import-statement",
): Promise<string> {
  let resolveHandler: ((args: OnResolveArgs) => unknown) | undefined;
  const plugin = createBareExternalPlugin({ projectDir, serverExternalPackages });
  const build = createMockBuild(() => {});
  build.onResolve = (_options, handler) => {
    resolveHandler = handler;
  };
  plugin.setup(build);
  assertExists(resolveHandler);

  const result = await resolveHandler({
    path,
    importer,
    namespace: "file",
    resolveDir: projectDir,
    kind,
    pluginData: undefined,
  }) as { errors?: Array<{ text: string }> };

  assertExists(result.errors?.[0]);
  return result.errors[0].text;
}

async function runHttpExternalResolver(
  path: string,
  importer: string,
  projectDir: string,
  serverExternalPackages: readonly string[],
  kind: OnResolveArgs["kind"],
): Promise<{ errors?: Array<{ text: string }> } | undefined> {
  let resolveHandler: ((args: OnResolveArgs) => unknown) | undefined;
  const plugin = createHttpExternalPlugin({ projectDir, serverExternalPackages });
  const build = createMockBuild(() => {});
  build.onResolve = (_options, handler) => {
    resolveHandler = handler;
  };
  plugin.setup(build);
  assertExists(resolveHandler);

  return await resolveHandler({
    path,
    importer,
    namespace: "file",
    resolveDir: projectDir,
    kind,
    pluginData: undefined,
  }) as { errors?: Array<{ text: string }> } | undefined;
}

async function resolveWithHttpExternalPlugin(
  path: string,
  importer: string,
  projectDir: string,
  serverExternalPackages: readonly string[],
  kind: OnResolveArgs["kind"],
): Promise<string> {
  const result = await runHttpExternalResolver(
    path,
    importer,
    projectDir,
    serverExternalPackages,
    kind,
  );

  assertExists(result?.errors?.[0]);
  return result.errors[0].text;
}

function writableDependencySource(
  cacheNamespace: string,
  dependencies: Readonly<Record<string, string>>,
): DependencyPinningSource {
  const content = JSON.stringify({ dependencies });
  return {
    projectDir: "/project",
    cacheNamespace,
    dependencyWritebackTarget: { kind: "main" },
    fs: {
      readFile: () => Promise.resolve(content),
      stat: () =>
        Promise.resolve({
          size: content.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(1_000),
        }),
    },
  };
}

async function bundleWithPlugin(
  contents: string,
  importMapImports: Record<string, string>,
  serverExternalPackages?: readonly string[],
): Promise<string> {
  const { build } = await import("veryfront/extensions/bundler");
  const result = await build({
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2020",
    stdin: {
      contents,
      loader: "js",
      sourcefile: "/project/app/page.js",
      resolveDir: "/project/app",
    },
    plugins: [
      createBareExternalPlugin({ importMapImports, serverExternalPackages }),
      createHttpExternalPlugin({ serverExternalPackages }),
    ],
  });

  return result.outputFiles?.[0]?.text ?? "";
}

describe(
  "server/handlers/dev/files/esbuild-plugins",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    it("keeps exact import-map specifiers when values are empty sentinels", async () => {
      const output = await bundleWithPlugin(
        'import React from "react"; console.log(React);',
        { react: "" },
      );

      assertEquals(output.includes('from "react"'), true);
      assertEquals(output.includes("esm.sh/react"), false);
    });

    it("keeps explicit https imports external for browser execution", async () => {
      const output = await bundleWithPlugin(
        'import React from "https://esm.sh/react@19"; console.log(React);',
        {},
      );

      assertEquals(output.includes('from "https://esm.sh/react@19"'), true);
    });

    it("serves fetched https modules when lockfile flush hits a read-only filesystem", async () => {
      const originalFetch = globalThis.fetch;
      const moduleSource = "export const ok = true;";
      const entries = new Map<string, {
        resolved: string;
        integrity: string;
        fetchedAt?: string;
      }>();
      let lockfileSets = 0;
      let lockfileFlushes = 0;
      let loadHandler: ((args: OnLoadArgs) => unknown) | undefined;

      const readOnlyLockfile: LockfileManager = {
        read: () => Promise.resolve(null),
        write: () => Promise.reject(new Error("read-only lockfile")),
        get: (url) => Promise.resolve(entries.get(url) ?? null),
        set: (url, entry) => {
          lockfileSets += 1;
          entries.set(url, entry);
          return Promise.resolve();
        },
        has: () => Promise.resolve(false),
        clear: () => Promise.resolve(),
        flush: () => {
          lockfileFlushes += 1;
          return Promise.reject(
            new Error(
              "Read-only file system (os error 30): writefile '/app/project/veryfront.lock'",
            ),
          );
        },
      };

      const plugin = createBareExternalPlugin({
        bundle: true,
        lockfile: readOnlyLockfile,
      });
      plugin.setup(createMockBuild((_opts, fn) => {
        loadHandler = fn;
      }));
      assertExists(loadHandler);

      try {
        globalThis.fetch = (async () =>
          new Response(moduleSource, {
            status: 200,
          })) as typeof fetch;

        const result = await loadHandler({
          path: "https://esm.sh/yaml@2/stringify",
          namespace: "https",
          pluginData: undefined,
          suffix: "",
        });

        assertEquals((result as { contents?: string }).contents, moduleSource);
        assertEquals((result as { errors?: Array<{ text: string }> }).errors, undefined);
        assertEquals(lockfileSets, 1);
        assertEquals(lockfileFlushes, 1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("fails closed on a node: builtin import in a browser bundle", async () => {
      // A server-only `node:*` import must never be silently rewritten to
      // https://esm.sh/node:crypto (which 404s on esm.sh and throws
      // `createHash is not a function` in the browser). The browser bundle must
      // fail closed with a clear, actionable error instead.
      const error = await assertRejects(() =>
        bundleWithPlugin(
          'import { createHash } from "node:crypto"; console.log(createHash);',
          {},
        )
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals(message.includes("node:crypto"), true);
    });

    it("still rewrites ordinary npm bare imports (the node: guard does not over-reject)", async () => {
      const output = await bundleWithPlugin(
        'import x from "lodash"; console.log(x);',
        {},
      );

      assertEquals(output.includes("esm.sh/lodash"), true);
    });

    it("fails loud when a declared server external reaches a browser bundle", async () => {
      const cases = [
        ["knex", 'import knex from "knex"; console.log(knex);'],
        ["knex", 'export const load = () => import("knex");'],
        ["knex", 'const knex = require("knex"); console.log(knex);'],
        [
          "knex",
          'const knex = require("https://esm.sh/knex@3.1.0"); console.log(knex);',
        ],
        [
          "npm:@prisma/client",
          'import prisma from "npm:@prisma/client"; console.log(prisma);',
        ],
        [
          "npm:@prisma/client/runtime/library",
          'export const load = () => import("npm:@prisma/client/runtime/library");',
        ],
        [
          "@prisma/client/runtime/library",
          'import prisma from "@prisma/client/runtime/library"; console.log(prisma);',
        ],
      ] as const;

      for (const [specifier, source] of cases) {
        const error = await assertRejects(() =>
          bundleWithPlugin(source, {}, ["knex", "@prisma/client"])
        );
        const message = error instanceof Error ? error.message : String(error);
        assertEquals(message.includes(specifier), true);
        assertEquals(message.includes("build.serverExternalPackages"), true);
        assertEquals(message.includes("server-only-in-client"), true);
      }
    });

    it("reports a project-relative importer for declared server externals", async () => {
      const projectDir = "/redacted-project-root";
      const message = await resolveWithBareExternalPlugin(
        "knex",
        `${projectDir}/app/page.js`,
        projectDir,
        ["knex"],
      );

      assertEquals(message.includes("app/page.js"), true);
      assertEquals(message.includes(projectDir), false);
    });

    it("rejects declared server externals loaded through CommonJS", async () => {
      const message = await resolveWithBareExternalPlugin(
        "zod",
        "/redacted-project-root/app/page.js",
        "/redacted-project-root",
        ["zod"],
        "require-call",
      );

      assertEquals(message.includes("server-only-in-client"), true);
      assertEquals(message.includes("zod"), true);
    });

    it("rejects delivered declared HTTP externals for CommonJS resolve kinds", async () => {
      for (const kind of ["require-call", "require-resolve"] as const) {
        const message = await resolveWithHttpExternalPlugin(
          "https://esm.sh/knex@3.1.0",
          "/redacted-project-root/app/page.js",
          "/redacted-project-root",
          ["knex"],
          kind,
        );
        assertEquals(message.includes("server-only-in-client"), true);
        assertEquals(message.includes("knex"), true);
      }
    });

    it("preserves undeclared CommonJS URL resolver behavior", async () => {
      for (const kind of ["require-call", "require-resolve"] as const) {
        assertEquals(
          await runHttpExternalResolver(
            "https://esm.sh/lodash@4.17.21",
            "/redacted-project-root/app/page.js",
            "/redacted-project-root",
            ["knex"],
            kind,
          ),
          undefined,
        );
      }
    });

    it("does not let an import map bypass a declared server external", async () => {
      const error = await assertRejects(() =>
        bundleWithPlugin(
          'import knex from "knex"; console.log(knex);',
          { knex: "https://cdn.example/knex.js" },
          ["knex"],
        )
      );

      assertEquals(String(error).includes("build.serverExternalPackages"), true);

      const scopedNpmError = await assertRejects(() =>
        bundleWithPlugin(
          'import prisma from "npm:@prisma/client/runtime/library"; console.log(prisma);',
          { "npm:@prisma/client/runtime/library": "https://cdn.example/prisma.js" },
          ["@prisma/client"],
        )
      );
      assertEquals(String(scopedNpmError).includes("server-only-in-client"), true);
    });

    it("keeps undeclared packages browser-compatible when declarations exist", async () => {
      const output = await bundleWithPlugin(
        'import x from "lodash"; console.log(x);',
        {},
        ["knex"],
      );

      assertEquals(output.includes("esm.sh/lodash"), true);
    });
  },
);

// VULN-FS-6: createRelativeFsPlugin must reject every relative or absolute
// import that, after joining with the importer's directory, escapes the
// project root. esbuild calls onResolve per-import; without containment the
// adapter would happily fetch /etc/hostname or any other host file.
describe(
  "createRelativeFsPlugin (VULN-FS-6) - path containment",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    async function bundleEntry(
      contents: string,
      projectDir: string,
      adapter = createMockAdapter(),
    ): Promise<{ errors: ReadonlyArray<{ text: string }>; output: string }> {
      const { build } = await import("veryfront/extensions/bundler");
      try {
        const result = await build({
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2020",
          stdin: {
            contents,
            loader: "js",
            sourcefile: `${projectDir}/app/page.js`,
            resolveDir: `${projectDir}/app`,
          },
          plugins: [createRelativeFsPlugin(projectDir, adapter)],
        });
        return {
          errors: [],
          output: result.outputFiles?.[0]?.text ?? "",
        };
      } catch (e) {
        // esbuild surfaces plugin errors as a thrown BuildFailure.
        const errs = (e as { errors?: ReadonlyArray<{ text: string }> }).errors ?? [
          { text: e instanceof Error ? e.message : String(e) },
        ];
        return { errors: errs, output: "" };
      }
    }

    // [label, import specifier, host file the import would reach, whether the
    // containment check itself must refuse it]. Absolute specifiers are
    // project-relative, so "/etc/hostname" joins to /project/etc/hostname and
    // never escapes; only a genuine traversal must hit the containment error.
    const ESCAPE_IMPORTS: ReadonlyArray<[string, string, string, boolean]> = [
      ["plain ../../../../etc/hostname", "../../../../etc/hostname", "/etc/hostname", true],
      ["plain absolute /etc/hostname", "/etc/hostname", "/etc/hostname", false],
      ["mixed-depth traversal", "../../../etc/passwd", "/etc/passwd", true],
      ["traversal that escapes via /", "/../../etc/hostname", "/etc/hostname", true],
    ];

    for (const [label, importPath, hostPath, escapes] of ESCAPE_IMPORTS) {
      it(`refuses ${label}`, async () => {
        // Seed the host file so containment is the only thing that can refuse it.
        const adapter = createMockAdapter();
        adapter.fs.files.set(hostPath, "export const HOSTLEAK = 1; export default HOSTLEAK;");
        const { errors, output } = await bundleEntry(
          `import x from "${importPath}"; console.log(x);`,
          "/project",
          adapter,
        );
        assertEquals(
          output.includes("HOSTLEAK"),
          false,
          `${label}: a host file must never be inlined into the bundle`,
        );
        assertEquals(errors.length > 0, true, `${label} was not refused`);
        if (escapes) {
          assertEquals(
            errors.some(({ text }) => text.includes("Import escapes project directory")),
            true,
            `${label} must be refused by the containment check: errors=${JSON.stringify(errors)}`,
          );
        }
      });
    }

    it("refuses NUL byte in import path", async () => {
      const { errors } = await bundleEntry(
        // \0 in the source string will be passed through to onResolve.
        'import x from "./legit\u0000.ts"; console.log(x);',
        "/project",
      );
      assertEquals(
        errors.some(({ text }) => text.includes("NUL byte")),
        true,
        "the plugin must reject the NUL byte itself, not merely fail to resolve",
      );
    });

    it("treats a percent-encoded segment as a literal path segment (no decode)", async () => {
      // %2e%2e is NOT decoded by esbuild plugins, so it must be treated as a
      // literal directory name under /project/app rather than as "..".
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/app/%2e%2e/x.ts", "export const q = 7;");
      const { errors, output } = await bundleEntry(
        'import { q } from "./%2e%2e/x.ts"; console.log(q);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(
        output.includes("7"),
        true,
        "%2e%2e must be treated as a literal path segment, never decoded",
      );
    });

    it("refuses a literal traversal that reaches a seeded host file", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/etc/hostname", "export const HOSTLEAK = 1; export default HOSTLEAK;");
      const { errors, output } = await bundleEntry(
        'import x from "../../etc/hostname"; console.log(x);',
        "/project",
        adapter,
      );
      assertEquals(output.includes("HOSTLEAK"), false, "a host file must never be inlined");
      assertEquals(errors.length > 0, true, "the traversal must be refused");
      assertEquals(
        errors.some(({ text }) => text.includes("Import escapes project directory")),
        true,
        `the traversal must be refused by the containment check: errors=${JSON.stringify(errors)}`,
      );
    });

    it("positive: legitimate relative import inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/app/util.ts", "export const x = 42;");
      const { errors, output } = await bundleEntry(
        'import { x } from "./util.ts"; console.log(x);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("42"), true);
    });

    it("positive: absolute import inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/lib/helper.ts", "export const y = 99;");
      const { errors, output } = await bundleEntry(
        'import { y } from "/lib/helper.ts"; console.log(y);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("99"), true);
    });

    it("positive: unicode (NFC) filename inside the project resolves", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/project/app/caf\u00E9.ts", "export const z = 1;");
      const { errors, output } = await bundleEntry(
        'import { z } from "./caf\u00E9.ts"; console.log(z);',
        "/project",
        adapter,
      );
      assertEquals(errors.length, 0, `unexpected errors: ${JSON.stringify(errors)}`);
      assertEquals(output.includes("z = 1") || output.includes("var z"), true);
    });
  },
);

describe(
  "createBareExternalPlugin \u2014 schedules background resolution when pinning is enabled and cache is cold",
  () => {
    let originalFetch: typeof globalThis.fetch;
    let originalPinningFlag: string | undefined;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    });

    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
      // Drain any in-flight background fetches before moving on.
      await _pendingResolutions();
      _clearNpmVersionCache();
      globalThis.fetch = originalFetch;
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
    });

    it("queues an undeclared bare package for platform resolution", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const dependencyPinningSource = writableDependencySource(
        "esbuild-undeclared-resolution",
        {},
      );
      const snapshot = await getDependencyPinningSnapshot(dependencyPinningSource);
      const requests: Array<{ projectId: string; specifiers: string[] }> = [];
      _setDependencyResolutionPosterForTest((projectId, specifiers) => {
        requests.push({ projectId, specifiers });
        return Promise.resolve();
      });

      const { build } = await import("veryfront/extensions/bundler");
      await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        stdin: {
          contents: 'import x from "lodash"; console.log(x);',
          loader: "js",
          sourcefile: "/project/app/page.js",
          resolveDir: "/project/app",
        },
        // opts.bundle defaults to false: bare imports become { external: true },
        // so esbuild never fetches the esm.sh URL content.
        plugins: [
          createBareExternalPlugin({
            projectDir: "/project",
            projectId: "project-ref",
            dependencyPinningCacheKey: snapshot.cacheKey,
            dependencyPinningDependencies: snapshot.dependencies,
            dependencyPinningSource,
          }),
        ],
      });

      await _pendingResolutions();
      assertEquals(requests, [{
        projectId: "project-ref",
        specifiers: ["lodash"],
      }]);
    });

    it("queues independently declared React and Veryfront imports owned by the import map", async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const dependencyPinningSource = writableDependencySource(
        "esbuild-declared-resolution",
        {
          react: "^19.0.0",
          "react-dom": "next",
          veryfront: "~0.1.1150",
        },
      );
      const snapshot = await getDependencyPinningSnapshot(dependencyPinningSource);
      const requests: Array<{ projectId: string; specifiers: string[] }> = [];
      _setDependencyResolutionPosterForTest((projectId, specifiers) => {
        requests.push({ projectId, specifiers });
        return Promise.resolve();
      });

      const { build } = await import("veryfront/extensions/bundler");
      await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        external: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
        ],
        stdin: {
          contents: [
            'import React from "react";',
            'import { createRoot } from "react-dom/client";',
            'import { Head } from "veryfront/head";',
            "console.log(React, createRoot, Head);",
          ].join("\n"),
          loader: "js",
          sourcefile: "/project/app/page.js",
          resolveDir: "/project/app",
        },
        plugins: [
          createBareExternalPlugin({
            projectDir: "/project",
            projectId: "project-ref",
            dependencyPinningCacheKey: snapshot.cacheKey,
            dependencyPinningDependencies: snapshot.dependencies,
            dependencyPinningSource,
            importMapImports: { "veryfront/": "" },
          }),
        ],
      });

      await _pendingResolutions();
      assertEquals(
        requests.flatMap(({ specifiers }) => specifiers).sort(),
        [
          "react-dom@next",
          "react@^19.0.0",
          "veryfront@~0.1.1150",
        ],
      );
    });

    it("does not queue exact import-map-owned dependency pins", async () => {
      const requests: string[] = [];
      _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
        requests.push(...specifiers);
        return Promise.resolve();
      });

      const { build } = await import("veryfront/extensions/bundler");
      await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        stdin: {
          contents: [
            'import React from "react";',
            'import { createRoot } from "react-dom/client";',
            'import { Head } from "veryfront/head";',
            "console.log(React, createRoot, Head);",
          ].join("\n"),
          loader: "js",
          sourcefile: "/project/app/page.js",
          resolveDir: "/project/app",
        },
        plugins: [
          createBareExternalPlugin({
            projectDir: "/project",
            projectId: "project-ref",
            dependencyPinningCacheKey: "on:3iubttgtkrz2l",
            dependencyPinningDependencies: {
              react: "19.1.1",
              "react-dom": "19.1.1",
              veryfront: "v0.1.1150",
            },
            importMapImports: { "veryfront/": "" },
          }),
        ],
      });

      await _pendingResolutions();
      assertEquals(requests, []);
    });
  },
);

describe(
  "createBareExternalPlugin — warms dep cache from real package.json independent of react config",
  () => {
    let tmpDir: string;
    let originalFetch: typeof globalThis.fetch;
    let originalFlag: string | undefined;

    beforeEach(async () => {
      tmpDir = await Deno.makeTempDir({ prefix: "vf-esbuild-pin-" });
      await Deno.writeTextFile(
        `${tmpDir}/package.json`,
        JSON.stringify({ dependencies: { lodash: "4.17.20" } }),
      );
      originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      _clearNpmVersionCache();
      // Mock fetch to prevent real network calls from scheduleNpmVersionResolution.
      originalFetch = globalThis.fetch;
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
    });

    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
      await _pendingResolutions();
      globalThis.fetch = originalFetch;
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      _clearNpmVersionCache();
      await Deno.remove(tmpDir, { recursive: true });
    });

    it("getProjectDependenciesSync is cold before the build and warm after (regression guard for config.react.version path)", async () => {
      // Before the build the cache is cold — simulates what happens when the
      // handler resolved reactVersion from config.react.version and skipped
      // readProjectDependencyVersions.
      assertEquals(getProjectDependenciesSync(tmpDir), undefined);

      const { build } = await import("veryfront/extensions/bundler");
      await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        stdin: {
          contents: 'import x from "lodash"; console.log(x);',
          loader: "js",
          sourcefile: `${tmpDir}/app/page.js`,
          resolveDir: `${tmpDir}/app`,
        },
        plugins: [createBareExternalPlugin({ projectDir: tmpDir })],
      });

      // After the build the warmup promise settled inside onResolve — the
      // package.json dep cache is now warm with the real file contents.
      assertEquals(getProjectDependenciesSync(tmpDir)?.["lodash"], "4.17.20");
    });
  },
);

describe(
  "createRelativeFsPlugin - browser server boundary",
  () => {
    afterEach(async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    });

    async function bundleClientDependency(
      dependencySource: string,
      failDependencyRead = false,
      extension = ".ts",
      symlinkSegment: "directory" | "file" | null = null,
      importSpecifier = `./dependency${extension}`,
    ): Promise<{ errors: ReadonlyArray<{ text: string }>; output: string }> {
      const projectDir = "/project";
      const dependencyPath = `${projectDir}/app/dependency${extension}`;
      const adapter = createMockAdapter();
      adapter.fs.files.set(dependencyPath, dependencySource);

      if (symlinkSegment) {
        const readDir = adapter.fs.readDir;
        adapter.fs.readDir = (path: string) =>
          symlinkSegment === "directory" && path === projectDir
            ? (async function* () {
              yield {
                name: "app",
                isFile: false,
                isDirectory: false,
                isSymlink: true,
              };
            })()
            : symlinkSegment === "file" && path === `${projectDir}/app`
            ? (async function* () {
              yield {
                name: `dependency${extension}`,
                isFile: false,
                isDirectory: false,
                isSymlink: true,
              };
            })()
            : readDir(path);
      }

      if (failDependencyRead) {
        const readFile = adapter.fs.readFile;
        adapter.fs.readFile = (path: string) =>
          path === dependencyPath
            ? Promise.reject(new Error("dependency read unavailable"))
            : readFile(path);
      }

      const { build } = await import("veryfront/extensions/bundler");
      try {
        const result = await build({
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          target: "es2020",
          stdin: {
            contents: [
              '"use client";',
              `import { marker } from "${importSpecifier}";`,
              "console.log(marker);",
            ].join("\n"),
            loader: "js",
            sourcefile: "/app/entry.js",
            resolveDir: `${projectDir}/app`,
          },
          plugins: [
            createRelativeFsPlugin(projectDir, adapter, {
              enforceBrowserBoundaries: true,
            }),
          ],
        });
        return { errors: [], output: result.outputFiles?.[0]?.text ?? "" };
      } catch (error) {
        const errors = (error as { errors?: ReadonlyArray<{ text: string }> }).errors ?? [
          { text: error instanceof Error ? error.message : String(error) },
        ];
        return { errors, output: "" };
      }
    }

    it("rejects a relative dependency with a top-level use-server directive", async () => {
      const marker = "SERVER_DEPENDENCY_MARKER";
      const { errors, output } = await bundleClientDependency(
        `'use server';\nexport const marker = "${marker}";`,
      );

      assertEquals(errors.some(({ text }) => text.includes("declares use server")), true);
      assertEquals(output.includes(marker), false);
    });

    it("rejects use-server dependencies with explicit module-type extensions", async () => {
      for (const extension of [".mts", ".cts", ".mjs", ".cjs"] as const) {
        const marker = `SERVER_${extension.slice(1).toUpperCase()}_DEPENDENCY_MARKER`;
        const { errors, output } = await bundleClientDependency(
          `'use server';\nexport const marker = "${marker}";`,
          false,
          extension,
        );

        assertEquals(errors.some(({ text }) => text.includes("declares use server")), true);
        assertEquals(output.includes(marker), false);
      }
    });

    it("does not treat hybrid CommonJS or ESM JSX suffixes as script modules", async () => {
      for (const extension of [".mtsx", ".ctsx", ".mjsx", ".cjsx"] as const) {
        const marker = `UNSUPPORTED_${extension.slice(1).toUpperCase()}_MARKER`;
        const explicit = await bundleClientDependency(
          `export const marker = "${marker}";`,
          false,
          extension,
        );
        const extensionless = await bundleClientDependency(
          `export const marker = "${marker}";`,
          false,
          extension,
          null,
          "./dependency",
        );

        assertEquals(explicit.errors.length > 0, true);
        assertEquals(explicit.output.includes(marker), false);
        assertEquals(extensionless.errors.length > 0, true);
        assertEquals(extensionless.output.includes(marker), false);
      }
    });

    it("rejects a dependency with conflicting client and server directives", async () => {
      const { errors, output } = await bundleClientDependency(
        `'use client';\n'use server';\nexport const marker = "conflicting";`,
      );

      assertEquals(errors.some(({ text }) => text.includes("conflicting")), true);
      assertEquals(output, "");
    });

    it("rejects a dependency with a function-local server action", async () => {
      const marker = "FUNCTION_LOCAL_SERVER_SECRET_MARKER";
      const { errors, output } = await bundleClientDependency(
        [
          "export async function save() {",
          '  "use server";',
          `  return "${marker}";`,
          "}",
          "export const marker = save;",
        ].join("\n"),
      );

      assertEquals(errors.some(({ text }) => text.includes("function-local use server")), true);
      assertEquals(output.includes(marker), false);
    });

    it("preserves shared dependencies without boundary directives", async () => {
      const marker = "SHARED_DEPENDENCY_MARKER";
      const { errors, output } = await bundleClientDependency(
        `export const marker = "${marker}";`,
      );

      assertEquals(errors, []);
      assertEquals(output.includes(marker), true);
    });

    it("fails closed when a dependency cannot be read", async () => {
      const marker = "UNREADABLE_DEPENDENCY_MARKER";
      const { errors, output } = await bundleClientDependency(
        `export const marker = "${marker}";`,
        true,
      );

      assertEquals(errors.length > 0, true);
      assertEquals(output.includes(marker), false);
    });

    it("rejects relative dependencies with symbolic-link path segments", async () => {
      const marker = "SYMLINKED_DEPENDENCY_MARKER";
      for (const symlinkSegment of ["directory", "file"] as const) {
        const { errors, output } = await bundleClientDependency(
          `export const marker = "${marker}";`,
          false,
          ".ts",
          symlinkSegment,
        );

        assertEquals(errors.some(({ text }) => text.includes("symbolic link")), true);
        assertEquals(output.includes(marker), false);
      }
    });

    it("resolves project files when esbuild callbacks fire outside the request context", async () => {
      const esbuild = await import("veryfront/extensions/bundler");
      // Root the esbuild service's message pump OUTSIDE any request context,
      // as on a warm server pod whose first build served another request.
      // Plugin callbacks of later builds run on this contextless pump, so an
      // AsyncLocalStorage-dependent adapter loses its store unless the plugin
      // re-enters it (the documented contract of wrapWithCurrentContext).
      await esbuild.build({
        bundle: false,
        write: false,
        stdin: { contents: "1;", loader: "js" },
      });

      const files: Record<string, string> = {
        "/project/app/dep.js": "export const value = 42;",
      };
      // Like MultiProjectFSAdapter, refuse to operate without the store.
      const contextBoundAdapter = {
        fs: {
          stat: (path: string) => {
            if (!getCurrentRequestContext()) {
              return Promise.reject(new Error("No request context available"));
            }
            return files[path]
              ? Promise.resolve({ isFile: true, isDirectory: false, isSymlink: false })
              : Promise.reject(new Error("not found"));
          },
          readFile: (path: string) => {
            if (!getCurrentRequestContext()) {
              return Promise.reject(new Error("No request context available"));
            }
            return files[path] !== undefined
              ? Promise.resolve(files[path])
              : Promise.reject(new Error("not found"));
          },
        },
      } as unknown as ReturnType<typeof createMockAdapter>;

      const result = await runWithRequestContext(
        { projectSlug: "esbuild-project", token: "esbuild-token" },
        () =>
          esbuild.build({
            bundle: true,
            write: false,
            format: "esm",
            platform: "browser",
            target: "es2020",
            stdin: {
              contents: 'import { value } from "./dep.js"; console.log(value);',
              loader: "js",
              sourcefile: "/project/app/page.js",
              resolveDir: "/project/app",
            },
            plugins: [createRelativeFsPlugin("/project", contextBoundAdapter)],
          }),
      );

      assertEquals(result.outputFiles?.[0]?.text.includes("42"), true);
    });
  },
);
