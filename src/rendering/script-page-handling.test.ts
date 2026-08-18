import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { flattenRouteParams } from "#veryfront/routing";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";
import { FakeTime } from "#std/testing/time";
import { PageRenderer } from "./page-renderer.ts";
import { handleScriptPage } from "./script-page-handling.ts";

const PIN_KEY_A = "on:z7bg3qnfgtcb";
const PIN_KEY_B = "on:3w5e11264sgsf";
const ENCODED_PIN_KEY_A = encodeURIComponent(PIN_KEY_A);
const ENCODED_PIN_KEY_B = encodeURIComponent(PIN_KEY_B);

type ScriptModuleOutput =
  | string
  | Response
  | { html: string; frontmatter?: Record<string, unknown>; meta?: Record<string, unknown> }
  | null;

function extractHtmlAndMetadata(output: ScriptModuleOutput): {
  htmlBody: string;
  outputMetadata: Record<string, unknown>;
} {
  if (typeof output === "string") return { htmlBody: output, outputMetadata: {} };

  if (output && typeof output === "object") {
    if ("html" in output && typeof output.html === "string") {
      return {
        htmlBody: output.html,
        outputMetadata: output.frontmatter ?? output.meta ?? {},
      };
    }

    return {
      htmlBody: `<pre>${JSON.stringify(output, null, 2)}</pre>`,
      outputMetadata: {},
    };
  }

  throw new Error("Unsupported script page return type");
}

interface PageContext {
  params: Record<string, string>;
  query: Record<string, string>;
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
}

function buildPageContext(
  pageInfo: { entity: { path: string; frontmatter: Record<string, unknown> } },
  slug: string,
  params?: Record<string, string | string[]>,
  url?: URL,
): PageContext {
  // Mirror production: reuse the shared helper so this test can't drift back
  // to the old first-segment-only contract (issue #2742).
  const flatParams = flattenRouteParams(params);

  return {
    params: flatParams,
    query: url ? Object.fromEntries(url.searchParams) : {},
    slug,
    path: pageInfo.entity.path,
    frontmatter: pageInfo.entity.frontmatter ?? {},
  };
}

function normalizeModulePath(modulePath: string, projectDir: string): string {
  if (modulePath.startsWith("/") || !projectDir) return modulePath;
  return `${projectDir}/${modulePath}`;
}

function createFileUrl(path: string): string {
  const cacheBuster = "?v=12345";
  return path.startsWith("file://") ? `${path}${cacheBuster}` : `file://${path}${cacheBuster}`;
}

function rewriteNpmImports(code: string): string {
  const rewrites: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },
  ];

  return rewrites.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    code,
  );
}

function getStringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

