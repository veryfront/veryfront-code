import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileDiscoveryContext } from "#veryfront/discovery/types.ts";
import {
  clearTranspileCache,
  fetchProjectDependencySource,
  importModule as importModuleRaw,
} from "#veryfront/discovery/transpiler.ts";
import { EMBEDDED_NPM_PACKAGES } from "#veryfront/discovery/embedded-npm-packages.generated.ts";
import { isFrameworkProvidedPackage } from "#veryfront/discovery/project-npm-imports.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

/**
 * How a managed project agent's npm dependencies reach a compiled runtime.
 *
 * These live outside the colocated unit boundary because each one drives the
 * real bundler against a fake CDN transport: the thing under test is what the
 * bundler fetches, or refuses to fetch, not a pure function over specifiers
 * (that is src/discovery/project-npm-imports.test.ts).
 *
 * Refs veryfront/veryfront-issue-inbox#1440.
 */

function importModule(file: string, context: FileDiscoveryContext) {
  return importModuleRaw(file, {
    ...context,
    allowHostProjectCodeExecution: true,
  });
}

/**
 * A JavaScript string literal for `value`, for the module sources these tests
 * generate.
 *
 * `JSON.stringify` is not one: JSON and JavaScript disagree about which
 * characters may appear raw inside a quoted string -- U+2028 and U+2029 are
 * legal in JSON and terminate a line in JavaScript source -- so its output can
 * be a well-formed JSON string and a malformed JavaScript literal at once
 * (CodeQL js/bad-code-sanitization). Escaping everything outside printable
 * ASCII removes the disagreement: whatever the value holds, the literal built
 * here parses as that exact string.
 */
function jsStringLiteral(value: string): string {
  let literal = '"';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    const printable = code >= 0x20 && code <= 0x7e && char !== '"' && char !== "\\";
    literal += printable ? char : `\\u{${code.toString(16)}}`;
  }
  return `${literal}"`;
}

/**
 * An in-memory FileSystemAdapter, as in src/discovery/transpiler.test.ts.
 *
 * `projectDir` converts absolute paths back to project-relative keys, mirroring
 * the real veryfront adapter's PathNormalizer: hosted runs address the VFS with
 * relative paths while the transpiler resolves imports against the process cwd.
 */
function createMockAdapter(
  files: Record<string, string>,
  options: { projectDir?: string } = {},
): FileSystemAdapter {
  const normalize = (path: string): string => {
    const { projectDir } = options;
    if (projectDir && path.startsWith(projectDir)) {
      return path.slice(projectDir.length).replace(/^\/+/, "");
    }
    return path;
  };
  return {
    async readFile(path: string): Promise<string> {
      const content = files[normalize(path)];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async exists(path: string): Promise<boolean> {
      return normalize(path) in files;
    },
    async *readDir(path: string) {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const seen = new Set<string>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const name = rest.split("/")[0]!;
        if (seen.has(name)) continue;
        seen.add(name);
        const isFile = !rest.includes("/");
        yield { name, isFile, isDirectory: !isFile, isSymlink: false };
      }
    },
    async stat(path: string) {
      const isFile = path in files;
      return {
        size: isFile ? files[path]!.length : 0,
        isFile,
        isDirectory: !isFile,
        isSymlink: false,
        mtime: new Date(),
      };
    },
    async writeFile() {},
    async mkdir() {},
    async remove() {},
    async makeTempDir() {
      return "/tmp/mock";
    },
    watch() {
      return null as never;
    },
  } satisfies FileSystemAdapter;
}

