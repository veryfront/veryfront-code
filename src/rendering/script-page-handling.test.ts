import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteNpmImports } from "#veryfront/transforms/npm-import-rewrites.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { FakeTime } from "#std/testing/time";
import { PageRenderer } from "./page-renderer.ts";
import { handleScriptPage } from "./script-page-handling.ts";
import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import type { RuntimeModuleReference } from "#veryfront/platform/adapters/base.ts";

describe("prepared script pages", () => {
  it("renders and collects metadata from the prepared module without reading executable source", async () => {
    const adapter = createMissingFileAdapter();
    Object.defineProperty(adapter, "moduleLoader", {
      value: {
        importModule: async (reference: RuntimeModuleReference) => {
          assertEquals(reference, { kind: "source", path: "/project/page.ts" });
          return {
            default: () => "<main>prepared script</main>",
            generateMetadata: () => ({ title: "Prepared metadata" }),
          };
        },
      },
    });
    const rendered = await handleScriptPage(
      { entity: { path: "/project/page.ts", frontmatter: {} } } as never,
      "page",
      {
        mode: "production",
        config: {},
        projectDir: "/project",
        adapter,
      },
    );
    assertStringIncludes(rendered.html, "<main>prepared script</main>");
    assertEquals(rendered.frontmatter?.title, "Prepared metadata");
  });
});

const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";
const ENCODED_PIN_KEY_A = encodeURIComponent(PIN_KEY_A);
const ENCODED_PIN_KEY_B = encodeURIComponent(PIN_KEY_B);

function createFileUrl(path: string): string {
  const cacheBuster = "?v=12345";
  return path.startsWith("file://") ? `${path}${cacheBuster}` : `file://${path}${cacheBuster}`;
}

function getStringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