const APP_COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];

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
      exists: async () => false,
    },
  } as unknown as RuntimeAdapter;
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
  describe("extractHtmlAndMetadata", () => {
    it("should handle plain string output", () => {
      const result = extractHtmlAndMetadata("<h1>Hello</h1>");
      assertEquals(result.htmlBody, "<h1>Hello</h1>");
      assertEquals(result.outputMetadata, {});
    });

    it("should handle object with html and frontmatter", () => {
      const output = {
        html: "<h1>Title</h1>",
        frontmatter: { title: "My Page" },
      };
      const result = extractHtmlAndMetadata(output);
      assertEquals(result.htmlBody, "<h1>Title</h1>");
      assertEquals(result.outputMetadata, { title: "My Page" });
    });

    it("should handle object with html and meta", () => {
      const output = {
        html: "<p>Content</p>",
        meta: { description: "A page" },
      };
      const result = extractHtmlAndMetadata(output);
      assertEquals(result.htmlBody, "<p>Content</p>");
      assertEquals(result.outputMetadata, { description: "A page" });
    });

    it("should prefer frontmatter over meta", () => {
      const output = {
        html: "<p>Content</p>",
        frontmatter: { title: "From Frontmatter" },
        meta: { title: "From Meta" },
      };
      const result = extractHtmlAndMetadata(output);
      assertEquals(result.outputMetadata, { title: "From Frontmatter" });
    });

    it("should JSON-serialize unknown objects", () => {
      const output = { foo: "bar", count: 42 } as unknown as ScriptModuleOutput;
      const result = extractHtmlAndMetadata(output);
      assertEquals(result.htmlBody.includes("<pre>"), true);
      assertEquals(result.htmlBody.includes('"foo"'), true);
      assertEquals(result.outputMetadata, {});
    });

    it("should throw for null output", () => {
      assertThrows(() => extractHtmlAndMetadata(null), Error, "Unsupported");
    });
  });

  describe("buildPageContext", () => {
    const mockPageInfo = {
      entity: {
        path: "/project/pages/about.tsx",
        frontmatter: { title: "About" },
      },
    };

    it("should build context with all fields", () => {
      const ctx = buildPageContext(
        mockPageInfo,
        "about",
        { id: "123" },
        new URL("https://example.com/about?tab=details"),
      );
      assertEquals(ctx.slug, "about");
      assertEquals(ctx.path, "/project/pages/about.tsx");
      assertEquals(ctx.params, { id: "123" });
      assertEquals(ctx.query, { tab: "details" });
      assertEquals(ctx.frontmatter, { title: "About" });
    });

    it("should join catch-all array params instead of dropping segments", () => {
      const ctx = buildPageContext(mockPageInfo, "blog", { tags: ["a", "b"] });
      assertEquals(ctx.params, { tags: "a/b" });
    });

    it("should handle empty params", () => {
      const ctx = buildPageContext(mockPageInfo, "home");
      assertEquals(ctx.params, {});
      assertEquals(ctx.query, {});
    });

    it("should handle undefined params", () => {
      const ctx = buildPageContext(mockPageInfo, "home", undefined);
      assertEquals(ctx.params, {});
      assertEquals(ctx.query, {});
    });

    it("should use empty object when frontmatter is falsy", () => {
      const info = { entity: { path: "/p.tsx", frontmatter: {} } };
      const ctx = buildPageContext(info, "test");
      assertEquals(ctx.frontmatter, {});
    });

    it("should capture query params from the request URL", () => {
      const ctx = buildPageContext(
        mockPageInfo,
        "search",
        undefined,
        new URL("https://example.com/search?q=test&page=2"),
      );
      assertEquals(ctx.query, { q: "test", page: "2" });
    });
  });

  describe("normalizeModulePath", () => {
    it("should prepend projectDir for relative paths", () => {
      const result = normalizeModulePath("pages/index.ts", "/project");
      assertEquals(result, "/project/pages/index.ts");
    });

    it("should leave absolute paths unchanged", () => {
      const result = normalizeModulePath("/abs/path/file.ts", "/project");
      assertEquals(result, "/abs/path/file.ts");
    });

    it("should handle empty projectDir gracefully", () => {
      const result = normalizeModulePath("file.ts", "");
      assertEquals(result, "file.ts");
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

    it("should rewrite bare 'zod' import", () => {
      const code = `import { z } from "${ZOD_SPECIFIER}"`;
      const result = rewriteNpmImports(code);
      assertEquals(result, `import { z } from "npm:zod@latest"`);
    });

    it("should rewrite multiple imports", () => {
      const code = `import { z } from "${ZOD_SPECIFIER}"\nimport { foo } from "other-package"`;
      const result = rewriteNpmImports(code);
      assertEquals(result.includes('from "npm:zod@latest"'), true);
      assertEquals(result.includes('from "other-package"'), true);
    });

    it("should not modify other imports", () => {
      const code = `import React from "react"`;
      const result = rewriteNpmImports(code);
      assertEquals(result, code);
    });

    it("should handle code without imports", () => {
      const code = `const x = 42;`;
      const result = rewriteNpmImports(code);
      assertEquals(result, code);
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

  describe("APP_COMPONENT_EXTENSIONS", () => {
    it("should include all expected extensions", () => {
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".tsx"), true);
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".jsx"), true);
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".ts"), true);
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".js"), true);
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".mdx"), true);
      assertEquals(APP_COMPONENT_EXTENSIONS.includes(".md"), true);
    });

    it("should have exactly 6 extensions", () => {
      assertEquals(APP_COMPONENT_EXTENSIONS.length, 6);
    });
  });

  describe("handleScriptPage", () => {
    it("keeps wrapped script-page import maps and hydration on snapshot A after B", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-snapshot-" });

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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-full-doc-" });

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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-standalone-" });

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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-off-" });

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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-release-" });
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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-release-full-" });
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
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-" });

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
