/**
 * Discovery transpiler: project npm dependency loading (issue #1440).
 *
 * A managed project agent's tool file may import an npm package the project
 * declares but the runtime cannot resolve: a compiled binary's npm set is
 * frozen at build time from the framework's own lock. These cases drive the
 * real `importModule` path with a stubbed outbound transport, so they live
 * here rather than in the hermetic unit suite.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  clearTranspileCache,
  fetchProjectDependencySource,
  importModule as importModuleRaw,
} from "#veryfront/discovery/transpiler.ts";
import type { VeryfrontError } from "#veryfront/errors";
import type { FileDiscoveryContext } from "#veryfront/discovery/types.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";

function importModule(file: string, context: FileDiscoveryContext) {
  return importModuleRaw(file, {
    ...context,
    allowHostProjectCodeExecution: true,
  });
}

/**
 * Creates a mock FileSystemAdapter backed by an in-memory file map.
 *
 * Absolute paths under `projectDir` are converted back to project-relative
 * keys, mirroring the real veryfront adapter's PathNormalizer: hosted runs
 * address the VFS with relative paths while the transpiler resolves imports
 * against the process cwd.
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

// esbuild starts a child process that lives across tests, so we disable sanitizers
describe(
  "discovery/transpiler project npm dependencies",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterEach(() => {
      clearTranspileCache();
    });

    afterAll(async () => {
      await stopEsbuild();
    });

    describe("importModule with project dependency pins", () => {
      // Hosted discovery bundles from a VFS while esbuild still resolves bare
      // specifiers against a real directory, so these fixtures live under an
      // existing repo path the way a deployed project's files do.
      const projectDir = Deno.cwd();
      const toolPath = "src/discovery/__fixtures__/extract-pdf-text.ts";

      /**
       * A CDN that answers each URL with its own body, the way esm.sh serves an
       * entry module and its versioned sub-chunks. Anything unrouted 404s, which
       * is what a wrong pin or an unpublished package looks like.
       */
      function cdnMock(routes: Record<string, string>) {
        const requested: string[] = [];
        const fetchMock = (input: RequestInfo | URL) => {
          const url = String(input instanceof Request ? input.url : input);
          requested.push(url);
          const body = routes[url.split("?")[0]!];
          if (body === undefined) {
            return Promise.resolve(new Response("Not Found", { status: 404 }));
          }
          return Promise.resolve(
            new Response(body, { headers: { "content-type": "application/javascript" } }),
          );
        };
        return { requested, fetchMock };
      }

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
          requested.some((url) =>
            url.startsWith("https://esm.sh/@veryfront-fixture/pdf-text@1.8.1")
          ),
          true,
          `expected a pinned esm.sh fetch, got ${JSON.stringify(requested)}`,
        );
      });

      it("loads a bare dependency deferred behind a dynamic import", async () => {
        // The shape a heavy parser is usually reached by: the tool file keeps
        // the package out of its module graph and imports it when a request
        // arrives. That import is evaluated long after discovery returned, so
        // the runtime's refusal never comes back here to retry on -- it must
        // be inlined during the bundle instead of waiting.
        const files: Record<string, string> = {
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
          }),
          [toolPath]: [
            `export default {`,
            `  name: "extract-pdf-text",`,
            `  run: async () => {`,
            `    const { extractText } = await import("@veryfront-fixture/pdf-text");`,
            `    return extractText();`,
            `  },`,
            `};`,
          ].join("\n"),
        };

        const entryUrl = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";
        const { requested, fetchMock } = cdnMock({
          [entryUrl]: `export function extractText() { return "pdf text"; }`,
        });

        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter(files, { projectDir }),
          baseDir: projectDir,
          compiledRuntime: true,
        };

        const mod = await withMockFetch(
          fetchMock,
          () =>
            importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
              { default: { name: string; run: () => Promise<string> } }
            >,
        );

        assertEquals(await mod.default.run(), "pdf text");
        assertEquals(
          requested.map((url) => url.split("?")[0]),
          [entryUrl],
        );
      });

      it("loads a versioned npm: dependency imported dynamically on a compiled runtime", async () => {
        // The form a project reaches for once a bare static import fails: a
        // deferred `await import("npm:<pkg>@<version>")`. It names the same
        // declared pin, so it must be inlined from the CDN exactly like the bare
        // specifier -- left alone it reaches the compiled binary's frozen package
        // set and fails with "Could not find constraint '<pkg>@<version>'".
        const files: Record<string, string> = {
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
          }),
          [toolPath]: [
            `export default {`,
            `  name: "extract-pdf-text",`,
            `  run: async () => {`,
            `    const { extractText } = await import("npm:@veryfront-fixture/pdf-text@1.8.1");`,
            `    return extractText();`,
            `  },`,
            `};`,
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
              { default: { name: string; run: () => Promise<string> } }
            >,
        );

        assertEquals(mod.default.name, "extract-pdf-text");
        assertEquals(await mod.default.run(), "pdf text");
        assertEquals(
          requested.some((url) =>
            url.startsWith("https://esm.sh/@veryfront-fixture/pdf-text@1.8.1")
          ),
          true,
          `expected a pinned esm.sh fetch, got ${JSON.stringify(requested)}`,
        );
      });

      it("leaves an uncompiled runtime's npm resolution alone and never reaches the CDN", async () => {
        // A plain `deno run` resolves `npm:` specifiers natively, so an
        // unresolvable package there is a project error to report, not a reason
        // to start fetching dependency source over the network. The import still
        // fails classified rather than as raw runtime text.
        const files: Record<string, string> = {
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/absent": "9.9.9" },
          }),
          [toolPath]: [
            `import { missing } from "@veryfront-fixture/absent";`,
            `export default { name: "absent", run: () => missing() };`,
          ].join("\n"),
        };

        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter(files, { projectDir }),
          baseDir: projectDir,
        };

        const requested: string[] = [];
        const error = await withMockFetch(
          (input) => {
            requested.push(String(input));
            return Promise.resolve(new Response("export {}"));
          },
          () =>
            assertRejects(
              () => importModule(`file://${projectDir}/${toolPath}`, context),
              Error,
              "@veryfront-fixture/absent",
            ),
        );

        assertEquals((error as VeryfrontError).slug, "dependency-missing");
        assertEquals(requested, []);
      });

      it("keeps resolving a pinned package the runtime already provides", async () => {
        // deno.lock freezes hundreds of npm packages into the runtime, and a
        // project is free to declare one of them too. Rerouting those to the CDN
        // would turn an offline, in-runtime resolution into a network fetch of a
        // second copy, so a pin only ever takes effect after the runtime itself
        // refuses the specifier.
        const files: Record<string, string> = {
          "package.json": JSON.stringify({ dependencies: { "brace-expansion": "1.1.11" } }),
          [toolPath]: [
            `import * as braceExpansion from "brace-expansion";`,
            `export default { name: "expand", loaded: typeof braceExpansion };`,
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
            return Promise.resolve(new Response("export default () => []"));
          },
          () =>
            importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
              { default: { name: string; loaded: string } }
            >,
        );

        // The import only completes because the runtime resolved
        // `npm:brace-expansion` itself; an unresolvable specifier throws here.
        assertEquals(mod.default.name, "expand");
        assertEquals(mod.default.loaded, "object");
        assertEquals(
          requested,
          [],
          `a natively resolvable pin must not reach the CDN, got ${JSON.stringify(requested)}`,
        );
      });

      it("inlines a package's transitive chunks and leaves node builtins to the runtime", async () => {
        // A real esm.sh payload is an entry module that re-exports a versioned
        // sub-chunk and reaches for node builtins, not the single self-contained
        // file a one-body mock would serve.
        const files: Record<string, string> = {
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
          }),
          [toolPath]: [
            `import { extractText } from "@veryfront-fixture/pdf-text";`,
            `export default { name: "extract-pdf-text", run: () => extractText() };`,
          ].join("\n"),
        };

        const entryUrl = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";
        const chunkUrl = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1/es2022/pdf-text.mjs";
        const { requested, fetchMock } = cdnMock({
          [entryUrl]:
            `export { extractText } from "/@veryfront-fixture/pdf-text@1.8.1/es2022/pdf-text.mjs";`,
          [chunkUrl]: [
            `import { Buffer } from "node:buffer";`,
            `export function extractText() { return Buffer.from("pdf text").toString("utf8"); }`,
          ].join("\n"),
        });

        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter(files, { projectDir }),
          baseDir: projectDir,
          compiledRuntime: true,
        };

        const mod = await withMockFetch(
          fetchMock,
          () =>
            importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
              { default: { name: string; run: () => string } }
            >,
        );

        assertEquals(mod.default.run(), "pdf text");
        assertEquals(
          requested.map((url) => url.split("?")[0]).sort(),
          [entryUrl, chunkUrl].sort(),
        );
      });

      it("hands a transitively imported framework package back to the runtime", async () => {
        // esm.sh resolves a package's own `zod` import to `/zod@<version>/...`.
        // Inlining that would give the discovered module a second zod, whose
        // schemas fail the registries' instance comparison, so it must resolve
        // to the framework's copy instead of being fetched.
        const files: Record<string, string> = {
          "package.json": JSON.stringify({
            dependencies: { "@veryfront-fixture/schema-tool": "2.0.0" },
          }),
          [toolPath]: [
            `import { shape } from "@veryfront-fixture/schema-tool";`,
            `export default { name: "schema-tool", shape };`,
          ].join("\n"),
        };

        const entryUrl = "https://esm.sh/@veryfront-fixture/schema-tool@2.0.0";
        const { requested, fetchMock } = cdnMock({
          [entryUrl]: [
            `import { z } from "/zod@3.25.76/es2022/zod.mjs";`,
            `export const shape = typeof z.object;`,
          ].join("\n"),
        });

        const context: FileDiscoveryContext = {
          platform: "node",
          fsAdapter: createMockAdapter(files, { projectDir }),
          baseDir: projectDir,
          compiledRuntime: true,
        };

        const mod = await withMockFetch(
          fetchMock,
          () =>
            importModule(`file://${projectDir}/${toolPath}`, context) as Promise<
              { default: { name: string; shape: string } }
            >,
        );

        assertEquals(mod.default.shape, "function");
        assertEquals(
          requested.map((url) => url.split("?")[0]),
          [entryUrl],
          `zod must not be fetched, got ${JSON.stringify(requested)}`,
        );
      });

      it("classifies an unreachable dependency source instead of a bundler failure", async () => {
        // The single most likely real-world failure of the CDN path: a wrong pin,
        // a package esm.sh cannot build, or a CDN blip. The bundler wrapper
        // throws its build failure rather than returning it, so without a catch
        // this escapes as raw `Build failed with 1 error` text -- exactly the
        // unclassified surface #1440 asked to stop showing.
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

        // No routes: every CDN URL answers 404, the way a mistyped pin does.
        const { requested, fetchMock } = cdnMock({});
        const error = await withMockFetch(
          fetchMock,
          () =>
            assertRejects(
              () => importModule(`file://${projectDir}/${toolPath}`, context),
              Error,
              "@veryfront-fixture/pdf-text",
            ),
        );

        assertEquals((error as VeryfrontError).slug, "dependency-missing");
        assertEquals(requested.length > 0, true);
      });

      it("serves a dependency source once per process", async () => {
        // Discovery re-bundles per file and per source generation. A pinned CDN
        // URL is immutable, so a second module declaring the same pin must not
        // pay for the fetch again.
        const entryUrl = "https://esm.sh/@veryfront-fixture/pdf-text@1.8.1";
        const { requested, fetchMock } = cdnMock({
          [entryUrl]: `export function extractText() { return "pdf text"; }`,
        });

        const packageJson = JSON.stringify({
          dependencies: { "@veryfront-fixture/pdf-text": "1.8.1" },
        });
        const load = (toolSource: string) =>
          importModule(`file://${projectDir}/${toolPath}`, {
            platform: "node",
            fsAdapter: createMockAdapter(
              { "package.json": packageJson, [toolPath]: toolSource },
              { projectDir },
            ),
            baseDir: projectDir,
            compiledRuntime: true,
          }) as Promise<{ default: { name: string } }>;

        const [first, second] = await withMockFetch(fetchMock, async () => [
          await load(
            `import { extractText } from "@veryfront-fixture/pdf-text";\n` +
              `export default { name: "first", text: extractText() };`,
          ),
          await load(
            `import { extractText } from "@veryfront-fixture/pdf-text";\n` +
              `export default { name: "second", text: extractText() };`,
          ),
        ]);

        assertEquals([first.default.name, second.default.name], ["first", "second"]);
        assertEquals(
          requested.filter((url) => url.startsWith(entryUrl)).length,
          1,
          `expected one fetch across both modules, got ${JSON.stringify(requested)}`,
        );
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
    });

    describe("fetchProjectDependencySource", () => {
      it("denies an origin outside the pinned CDN before any request leaves", async () => {
        // The specifier a project declares decides the URL, so the allow-list is
        // the boundary that keeps a declared dependency from addressing an
        // arbitrary host through the discovery bundler.
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
        assertEquals(requested, []);
      });

      it("reports an unreachable CDN response to the caller", async () => {
        const response = await withMockFetch(
          () => Promise.resolve(new Response("Not Found", { status: 404 })),
          () => fetchProjectDependencySource("https://esm.sh/@veryfront-fixture/pdf-text@1.8.1"),
        );
        assertEquals(response.ok, false);
        assertEquals(response.status, 404);
      });
    });
  },
);