describe(
  "discovery npm dependency loading",
  () => {
    afterEach(() => {
      clearTranspileCache();
    });

    afterAll(async () => {
      await stopEsbuild();
    });

    // Hosted discovery bundles from a VFS while esbuild still resolves bare
    // specifiers against a real directory, so these fixtures live under an
    // existing repo path the way a deployed project's files do.
    const projectDir = Deno.cwd();
    const toolPath = "src/discovery/__fixtures__/extract-pdf-text.ts";

    it("loads a project-declared npm dependency on a compiled runtime", async () => {
      // A compiled binary's npm package set is frozen at build time from the
      // framework's own lock, so an `npm:` specifier for a project dependency
      // fails with "Could not find constraint '<pkg>@<version>'". The declared
      // pin must be inlined from its CDN source at bundle time instead.
      const files: Record<string, string> = {
        "package.json": JSON.stringify({
          dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
        }),
        [toolPath]: [
          `import { extractText } from "@veryfront-fixture/pdf-text";`,
          `export default { name: "extract-pdf-text", run: () => extractText() };`,
        ].join("\n"),
      };

      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: { name: string; run: () => string } }
          >,
      );

      assertEquals(mod.default.name, "extract-pdf-text");
      assertEquals(mod.default.run(), "pdf text");
      assertEquals(
        requested.some((url) => url.startsWith("https://esm.sh/@veryfront-fixture/pdf-text@1.8.1")),
        true,
        `expected a pinned esm.sh fetch, got ${JSON.stringify(requested)}`,
      );
    });

    it("leaves bare npm imports alone when the runtime is not compiled", async () => {
      // A plain `deno run` resolves `npm:` specifiers natively against the
      // project's node_modules, so nothing is fetched from the CDN there.
      const files: Record<string, string> = {
        "package.json": JSON.stringify({
          dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
        }),
        [toolPath]: `export default { name: "noop" };`,
      };

      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: projectDir,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(new Response("export {}"));
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: { name: string } }
          >,
      );

      assertEquals(mod.default.name, "noop");
      assertEquals(requested, []);
    });

    it("never redirects framework-provided packages to the CDN", async () => {
      // A project that pins `zod` still shares the framework's instance: the
      // registries compare schemas against it, so a second copy from a CDN
      // would break discovery rather than fix a dependency.
      const files: Record<string, string> = {
        "package.json": JSON.stringify({ dependencies: { zod: "3.25.76" } }),
        [toolPath]: [
          `import { z } from "zod";`,
          `export default { name: "schema", shape: typeof z.object };`,
        ].join("\n"),
      };

      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(new Response("export {}"));
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: { name: string; shape: string } }
          >,
      );

      assertEquals(mod.default.name, "schema");
      assertEquals(mod.default.shape, "function");
      assertEquals(requested, []);
    });

    /**
     * Bundle one tool file for a compiled runtime and report what the bundler
     * fetched, so a test can state both what the module does and whether the
     * CDN was involved at all.
     */
    async function bundleTool(
      path: string,
      source: string,
      dependencies: Record<string, string>,
    ): Promise<{ mod: { default: Record<string, unknown> }; requested: string[] }> {
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(
          { "package.json": JSON.stringify({ dependencies }), [path]: source },
          { projectDir },
        ),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${path}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );
      return { mod, requested };
    }

    it("loads a dependency imported with an explicit npm: specifier from a handler body", async () => {
      // The production failure (run run_91a507e6): a deferred
      // `await import("npm:unpdf@1.8.1")` inside a tool's handler. Nothing
      // resolves it at discovery time, so a design that waits for the runtime
      // to refuse never gets a turn -- and the `npm:` form does not match the
      // pin key `unpdf` unless the specifier is parsed rather than split on
      // the first path separator. The package has to be inlined here or never.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/deferred-pdf-text.ts",
        [
          `export default {`,
          `  name: "extract-pdf-text",`,
          `  run: async () => {`,
          `    const mod = await import("npm:@veryfront-fixture/pdf-text@1.8.1");`,
          `    return mod.extractText();`,
          `  },`,
          `};`,
        ].join("\n"),
        { "@veryfront-fixture/pdf-text": "1.8.1" },
      );

      assertEquals(
        requested,
        // `?target=es2022` is the HTTP plugin's own normalisation of an esm.sh URL.
        ["https://esm.sh/@veryfront-fixture/pdf-text@1.8.1?target=es2022"],
        "the deferred import must be inlined from the pinned CDN source at bundle time",
      );
      const run = mod.default.run as () => Promise<string>;
      assertEquals(await run(), "pdf text");
    });

    it("inlines a declared dependency under every specifier form", async () => {
      // Fixture package names, so the case can never turn on whether a real
      // package happens to be in the framework's lock or a local cache.
      // `?target=es2022` is the HTTP plugin's own normalisation of an esm.sh URL.
      const plain = "https://esm.sh/veryfront-fixture-pdf-text@1.8.1?target=es2022";
      const plainCore = "https://esm.sh/veryfront-fixture-pdf-text@1.8.1/dist/core?target=es2022";
      const scoped = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1?target=es2022";
      const forms: Array<{ specifier: string; url: string }> = [
        { specifier: "veryfront-fixture-pdf-text", url: plain },
        { specifier: "veryfront-fixture-pdf-text/dist/core", url: plainCore },
        { specifier: "npm:veryfront-fixture-pdf-text", url: plain },
        { specifier: "npm:veryfront-fixture-pdf-text@1.8.1", url: plain },
        { specifier: "npm:veryfront-fixture-pdf-text@1.8.1/dist/core", url: plainCore },
        { specifier: "@veryfront-fixture/pdf-text", url: scoped },
        { specifier: "npm:@veryfront-fixture/pdf-text@1.8.1", url: scoped },
      ];

      for (const { specifier, url } of forms) {
        clearTranspileCache();
        const { mod, requested } = await bundleTool(
          "src/discovery/__fixtures__/specifier-forms.ts",
          [
            `import { extractText } from ${jsStringLiteral(specifier)};`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
          { "veryfront-fixture-pdf-text": "1.8.1", "@veryfront-fixture/pdf-text": "1.8.1" },
        );

        assertEquals(mod.default.text, "pdf text", `import ${specifier} did not resolve`);
        assertEquals(requested, [url], `import ${specifier} fetched the wrong source`);
      }
    });

    it("keeps a dependency the runtime already embeds off the CDN", async () => {
      // `deno compile` freezes the framework's whole lock into the binary, so
      // this one already resolves offline. Fetching a second copy would cost a
      // network round trip and break the identity comparisons the schema and
      // element registries make against the framework's own objects.
      //
      // `playwright` is the fixture because the framework embeds it at two
      // versions at once, which is the case a name-only membership test cannot
      // decide, and because both the bare and the pinned specifier are already
      // in deno.lock -- so leaving them external, which is the whole point,
      // cannot make this test rewrite the lock it is asserting about.
      const name = "playwright";
      const versions = EMBEDDED_NPM_PACKAGES[name];
      assert(
        versions !== undefined && versions.length > 0 && !isFrameworkProvidedPackage(name),
        `${name} must still be a non-framework package the runtime embeds`,
      );
      const version = versions[versions.length - 1]!;

      // Deferred, so the case turns on what the bundler decided rather than on
      // what this test process happens to have cached.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/embedded-dependency.ts",
        [
          `export default {`,
          `  name: "uses-embedded",`,
          `  loadBare: () => import(${jsStringLiteral(name)}),`,
          `  loadPinned: () => import(${jsStringLiteral(`npm:${name}@${version}`)}),`,
          `};`,
        ].join("\n"),
        { [name]: version },
      );

      assertEquals(mod.default.name, "uses-embedded");
      assertEquals(
        requested,
        [],
        `${name}@${version} is embedded in the runtime and must not be fetched`,
      );
    });

    it("classifies an unreachable pinned source instead of leaking build text", async () => {
      // esbuild rejects the build rather than returning its diagnostics, so
      // the `result.errors` guard alone never fires and a 404 for a mistyped
      // pin escaped as raw `Build failed with 1 error` -- the unclassified
      // surface #1440 asked to stop showing.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/absent": "9.9.9" },
          }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/absent";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () =>
          withMockFetch(
            () => Promise.resolve(new Response("Not Found", { status: 404 })),
            () => importModule(`file://${projectDir}/${toolPath}`, context),
          ),
        Error,
        "https://esm.sh/@veryfront-fixture/absent@9.9.9",
      );
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
    });

    it("keeps a package subpath out of an unreachable CDN URL", async () => {
      // A subpath segment is free-form project text, like a version qualifier.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/absent": "9.9.9" },
          }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/absent/ghpEXAMPLETOKEN0123/deep";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const error = await assertRejects(
        () =>
          withMockFetch(
            (input) => {
              requested.push(String(input));
              return Promise.resolve(new Response("Not Found", { status: 404 }));
            },
            () => importModule(`file://${projectDir}/${toolPath}`, context),
          ),
        Error,
      );
      assertEquals(
        requested.some((url) => url.includes("ghpEXAMPLETOKEN0123/deep")),
        true,
        requested.join(", "),
      );
      const detail = String((error as { detail?: string }).detail ?? error.message);
      assertEquals(detail.includes("ghpEXAMPLETOKEN0123"), false, detail);
      assertEquals(detail.includes("@veryfront-fixture/absent@9.9.9/..."), true, detail);
    });

    it("keeps semver identifiers out of an unreachable CDN URL", async () => {
      // A pre-release part is free-form text, so the URL of a failed fetch
      // must not carry it into the classified detail or the logs.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/absent": "9.9.9-AKIAIOSFODNN7EXAMPLE" },
          }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/absent";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const error = await assertRejects(
        () =>
          withMockFetch(
            (input) => {
              requested.push(String(input));
              return Promise.resolve(new Response("Not Found", { status: 404 }));
            },
            () => importModule(`file://${projectDir}/${toolPath}`, context),
          ),
        Error,
      );
      // The request itself still uses the declared version.
      assertEquals(
        requested.some((url) => url.includes("9.9.9-AKIAIOSFODNN7EXAMPLE")),
        true,
        requested.join(", "),
      );
      const detail = String((error as { detail?: string }).detail ?? error.message);
      assertEquals(detail.includes("AKIAIOSFODNN7EXAMPLE"), false, detail);
      assertEquals(detail.includes("@veryfront-fixture/absent@9.9.9"), true, detail);
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
    });

    it("refuses an import whose version contradicts the declared pin", async () => {
      // Inlining the pin here would silently run 1.8.1 for an import that
      // asked for 2.0.0, which is the failure this whole path exists to stop.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: { unpdf: "1.8.1" } }),
          [toolPath]: [
            `import { extractText } from "npm:unpdf@2.0.0";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () =>
          withMockFetch(
            () => Promise.resolve(new Response("export {}")),
            () => importModule(`file://${projectDir}/${toolPath}`, context),
          ),
        Error,
        "the import asks for unpdf@2.0.0 but package.json declares unpdf@1.8.1",
      );
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
    });

    it("inlines the caret range npm install writes by default", async () => {
      // `npm install unpdf` writes `"unpdf": "^1.8.1"`, so this is the shape a
      // real project's package.json has. Exact-equality matching discarded the
      // declaration and aborted discovery for the whole file.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/caret-range.ts",
        [
          `import { extractText } from "@veryfront-fixture/pdf-text";`,
          `export default { name: "extract", text: extractText() };`,
        ].join("\n"),
        { "@veryfront-fixture/pdf-text": "^1.8.1" },
      );

      assertEquals(mod.default.text, "pdf text");
      assertEquals(
        requested,
        ["https://esm.sh/@veryfront-fixture/pdf-text@1.8.1?target=es2022"],
        "a caret range must inline the version it names",
      );
    });

    it("keeps framework packages external when a CDN-inlined dependency imports them", async () => {
      // The inlined source is fetched, so its own `zod` import arrives in the
      // http-url namespace, past the bare-specifier resolver. Without the
      // namespace guard esbuild inlines a SECOND zod, and the schema registry
      // compares a discovered tool's schemas against the framework's instance.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
          }),
          [toolPath]: [
            `import { schemaKind } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", kind: schemaKind };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(
            new Response(
              [
                // Exactly what esm.sh emits for a transitive framework import.
                `import { z } from "https://esm.sh/zod@3.25.76/es2022/zod.mjs";`,
                `export const schemaKind = typeof z.object;`,
              ].join("\n"),
              { headers: { "content-type": "application/javascript" } },
            ),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: { kind: string } }
          >,
      );

      assertEquals(mod.default.kind, "function");
      assertEquals(
        requested.some((url) => url.includes("/zod@")),
        false,
        `zod must stay external, got ${JSON.stringify(requested)}`,
      );
    });

    it("keeps the framework subpath when it externalizes a CDN framework import", async () => {
      // esm.sh compiles JSX against `react/jsx-runtime`, so an inlined
      // dependency that renders anything imports the SUBPATH, not the package
      // root. Handing the http-url guard's match back as the bare package name
      // rewrote that to `react` -- which exports no `jsx` and no `jsxs` -- and
      // the module threw the moment it loaded, in any project whose declared
      // dependency reaches JSX.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
          }),
          [toolPath]: [
            `import { renderLabel } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", label: renderLabel() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(
            new Response(
              [
                // Exactly what esm.sh emits for a dependency built with JSX.
                `import { jsx } from "https://esm.sh/react@19.2.4/es2022/jsx-runtime.mjs";`,
                `export function renderLabel() { return jsx("span", { children: "pdf text" }); }`,
              ].join("\n"),
              { headers: { "content-type": "application/javascript" } },
            ),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: { label: { type: string; props: { children: string } } } }
          >,
      );

      // The element only exists if `jsx` was a real function, which it is only
      // when the externalized specifier kept the `/jsx-runtime` subpath.
      assertEquals(mod.default.label.type, "span");
      assertEquals(mod.default.label.props.children, "pdf text");
      assertEquals(
        requested.some((url) => url.includes("/react@")),
        false,
        `react must stay external, got ${JSON.stringify(requested)}`,
      );
    });

    it("names a missing dependency's file without disclosing the machine path", async () => {
      // Local filesystem discovery resolves the `file://` entry to an absolute
      // path, so putting it straight into DEPENDENCY_MISSING detail published
      // the user's home directory and the machine's filesystem layout --
      // AGENTS.md's secret and internal-detail safety rules forbid both in
      // user-facing output. The file still has to be named to be actionable.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: {} }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/never-declared";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () => importModule(`file://${projectDir}/${toolPath}`, context),
        Error,
        "@veryfront-fixture/never-declared",
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      assert(
        message.includes(toolPath),
        `the detail must name the file project-relative, got ${message}`,
      );
      assert(
        !message.includes(projectDir),
        "the detail must not disclose the absolute project path",
      );
    });

    it("keeps bare Node builtins external instead of failing the file", async () => {
      // `import { Buffer } from "buffer"` reaches the same resolver as a
      // project dependency. Classifying it as a missing npm package failed
      // every compiled discovery run and told the user to declare `buffer` in
      // package.json, which is advice that cannot work.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/node-builtins.ts",
        [
          `import { Buffer } from "buffer";`,
          `import { createHash } from "crypto";`,
          `import { join } from "path/posix";`,
          `export default {`,
          `  name: "uses-builtins",`,
          `  ok: typeof Buffer === "function" && typeof createHash === "function" &&`,
          `      typeof join === "function",`,
          `};`,
        ].join("\n"),
        {},
      );

      assertEquals(mod.default.ok, true);
      assertEquals(requested, []);
    });

    it("keeps the rest of a file discoverable when a deferred import cannot resolve", async () => {
      // A deferred `import()` inside a handler body is the project's own lazy
      // path, often optional and behind a try/catch. Aborting the bundle would
      // delete every unrelated export of the file from discovery; the failure
      // belongs at call time, where it was before.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/optional-deferred.ts",
        [
          `export default {`,
          `  name: "mostly-works",`,
          `  ready: true,`,
          `  optional: async () => {`,
          `    try {`,
          `      const mod = await import("@veryfront-fixture/never-declared");`,
          `      return mod.value;`,
          `    } catch {`,
          `      return "fallback";`,
          `    }`,
          `  },`,
          `};`,
        ].join("\n"),
        {},
      );

      assertEquals(mod.default.name, "mostly-works");
      assertEquals(mod.default.ready, true);
      assertEquals(requested, [], "an undeclared package must never be fetched");
      const optional = mod.default.optional as () => Promise<string>;
      assertEquals(await optional(), "fallback");
    });

    it("bundles a CDN dependency whose module imports a relative chunk", async () => {
      // esm.sh splits a package across files, and hosted discovery runs with an
      // fsAdapter whose resolver also claims `./...` specifiers. A relative
      // import reached from fetched CDN source belongs to the HTTP plugin.
      const path = "src/discovery/__fixtures__/multi-file-dependency.ts";
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(
          {
            "package.json": JSON.stringify({
              dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
            }),
            [path]: [
              `import { extractText } from "@veryfront-fixture/pdf-text";`,
              `export default { name: "multi-file", text: extractText() };`,
            ].join("\n"),
          },
          { projectDir },
        ),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          const url = String(input);
          requested.push(url);
          const body = url.includes("chunk.mjs")
            ? `export function extractText() { return "pdf text"; }`
            : `export { extractText } from "./chunk.mjs";`;
          return Promise.resolve(
            new Response(body, { headers: { "content-type": "application/javascript" } }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${path}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );

      assertEquals(mod.default.text, "pdf text");
      assertEquals(requested.length, 2, "the package module and its chunk are both fetched");
      assertEquals(requested[1]?.includes("chunk.mjs"), true, requested.join(", "));
    });

    it("keeps the rest of a file discoverable when a lazy require cannot resolve", async () => {
      // `require()` inside a handler is the CommonJS form of the same optional,
      // deferred load, so it must not abort the bundle either.
      const { mod, requested } = await bundleTool(
        "src/discovery/__fixtures__/optional-require.ts",
        [
          `export default {`,
          `  name: "mostly-works",`,
          `  optional: () => {`,
          `    try {`,
          `      return require("@veryfront-fixture/never-declared").value;`,
          `    } catch {`,
          `      return "fallback";`,
          `    }`,
          `  },`,
          `};`,
        ].join("\n"),
        {},
      );

      assertEquals(mod.default.name, "mostly-works");
      assertEquals(requested, [], "an undeclared package must never be fetched");
      const optional = mod.default.optional as () => string;
      assertEquals(optional(), "fallback");
    });

    it("serves a pinned dependency source once per process", async () => {
      // Discovery re-bundles per file and per source generation, and a pinned
      // CDN URL is immutable, so a second module declaring the same pin must not
      // pay for the fetch again. Without the cache this costs one extra egress
      // round trip per file and per transitive chunk on a shared hosted runtime.
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      const source = (name: string) =>
        [
          `import { extractText } from "@veryfront-fixture/pdf-text";`,
          `export default { name: ${jsStringLiteral(name)}, text: extractText() };`,
        ].join("\n");

      const first = await bundleTool(
        "src/discovery/__fixtures__/cached-dependency-first.ts",
        source("first"),
        pin,
      );
      const second = await bundleTool(
        "src/discovery/__fixtures__/cached-dependency-second.ts",
        source("second"),
        pin,
      );

      assertEquals(first.mod.default.name, "first");
      assertEquals(second.mod.default.name, "second");
      assertEquals(
        first.requested.length + second.requested.length,
        1,
        "the second module must reuse the first module's fetched source",
      );
    });

    it("denies an origin outside the pinned CDN before any request leaves", async () => {
      // The specifier a project declares decides the URL, so this allow-list is
      // the boundary that stops a declared dependency addressing an arbitrary
      // host -- including link-local metadata -- through the discovery bundler.
      const requested: string[] = [];
      await withMockFetch(
        (input) => {
          requested.push(String(input));
          return Promise.resolve(new Response("export {}"));
        },
        async () => {
          await assertRejects(
            () => fetchProjectDependencySource("https://attacker.example.com/payload.js"),
            Error,
          );
          await assertRejects(
            () => fetchProjectDependencySource("http://169.254.169.254/latest/meta-data/"),
            Error,
          );
        },
      );

      assertEquals(requested, [], "a blocked origin must not reach the transport");
    });

    it("classifies a syntax error in project code instead of leaking build text", async () => {
      // The bundler wrapper rethrows esbuild's rejection, whose own message is
      // just `Build failed with 1 error:`. Handing that back unwrapped gave
      // the user no slug and no file path.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: {} }),
          [toolPath]: `export default { name: "broken", `,
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () => importModule(`file://${projectDir}/${toolPath}`, context),
        Error,
        "Failed to transpile",
      );
      const message = error instanceof Error ? error.message : String(error);
      assertEquals((error as { slug?: string }).slug, "compilation-error");
      assert(
        message.includes("extract-pdf-text.ts"),
        `the classified error must name the file, got ${message}`,
      );
    });
  },
);