function extractInlineJson(
  html: string,
  idOrType: "veryfront-hydration-data" | "importmap",
): Record<string, unknown> {
  const pattern = idOrType === "importmap"
    ? /<script type="importmap"[^>]*>\s*([\s\S]*?)\s*<\/script>/i
    : /<script id="veryfront-hydration-data" type="application\/json"[^>]*>([\s\S]*?)<\/script>/i;
  const match = html.match(pattern);
  if (!match?.[1]) throw new Error(`Missing ${idOrType} script`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

function createScriptAdapter(): RuntimeAdapter {
  return {
    fs: {
      exists: () => Promise.resolve(false),
    },
  } as unknown as RuntimeAdapter;
}

function createMissingFileAdapter(): RuntimeAdapter {
  return {
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.reject(new Error("missing")),
    },
  } as unknown as RuntimeAdapter;
}

function createProbeAdapter(probed: string[]): RuntimeAdapter {
  return {
    fs: {
      exists: (path: string) => {
        probed.push(path);
        return Promise.resolve(false);
      },
    },
  } as unknown as RuntimeAdapter;
}

/** Drive the real handleScriptPage over a throwaway project containing one page module. */
async function renderScriptPage(
  source: string,
  options: {
    url?: URL;
    params?: Record<string, string | string[]>;
    frontmatter?: Record<string, unknown>;
    adapter?: RuntimeAdapter;
  } = {},
): Promise<Awaited<ReturnType<typeof handleScriptPage>>> {
  const projectDir = await makeTempDir({ prefix: "vf-script-page-render-" });

  try {
    const pagePath = `${projectDir}/page.js`;
    await Deno.writeTextFile(pagePath, source);

    return await handleScriptPage(
      {
        entity: {
          path: pagePath,
          frontmatter: options.frontmatter ?? {},
        },
      } as never,
      "script-page",
      {
        mode: "production",
        config: {} as never,
        projectDir,
        adapter: options.adapter ?? createScriptAdapter(),
        params: options.params,
        url: options.url,
      },
    );
  } finally {
    await Deno.remove(projectDir, { recursive: true });
  }
}

/** Render a page that cannot be read so the resolved module path surfaces in the error. */
async function scriptPageLoadFailure(pagePath: string, projectDir: string): Promise<string> {
  const error = await assertRejects(
    () =>
      handleScriptPage(
        {
          entity: { path: pagePath, frontmatter: {} },
        } as never,
        "script-page",
        {
          mode: "production",
          config: {} as never,
          projectDir,
          adapter: createMissingFileAdapter(),
        },
      ),
    Error,
  );

  return String(error);
}

async function renderWithPageRenderer(
  options: {
    projectDir: string;
    pagePath: string;
    dependencyPinningCacheKey?: string;
    dependencyPinningDependencies?: Readonly<Record<string, string>>;
    releaseId?: string;
    adapter?: RuntimeAdapter;
    config?: VeryfrontConfig;
  },
): Promise<string> {
  const adapter = options.adapter ?? createScriptAdapter();
  const config = options.config ?? { client: { cdn: { provider: "unpkg" } } };
  const renderer = new PageRenderer({
    projectDir: options.projectDir,
    mode: "production",
    environment: "production",
    config,
    adapter,
    componentRegistry: {} as never,
    compileMDX: () => Promise.reject(new Error("not used for script pages")),
  });
  const result = await renderer.preparePageBundles(
    {
      entity: {
        path: options.pagePath,
        frontmatter: {},
      },
    } as never,
    "script-page",
    undefined,
    {
      dependencyPinningCacheKey: options.dependencyPinningCacheKey,
      dependencyPinningDependencies: options.dependencyPinningDependencies,
      releaseId: options.releaseId,
    },
  );
  if (!result.scriptResult) throw new Error("Expected script page result");
  return result.scriptResult.html;
}

describe("script-page-handling helpers", () => {
  describe("script page output handling", () => {
    it("should handle plain string output", async () => {
      const result = await renderScriptPage(`export default "<h1>Hello</h1>";`);
      assertStringIncludes(
        result.html,
        "<h1>Hello</h1>",
        "a string script-page return must become the document body",
      );
    });

    it("should handle object with html and frontmatter", async () => {
      const result = await renderScriptPage(
        `export default () => ({ html: "<h1>Title</h1>", frontmatter: { title: "My Page" } });`,
      );
      assertStringIncludes(
        result.html,
        "<h1>Title</h1>",
        "the html field must become the document body",
      );
      assertEquals(
        result.frontmatter.title,
        "My Page",
        "the frontmatter field must become the page metadata",
      );
    });

    it("should handle object with html and meta", async () => {
      const result = await renderScriptPage(
        `export default () => ({ html: "<p>Content</p>", meta: { description: "A page" } });`,
      );
      assertStringIncludes(
        result.html,
        "<p>Content</p>",
        "the html field must become the document body",
      );
      assertEquals(
        result.frontmatter.description,
        "A page",
        "the meta field must become the page metadata when frontmatter is absent",
      );
    });

    it("should prefer frontmatter over meta", async () => {
      const result = await renderScriptPage(
        `export default () => ({ html: "<p>Content</p>", frontmatter: { title: "From Frontmatter" }, meta: { title: "From Meta" } });`,
      );
      assertEquals(
        result.frontmatter.title,
        "From Frontmatter",
        "frontmatter must win over meta",
      );
    });

    it("should HTML-escape JSON-serialized unknown objects", async () => {
      const result = await renderScriptPage(
        `export default () => ({ bio: "<script>alert(1)</script>" });`,
      );
      assertStringIncludes(
        result.html,
        "&lt;script&gt;alert(1)&lt;/script&gt;",
        "object-serialized script-page output must be HTML-escaped",
      );
      assertEquals(
        result.html.includes('<pre>{\n  "bio"'),
        false,
        "raw markup must never reach the <pre> serialization block",
      );
    });

    it("should reject for null output", async () => {
      const error = await assertRejects(
        () => renderScriptPage(`export default () => null;`),
        Error,
      );
      assertStringIncludes(
        String(error),
        "Unsupported script page return type",
        "a script page returning null must surface a render error",
      );
    });
  });

  describe("script page context", () => {
    it("should build context with all fields", async () => {
      const result = await renderScriptPage(
        `export default (ctx) =>
          "<main>" + ctx.slug + "|" + ctx.params.id + "|" + ctx.query.tab + "|" +
          ctx.frontmatter.title + "|" + ctx.path.endsWith("/page.js") + "</main>";`,
        {
          params: { id: "123" },
          frontmatter: { title: "About" },
          url: new URL("https://example.com/about?tab=details"),
        },
      );
      assertStringIncludes(
        result.html,
        "<main>script-page|123|details|About|true</main>",
        "the page context must carry the slug, params, query, frontmatter and page path",
      );
    });

    it("should join catch-all array params instead of dropping segments", async () => {
      const result = await renderScriptPage(
        `export default (ctx) => "<main>" + ctx.params.tags + "</main>";`,
        { params: { tags: ["a", "b"] } },
      );
      assertStringIncludes(
        result.html,
        "<main>a/b</main>",
        "catch-all params must be joined, not truncated to the first segment",
      );
    });

    it("should capture query params from the request URL", async () => {
      const result = await renderScriptPage(
        `export default (ctx) => "<main>" + ctx.query.q + ctx.query.page + "</main>";`,
        { url: new URL("https://example.com/search?q=test&page=2") },
      );
      assertStringIncludes(
        result.html,
        "<main>test2</main>",
        "every query param on the request URL must reach the page context",
      );
    });

    it("should default params and query to empty objects", async () => {
      const result = await renderScriptPage(
        `export default (ctx) =>
          "<main>" + JSON.stringify(ctx.params) + JSON.stringify(ctx.query) + "</main>";`,
      );
      assertStringIncludes(
        result.html,
        "<main>{}{}</main>",
        "a request without params or a URL must yield empty context collections",
      );
    });
  });

  describe("script module path resolution", () => {
    it("should prepend projectDir for relative paths", async () => {
      const message = await scriptPageLoadFailure("pages/index.ts", "/project");
      assertStringIncludes(
        message,
        "(tried: /project/pages/index.ts)",
        "a relative page path must be resolved against the project directory",
      );
    });

    it("should leave absolute paths unchanged", async () => {
      const message = await scriptPageLoadFailure("/abs/path/file.ts", "/project");
      assertStringIncludes(
        message,
        "(tried: /abs/path/file.ts)",
        "an absolute page path must be used as-is",
      );
    });
  });

  describe("createFileUrl", () => {
    it("should prepend file:// for absolute paths", () => {
      const url = createFileUrl("/tmp/module.mjs");
      assertEquals(url.startsWith("file:///tmp/module.mjs"), true);
    });

    it("should append cache buster", () => {
      const url = createFileUrl("/tmp/module.mjs");
      assertEquals(url.includes("?v="), true);
    });

    it("should not double-prefix file:// urls", () => {
      const url = createFileUrl("file:///tmp/module.mjs");
      assertEquals(url.startsWith("file:///tmp/module.mjs"), true);
      assertEquals(url.indexOf("file://"), 0);
      assertEquals(url.includes("file://file://"), false);
    });
  });

  describe("rewriteNpmImports", () => {
    // Assemble the bare-specifier string at runtime so a `grep 'from "zod"'`
    // over the source tree does not produce a false positive for this test file.
    const ZOD_SPECIFIER = "zod";

    it("leaves transpiled script modules unrewritten while nothing is rewritable", () => {
      const code = `import { z } from "${ZOD_SPECIFIER}"`;
      assertEquals(
        rewriteNpmImports(code, "/project"),
        code,
        "transpiled script modules are imported unrewritten while REWRITABLE_PACKAGES is empty",
      );
    });
  });

  describe("getStringMeta", () => {
    it("should return string values", () => {
      assertEquals(getStringMeta({ title: "Hello" }, "title"), "Hello");
    });

    it("should return undefined for non-string values", () => {
      assertEquals(getStringMeta({ count: 42 }, "count"), undefined);
      assertEquals(getStringMeta({ flag: true }, "flag"), undefined);
      assertEquals(getStringMeta({ obj: {} }, "obj"), undefined);
    });

    it("should return undefined for missing keys", () => {
      assertEquals(getStringMeta({}, "missing"), undefined);
    });
  });

  describe("app component discovery", () => {
    it("should probe every supported app component extension", async () => {
      const probed: string[] = [];
      await renderScriptPage(`export default "<main>App probe</main>";`, {
        adapter: createProbeAdapter(probed),
      });

      const appProbes = probed
        .filter((path) => path.includes("/components/app"))
        .map((path) => path.slice(path.indexOf("/components/app")));

      assertEquals(
        appProbes,
        [
          "/components/app.tsx",
          "/components/app.jsx",
          "/components/app.ts",
          "/components/app.js",
          "/components/app.mdx",
          "/components/app.md",
        ],
        "app component discovery must probe every supported extension, including .mdx and .md",
      );
    });
  });

  describe("handleScriptPage", () => {
    it("swallows a plain generateMetadata failure and still renders the page", async () => {
      const result = await renderScriptPage(
        `export default "<main>Body</main>";
export const generateMetadata = () => { throw new Error("soft"); };`,
        { frontmatter: { title: "Page title" } },
      );

      assertEquals(
        result.frontmatter.title,
        "Page title",
        "a plain generateMetadata failure must be swallowed and the page must still render",
      );
      assertStringIncludes(
        result.html,
        "<main>Body</main>",
        "a plain generateMetadata failure must not stop the page body from rendering",
      );
    });

    it("surfaces a ReferenceError thrown by generateMetadata", async () => {
      const error = await assertRejects(
        () =>
          renderScriptPage(
            `export default "<main>Body</main>";
export const generateMetadata = () => { missingIdentifier; };`,
          ),
        Error,
      );

      assertStringIncludes(
        String(error),
        "Failed to render TS/JS page",
        "a ReferenceError in generateMetadata must surface as a render error",
      );
    });

    it("surfaces a cross-realm SyntaxError thrown by generateMetadata", async () => {
      const error = await assertRejects(
        () =>
          renderScriptPage(
            `export default "<main>Body</main>";
export const generateMetadata = () => {
  throw Object.assign(new Error("x"), { name: "SyntaxError" });
};`,
          ),
        Error,
      );

      assertStringIncludes(
        String(error),
        "Failed to render TS/JS page",
        "a cross-realm SyntaxError must be re-thrown via the name fallback, not swallowed",
      );
    });

    it("keeps wrapped script-page import maps and hydration on snapshot A after B", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-snapshot-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default "<main>Snapshot page</main>";`,
        );

        const snapshotB = await renderWithPageRenderer({
          projectDir,
          pagePath,
          dependencyPinningCacheKey: PIN_KEY_B,
          dependencyPinningDependencies: { react: "19.0.0", veryfront: "0.2.0" },
        });
        const snapshotA = await renderWithPageRenderer({
          projectDir,
          pagePath,
          dependencyPinningCacheKey: PIN_KEY_A,
          dependencyPinningDependencies: { react: "18.3.1", veryfront: "0.1.10" },
        });
        const importsB = extractInlineJson(snapshotB, "importmap").imports as
          | Record<string, string>
          | undefined;
        const importsA = extractInlineJson(snapshotA, "importmap").imports as
          | Record<string, string>
          | undefined;

        assertEquals(
          importsB?.["veryfront/router"],
          `/_vf_modules/_pins/${ENCODED_PIN_KEY_B}/_veryfront/react/runtime/core.js`,
        );
        assertEquals(
          importsA?.["veryfront/router"],
          `/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/_veryfront/react/runtime/core.js`,
        );
        assertEquals(importsA?.react?.includes("react@18.3.1"), true);
        assertEquals(importsB?.react?.includes("react@19.0.0"), true);
        assertEquals(
          extractInlineJson(snapshotA, "veryfront-hydration-data")
            .dependencyPinningCacheKey,
          PIN_KEY_A,
        );
        assertEquals(snapshotA.includes(ENCODED_PIN_KEY_B), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("injects snapshot A into non-client full-document RSC boot state", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-full-doc-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default \`<!DOCTYPE html><html><head><title>Script</title></head><body><main>Hello</main></body></html>\`;`,
        );

        const html = await renderWithPageRenderer({
          projectDir,
          pagePath,
          dependencyPinningCacheKey: PIN_KEY_A,
          dependencyPinningDependencies: { react: "18.3.1", veryfront: "0.1.10" },
        });
        const imports = extractInlineJson(html, "importmap").imports as
          | Record<string, string>
          | undefined;
        const hydrationData = extractInlineJson(html, "veryfront-hydration-data");

        assertEquals(
          imports?.["veryfront/router"],
          `/_vf_modules/_pins/${ENCODED_PIN_KEY_A}/_veryfront/react/runtime/core.js`,
        );
        assertEquals(hydrationData, {
          dependencyPinningCacheKey: PIN_KEY_A,
        });
        assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("keeps standalone production full documents on the RSC boot script", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-standalone-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default \`<!DOCTYPE html><html><head><title>Standalone</title></head><body><main>Hello</main></body></html>\`;`,
        );

        const html = await renderWithPageRenderer({
          projectDir,
          pagePath,
          releaseId: "standalone-dev",
        });

        assertEquals(html.includes("/_veryfront/rsc/client.js"), true);
        assertEquals(html.includes(getProdHydrationModulePath()), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("keeps wrapped script-page output byte-identical when pinning is off", async () => {
      using _time = new FakeTime(new Date("2026-07-26T00:00:00.000Z"));
      const projectDir = await makeTempDir({ prefix: "vf-script-page-off-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default "<main>Flag-off page</main>";`,
        );

        const unkeyed = await renderWithPageRenderer({ projectDir, pagePath });
        const flagOff = await renderWithPageRenderer({
          projectDir,
          pagePath,
          dependencyPinningCacheKey: "off",
        });

        assertEquals(flagOff, unkeyed);

        const fullPagePath = `${projectDir}/full.js`;
        await Deno.writeTextFile(
          fullPagePath,
          `export default \`<!DOCTYPE html><html><head><title>Off</title></head><body><main>Flag-off full page</main></body></html>\`;`,
        );
        const unkeyedFull = await renderWithPageRenderer({
          projectDir,
          pagePath: fullPagePath,
        });
        const flagOffFull = await renderWithPageRenderer({
          projectDir,
          pagePath: fullPagePath,
          dependencyPinningCacheKey: "off",
        });

        assertEquals(flagOffFull, unkeyedFull);
        assertEquals(flagOffFull.includes('type="importmap"'), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("uses the hydration runtime baked into an aged release", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-release-" });
      const agedRuntimePath = "/_veryfront/hydration-runtime.1a2b3c4d.js";

      try {
        await Deno.mkdir(`${projectDir}/custom-output/_veryfront`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/custom-output${agedRuntimePath}`,
          "export {};",
        );
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(pagePath, `export default "<main>Aged release</main>";`);

        const html = await renderWithPageRenderer({
          projectDir,
          pagePath,
          releaseId: "release-aged",
          adapter: { fs: createFileSystem() } as unknown as RuntimeAdapter,
          config: {
            build: { outDir: "custom-output" },
            client: { cdn: { provider: "unpkg" } },
          },
        });

        assertEquals(html.includes(agedRuntimePath), true);
        assertEquals(html.includes(getProdHydrationModulePath()), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("uses the hydration runtime baked into an aged release for full documents", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-release-full-" });
      const agedRuntimePath = "/_veryfront/hydration-runtime.2b3c4d5e.js";

      try {
        await Deno.mkdir(`${projectDir}/custom-output/_veryfront`, { recursive: true });
        await Deno.writeTextFile(
          `${projectDir}/custom-output${agedRuntimePath}`,
          "export {};",
        );
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default \`<!DOCTYPE html><html><head><title>Aged</title></head><body><main>Aged release</main></body></html>\`;`,
        );

        const html = await renderWithPageRenderer({
          projectDir,
          pagePath,
          releaseId: "release-aged",
          adapter: { fs: createFileSystem() } as unknown as RuntimeAdapter,
          config: {
            build: { outDir: "custom-output" },
            client: { cdn: { provider: "unpkg" } },
          },
        });

        assertEquals(html.includes(agedRuntimePath), true);
        assertEquals(html.includes(getProdHydrationModulePath()), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("forwards the request nonce when enhancing full HTML script pages", async () => {
      const projectDir = await makeTempDir({ prefix: "vf-script-page-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default \`<!DOCTYPE html><html><head><title>Script</title></head><body><main>Hello</main></body></html>\`;`,
        );

        const adapter = createScriptAdapter();

        const result = await handleScriptPage(
          {
            entity: {
              path: pagePath,
              frontmatter: {},
            },
          } as never,
          "script-page",
          {
            mode: "production",
            config: {} as never,
            projectDir,
            adapter,
            nonce: "nonce-123",
          },
        );

        assertEquals(
          result.html.includes(
            '<script type="module" src="/_veryfront/rsc/client.js" nonce="nonce-123"></script>',
          ),
          true,
        );
        assertEquals(result.html.includes("/_veryfront/hydrate.js"), false);
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
    });
  });
});
