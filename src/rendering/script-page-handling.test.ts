import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleScriptPage } from "./script-page-handling.ts";
import { flattenRouteParams } from "#veryfront/routing";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

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
    it("forwards the request nonce when enhancing full HTML script pages", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-script-page-" });

      try {
        const pagePath = `${projectDir}/page.js`;
        await Deno.writeTextFile(
          pagePath,
          `export default \`<!DOCTYPE html><html><head><title>Script</title></head><body><main>Hello</main></body></html>\`;`,
        );

        const adapter = {
          fs: {
            exists: async () => false,
          },
        } as unknown as RuntimeAdapter;

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
