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
import {
  EMBEDDED_NPM_CONSTRAINTS,
  EMBEDDED_NPM_PACKAGES,
} from "#veryfront/discovery/embedded-npm-packages.generated.ts";
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
/**
 * The lockfile a project that installed these declarations from the public
 * registry would hold. Discovery inlines a dependency only against this
 * evidence, so every fixture that expects an inline carries one, exactly as a
 * real project does; a fixture that states its own overrides this.
 */
function publicRegistryLock(dependencies: Record<string, string>, registry?: string): string {
  const host = registry ?? "https://registry.npmjs.org/";
  const packages: Record<string, { version: string; resolved: string }> = {};
  for (const [name, range] of Object.entries(dependencies)) {
    const version = range.replace(/^[\^~>=<v\s]+/, "");
    packages[`node_modules/${name}`] = {
      version,
      resolved: `${host}${name}/-/${name.replace(/^@[^/]+\//, "")}-${version}.tgz`,
    };
  }
  return JSON.stringify({ lockfileVersion: 3, packages });
}

/** The declarations a fixture's package.json states, for the lockfile above. */
function declaredDependencies(packageJsonText: string | undefined): Record<string, string> {
  if (packageJsonText === undefined) return {};
  try {
    const parsed = JSON.parse(packageJsonText) as { dependencies?: Record<string, string> };
    return parsed.dependencies ?? {};
  } catch {
    return {};
  }
}

function createMockAdapter(
  input: Record<string, string>,
  options: { projectDir?: string } = {},
): FileSystemAdapter {
  const files: Record<string, string> = "package.json" in input && !("package-lock.json" in input)
    ? {
      ...input,
      "package-lock.json": publicRegistryLock(declaredDependencies(input["package.json"])),
    }
    : input;
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
      const zodVersion = EMBEDDED_NPM_CONSTRAINTS["zod"]?.find((candidate) =>
        /^\d+\.\d+\.\d+$/.test(candidate)
      );
      assert(zodVersion, "the framework's own lock records zod at an exact version");
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
                `import { z } from "https://esm.sh/zod@${zodVersion}/es2022/zod.mjs";`,
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

    it("refuses a framework version the runtime cannot serve the dependency", async () => {
      // The full profile CARRIES zod 3.25.76 transitively but records no
      // constraint that resolves it, so keeping the bare specifier emitted
      // `npm:zod`, whose recorded `*` is the framework's own zod 4 -- a
      // different major, handed to a dependency that asked for 3.
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

      const error = await assertRejects(
        () =>
          withMockFetch(
            () =>
              Promise.resolve(
                new Response(
                  [
                    `import { z } from "https://esm.sh/zod@3.25.76/es2022/zod.mjs";`,
                    `export const schemaKind = typeof z.object;`,
                  ].join("\n"),
                  { headers: { "content-type": "application/javascript" } },
                ),
              ),
            () => importModule(`file://${projectDir}/${toolPath}`, context),
          ),
        Error,
      );
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      const detail = String((error as { detail?: string }).detail ?? "");
      assertEquals(detail.includes("zod@3.25.76"), true, detail);
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

    it("fetches the locked version for a declaration that names none", async () => {
      // `*` names no version, but the lockfile says which one is installed.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "*" },
          }),
          "package-lock.json": publicRegistryLock({ "@veryfront-fixture/pdf-text": "1.9.0" }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
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
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );

      assertEquals(mod.default.text, "pdf text");
      assertEquals(
        requested.some((url) => url.includes("@veryfront-fixture/pdf-text@1.9.0")),
        true,
        requested.join(", "),
      );
    });

    it("fetches the version the lockfile resolved for a ranged declaration", async () => {
      // `npm install` writes a caret range and the lock moves ahead of its
      // lower bound, so the locked version is the one the project installed.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "^1.8.1" },
          }),
          "package-lock.json": publicRegistryLock({ "@veryfront-fixture/pdf-text": "1.9.0" }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
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
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );

      assertEquals(mod.default.text, "pdf text");
      assertEquals(
        requested.some((url) => url.includes("@veryfront-fixture/pdf-text@1.9.0")),
        true,
        requested.join(", "),
      );
    });

    it("finds the lockfile a workspace keeps at its root", async () => {
      // An npm workspace holds one lockfile at the root while each member has
      // its own package.json, so stopping at the member would report every
      // dependency as unvouched for.
      const member = `${projectDir}/packages/app`;
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
          "packages/app/package.json": JSON.stringify({ dependencies: pin }),
          "package-lock.json": publicRegistryLock(pin),
          "packages/app/tool.ts": [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: member,
        compiledRuntime: true,
      };

      const mod = await withMockFetch(
        () =>
          Promise.resolve(
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          ),
        () =>
          importModule(`file://${member}/tool.ts`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );

      assertEquals(mod.default.text, "pdf text");
    });

    it("refuses an ancestor lockfile that does not own the project", async () => {
      // A project nested under an unrelated one is not a member of it, so that
      // project's lockfile says nothing about this project's dependencies.
      const nested = `${projectDir}/vendor/nested`;
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ name: "outer", dependencies: pin }),
          "package-lock.json": publicRegistryLock(pin),
          "vendor/nested/package.json": JSON.stringify({ dependencies: pin }),
          "vendor/nested/tool.ts": [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: nested,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      const error = await assertRejects(
        () =>
          withMockFetch(
            (input) => {
              requested.push(String(input));
              return Promise.resolve(new Response("export function extractText() {}"));
            },
            () => importModule(`file://${nested}/tool.ts`, context),
          ),
        Error,
      );
      assertEquals(requested, [], "nothing may be fetched");
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
    });

    it("honours the workspace root npmrc and a member's own lock entry", async () => {
      const member = `${projectDir}/packages/app`;
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      // The root redirects the scope, so the public copy is not this
      // project's dependency even though the lock still names it publicly.
      const redirected: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
          ".npmrc": "@veryfront-fixture:registry=https://npm.internal.example/\n",
          "package-lock.json": publicRegistryLock(pin),
          "packages/app/package.json": JSON.stringify({ dependencies: pin }),
          "packages/app/tool.ts": [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: member,
        compiledRuntime: true,
      };

      const requested: string[] = [];
      await assertRejects(
        () =>
          withMockFetch(
            (input) => {
              requested.push(String(input));
              return Promise.resolve(new Response("export function extractText() {}"));
            },
            () => importModule(`file://${member}/tool.ts`, redirected),
          ),
        Error,
      );
      assertEquals(requested, [], "the root .npmrc redirects the scope");

      // The member installs its own version beside the hoisted one.
      const memberLock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/@veryfront-fixture/pdf-text": {
            version: "1.0.0",
            resolved: "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.0.0.tgz",
          },
          "packages/app/node_modules/@veryfront-fixture/pdf-text": {
            version: "1.8.1",
            resolved: "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
          },
        },
      });
      const scoped: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
          "package-lock.json": memberLock,
          "packages/app/package.json": JSON.stringify({ dependencies: pin }),
          "packages/app/tool.ts": [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: member,
        compiledRuntime: true,
      };

      const fetched: string[] = [];
      const mod = await withMockFetch(
        (input) => {
          fetched.push(String(input));
          return Promise.resolve(
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${member}/tool.ts`, scoped) as Promise<
            { default: Record<string, unknown> }
          >,
      );
      assertEquals(mod.default.text, "pdf text");
      assertEquals(
        fetched.some((url) => url.includes("pdf-text@1.8.1")),
        true,
        fetched.join(", "),
      );
    });

    it("refuses to inline a dependency the project's own sources do not vouch for", async () => {
      // esm.sh serves the PUBLIC package of a name. A project that installs
      // that name from somewhere else holds a different package, and running
      // the public one would run a stranger's code in the project's runtime.
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      const source = [
        `import { extractText } from "@veryfront-fixture/pdf-text";`,
        `export default { name: "extract", text: extractText() };`,
      ].join("\n");
      const cases = [
        {
          name: "a lockfile resolving another registry",
          files: {
            "package-lock.json": publicRegistryLock(pin, "https://npm.internal.example/"),
          },
          reason: "resolves @veryfront-fixture/pdf-text from another registry",
        },
        {
          name: "no lockfile at all",
          files: { "package-lock.json": "" },
          reason: "does not resolve @veryfront-fixture/pdf-text",
        },
        {
          // The declaration is exact here, so 2.0.0 is not a version it admits.
          name: "a lockfile resolving a version the declaration excludes",
          files: {
            "package-lock.json": publicRegistryLock({ "@veryfront-fixture/pdf-text": "2.0.0" }),
          },
          reason: "resolves a version of @veryfront-fixture/pdf-text that the project",
        },
        {
          // npm ignores package-lock.json entirely when a shrinkwrap exists.
          name: "a shrinkwrap resolving another registry beside a public package lock",
          files: {
            "npm-shrinkwrap.json": publicRegistryLock(pin, "https://npm.internal.example/"),
          },
          reason: "resolves @veryfront-fixture/pdf-text from another registry",
        },
        {
          // The repo's own precedence: a pnpm lock owns the project, so a
          // stale npm lock says nothing about where the package comes from.
          name: "a pnpm lockfile beside a public package lock",
          files: { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" },
          reason: "pnpm",
        },
        {
          name: "an .npmrc pointing the scope elsewhere",
          files: { ".npmrc": "@veryfront-fixture:registry=https://npm.internal.example/\n" },
          reason: ".npmrc installs @veryfront-fixture/pdf-text from another registry",
        },
      ];

      for (const { name, files, reason } of cases) {
        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter({
            "package.json": JSON.stringify({ dependencies: pin }),
            [toolPath]: source,
            ...files,
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
                return Promise.resolve(new Response("export function extractText() {}"));
              },
              () => importModule(`file://${projectDir}/${toolPath}`, context),
            ),
          Error,
          undefined,
          name,
        );
        assertEquals(requested, [], `${name}: nothing may be fetched`);
        assertEquals((error as { slug?: string }).slug, "dependency-missing", name);
        const detail = String((error as { detail?: string }).detail ?? "");
        assertEquals(detail.includes(reason), true, `${name}: ${detail}`);
      }
    });

    /**
     * Run the fixture and report what the bundler fetched. Every case below
     * imports the same package from the same tool, and differs only in the
     * provenance the project's own files carry.
     */
    async function runFixture(
      files: Record<string, string>,
      { at = projectDir, entry = "tool.ts" }: { at?: string; entry?: string } = {},
    ): Promise<{ text: unknown; requested: string[] }> {
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: at,
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
          importModule(`file://${at}/${entry}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );
      return { text: mod.default.text, requested };
    }

    /** The same run, for a fixture whose provenance must refuse the inline. */
    async function refuseFixture(
      files: Record<string, string>,
      { at = projectDir, entry = "tool.ts" }: { at?: string; entry?: string } = {},
    ): Promise<string> {
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter(files, { projectDir }),
        baseDir: at,
        compiledRuntime: true,
      };
      const requested: string[] = [];
      const error = await assertRejects(
        () =>
          withMockFetch(
            (input) => {
              requested.push(String(input));
              return Promise.resolve(new Response("export function extractText() {}"));
            },
            () => importModule(`file://${at}/${entry}`, context),
          ),
        Error,
      );
      assertEquals(requested, [], "nothing may be fetched");
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      return String((error as { detail?: string }).detail ?? "");
    }

    const fixturePin = { "@veryfront-fixture/pdf-text": "1.8.1" };
    const fixtureSource = [
      `import { extractText } from "@veryfront-fixture/pdf-text";`,
      `export default { name: "extract", text: extractText() };`,
    ].join("\n");

    it("inlines from the hierarchical lockfile npm 5 and 6 wrote", async () => {
      // A `lockfileVersion: 1` file keys its entries under `dependencies`.
      // Reading only `packages` left the table empty, so a project that still
      // carries one had every dependency refused as unresolved.
      const { text, requested } = await runFixture({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        "package-lock.json": JSON.stringify({
          lockfileVersion: 1,
          dependencies: {
            "@veryfront-fixture/pdf-text": {
              version: "1.8.1",
              resolved:
                "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
            },
          },
        }),
        "tool.ts": fixtureSource,
      });
      assertEquals(text, "pdf text");
      assertEquals(requested.length, 1);
    });

    it("reads provenance from the .npmrc when the lockfile omits resolved URLs", async () => {
      // npm's `omit-lockfile-registry-resolved` writes registry entries with
      // no `resolved` at all, so the effective registry is the only record of
      // where they came from -- and it has to name the public one outright.
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/@veryfront-fixture/pdf-text": { version: "1.8.1", integrity: "sha512-x" },
        },
      });
      const files = (npmrc: string) => ({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        "package-lock.json": lock,
        ".npmrc": npmrc,
        "tool.ts": fixtureSource,
      });

      const { text } = await runFixture(
        files("omit-lockfile-registry-resolved=true\nregistry=https://registry.npmjs.org/\n"),
      );
      assertEquals(text, "pdf text");

      // The setting alone says nothing about which registry that was.
      assertEquals(
        (await refuseFixture(files("omit-lockfile-registry-resolved=true\n")))
          .includes("resolves @veryfront-fixture/pdf-text from another registry"),
        true,
      );
      // Nor does a public registry without the setting: an entry that simply
      // lost its URL is not one npm deliberately wrote without one.
      assertEquals(
        (await refuseFixture(files("registry=https://registry.npmjs.org/\n")))
          .includes("resolves @veryfront-fixture/pdf-text from another registry"),
        true,
      );
    });

    it("reads a resolved value written relative to the registry", async () => {
      // npm documents `resolved` as a path relative to the configured
      // registry, so the .npmrc is what says which registry that is.
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "node_modules/@veryfront-fixture/pdf-text": {
            version: "1.8.1",
            resolved: "registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
          },
        },
      });
      const files = (npmrc?: string) => ({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        "package-lock.json": lock,
        ...(npmrc === undefined ? {} : { ".npmrc": npmrc }),
        "tool.ts": fixtureSource,
      });

      const { text } = await runFixture(files('registry="https://registry.npmjs.org/"\n'));
      assertEquals(text, "pdf text");
      assertEquals(
        (await refuseFixture(files())).includes(
          "resolves @veryfront-fixture/pdf-text from another registry",
        ),
        true,
      );
    });

    it("matches every workspace pattern npm accepts", async () => {
      const member = `${projectDir}/packages/app`;
      const files = (workspaces: unknown) => ({
        "package.json": JSON.stringify({ name: "root", workspaces }),
        "package-lock.json": publicRegistryLock(fixturePin),
        "packages/app/package.json": JSON.stringify({ dependencies: fixturePin }),
        "packages/app/tool.ts": fixtureSource,
      });

      for (
        const workspaces of [
          ["./packages/*"],
          ["packages/**"],
          ["**"],
          ["packages/*/"],
          { packages: ["packages/*", "!packages/other"] },
        ]
      ) {
        const { text } = await runFixture(files(workspaces), { at: member });
        assertEquals(text, "pdf text", JSON.stringify(workspaces));
      }

      // A negated pattern removes the member again, and the root's lockfile
      // then says nothing about it.
      await refuseFixture(files(["packages/*", "!packages/app"]), { at: member });
      // So does a pattern that matches one segment where the member has two.
      await refuseFixture(files(["*"]), { at: member });
    });

    it("prefers the workspace root's lockfile over a stale one in the member", async () => {
      // A member that kept its package-lock.json from before it joined a pnpm
      // workspace must not outrank the root's authoritative lockfile: the
      // public entry in the leftover is not what pnpm installed.
      const member = `${projectDir}/packages/app`;
      const detail = await refuseFixture({
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
        "packages/app/package.json": JSON.stringify({ dependencies: fixturePin }),
        "packages/app/package-lock.json": publicRegistryLock(fixturePin),
        "packages/app/tool.ts": fixtureSource,
      }, { at: member });
      assertEquals(detail.includes("pnpm"), true, detail);
    });

    it("never lets a member's .npmrc vouch over the workspace root's", async () => {
      // npm reports that it ignores a member's own workspace config, so a
      // scoped public registry there may not override the root's private one
      // -- doing so authorized the public package of a private dependency.
      const member = `${projectDir}/packages/app`;
      const detail = await refuseFixture({
        "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
        ".npmrc": "registry=https://npm.internal.example/\n",
        "package-lock.json": publicRegistryLock(fixturePin),
        "packages/app/package.json": JSON.stringify({ dependencies: fixturePin }),
        "packages/app/.npmrc": "@veryfront-fixture:registry=https://registry.npmjs.org/\n",
        "packages/app/tool.ts": fixtureSource,
      }, { at: member });
      assertEquals(detail.includes("another registry"), true, detail);
    });

    it("pins the CDN build to the transitive versions the project locked", async () => {
      // esm.sh resolves the package's own dependency ranges itself. Left to
      // it, the build carries whatever the public registry answers with at
      // that moment rather than what the project installed.
      const { text, requested } = await runFixture({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/@veryfront-fixture/pdf-text": {
              version: "1.8.1",
              resolved:
                "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
              dependencies: { "@veryfront-fixture/glyphs": "^2.0.0" },
            },
            "node_modules/@veryfront-fixture/glyphs": {
              version: "2.3.4",
              resolved: "https://registry.npmjs.org/@veryfront-fixture/glyphs/-/glyphs-2.3.4.tgz",
            },
          },
        }),
        "tool.ts": fixtureSource,
      });
      assertEquals(text, "pdf text");
      const pinnedDeps = requested.map((url) => new URL(url).searchParams.get("deps"));
      assertEquals(
        pinnedDeps.includes("@veryfront-fixture/glyphs@2.3.4"),
        true,
        requested.join(", "),
      );
    });

    it("refuses a lockfile entry that links a workspace package", async () => {
      // npm writes a link's target path in the same `resolved` field it uses
      // for the registry-relative form, so a project whose .npmrc names the
      // public registry would otherwise read that path as public provenance.
      const detail = await refuseFixture({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        ".npmrc": "registry=https://registry.npmjs.org/\n",
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/@veryfront-fixture/pdf-text": {
              resolved: "packages/pdf-text",
              link: true,
              version: "1.8.1",
            },
          },
        }),
        "tool.ts": fixtureSource,
      });
      assertEquals(
        detail.includes("resolves @veryfront-fixture/pdf-text from another registry"),
        true,
        detail,
      );
    });

    it("keeps the transitive pins out of an unreachable CDN URL", async () => {
      // The query the pins go in is project text too: a transitive version's
      // pre-release part is free-form and must not reach the classified
      // detail or the logs through the failing URL.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: fixturePin }),
          "package-lock.json": JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "node_modules/@veryfront-fixture/pdf-text": {
                version: "1.8.1",
                resolved:
                  "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
                dependencies: { "@veryfront-fixture/glyphs": "^2.0.0" },
              },
              "node_modules/@veryfront-fixture/glyphs": {
                version: "2.3.4-ghpEXAMPLETOKEN0123",
                resolved: "https://registry.npmjs.org/@veryfront-fixture/glyphs/-/glyphs-2.3.4.tgz",
              },
            },
          }),
          "tool.ts": fixtureSource,
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
            () => importModule(`file://${projectDir}/tool.ts`, context),
          ),
        Error,
      );
      assertEquals(
        requested.some((url) => url.includes("ghpEXAMPLETOKEN0123")),
        true,
        requested.join(", "),
      );
      const detail = String((error as { detail?: string }).detail ?? "");
      assertEquals(detail.includes("ghpEXAMPLETOKEN0123"), false, detail);
      assertEquals(detail.includes("@veryfront-fixture/pdf-text@1.8.1?..."), true, detail);
    });

    it("refuses a package whose transitive dependency the project resolves privately", async () => {
      // The CDN would serve the PUBLIC package of that transitive name, which
      // is not the one this project installed.
      const detail = await refuseFixture({
        "package.json": JSON.stringify({ dependencies: fixturePin }),
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "node_modules/@veryfront-fixture/pdf-text": {
              version: "1.8.1",
              resolved:
                "https://registry.npmjs.org/@veryfront-fixture/pdf-text/-/pdf-text-1.8.1.tgz",
              dependencies: { "@veryfront-fixture/glyphs": "^2.0.0" },
            },
            "node_modules/@veryfront-fixture/glyphs": {
              version: "2.3.4",
              resolved: "https://npm.internal.example/@veryfront-fixture/glyphs/-/glyphs-2.3.4.tgz",
            },
          },
        }),
        "tool.ts": fixtureSource,
      });
      assertEquals(
        detail.includes("resolves @veryfront-fixture/glyphs, which @veryfront-fixture/pdf-text"),
        true,
        detail,
      );
    });

    it("inlines when an .npmrc names the public registry explicitly", async () => {
      const pin = { "@veryfront-fixture/pdf-text": "1.8.1" };
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: pin }),
          ".npmrc": "registry=https://registry.npmjs.org\n; a comment\n",
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract", text: extractText() };`,
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
            new Response(`export function extractText() { return "pdf text"; }`, {
              headers: { "content-type": "application/javascript" },
            }),
          );
        },
        () =>
          importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
            { default: Record<string, unknown> }
          >,
      );

      assertEquals(mod.default.text, "pdf text");
      assertEquals(requested.length, 1);
    });

    it("classifies a top-level require.resolve nothing can serve", async () => {
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: {} }),
          [toolPath]: [
            `const where = require.resolve("@veryfront-fixture/never-declared");`,
            `export default { name: "probe", where };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () => importModule(`file://${projectDir}/${toolPath}`, context),
        Error,
      );
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      const detail = String((error as { detail?: string }).detail ?? "");
      // esbuild leaves the probe as `__require.resolve`, so the failure is at
      // call time; what it must not be is an unclassified TypeError.
      assertEquals(detail.includes("require.resolve"), true, detail);
      assertEquals(detail.includes("is not a function"), false, detail);
    });

    it("classifies a top-level require nothing can serve", async () => {
      // esbuild reports a module-scope `require()` with the same kind as a
      // lazy one, so the deferred module runs at import time. Its failure is
      // the project's missing dependency, not an unclassified crash.
      const context: FileDiscoveryContext = {
        platform: "node",
        fsAdapter: createMockAdapter({
          "package.json": JSON.stringify({ dependencies: {} }),
          [toolPath]: [
            `const mod = require("@veryfront-fixture/never-declared");`,
            `export default { name: "top-level", value: mod.value };`,
          ].join("\n"),
        }, { projectDir }),
        baseDir: projectDir,
        compiledRuntime: true,
      };

      const error = await assertRejects(
        () => importModule(`file://${projectDir}/${toolPath}`, context),
        Error,
      );
      assertEquals((error as { slug?: string }).slug, "dependency-missing");
      const detail = String((error as { detail?: string }).detail ?? "");
      assertEquals(detail.includes("@veryfront-fixture/never-declared"), true, detail);
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
