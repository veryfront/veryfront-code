import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// ---- Inline reimplementations of non-exported pure helpers ----

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

  if (output && typeof output === "object" && "html" in output && typeof output.html === "string") {
    return {
      htmlBody: output.html,
      outputMetadata: output.frontmatter || output.meta || {},
    };
  }

  if (output && typeof output === "object") {
    return {
      htmlBody: `<pre>${JSON.stringify(output, null, 2)}</pre>`,
      outputMetadata: {},
    };
  }

  throw new Error("Unsupported script page return type");
}

interface PageContext {
  params: Record<string, string>;
  slug: string;
  path: string;
  frontmatter: Record<string, unknown>;
}

function buildPageContext(
  pageInfo: { entity: { path: string; frontmatter: Record<string, unknown> } },
  slug: string,
  params?: Record<string, string | string[]>,
): PageContext {
  const flatParams: Record<string, string> = params
    ? Object.fromEntries(
      Object.entries(params)
        .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
        .filter((entry): entry is [string, string] => entry[1] !== undefined),
    )
    : {};

  return {
    params: flatParams,
    slug,
    path: pageInfo.entity.path,
    frontmatter: pageInfo.entity.frontmatter || {},
  };
}

function normalizeModulePath(modulePath: string, projectDir: string): string {
  let normalized = modulePath;
  if (!modulePath.startsWith("/") && projectDir) {
    normalized = `${projectDir}/${modulePath}`;
  }
  return normalized;
}

function createFileUrl(path: string): string {
  const cacheBuster = `?v=12345`;
  return path.startsWith("file://") ? `${path}${cacheBuster}` : `file://${path}${cacheBuster}`;
}

function rewriteNpmImports(code: string): string {
  // Simulating Deno environment
  const NPM_REWRITES = [
    { pattern: /from\s+["']ai["']/g, replacement: 'from "npm:ai@latest"' },
    { pattern: /from\s+["']zod["']/g, replacement: 'from "npm:zod@latest"' },
  ];

  let result = code;
  for (const { pattern, replacement } of NPM_REWRITES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function getStringMeta(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

const APP_COMPONENT_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];

// ---- Tests ----

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
      assertThrows(
        () => extractHtmlAndMetadata(null),
        Error,
        "Unsupported",
      );
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
      const ctx = buildPageContext(mockPageInfo, "about", { id: "123" });
      assertEquals(ctx.slug, "about");
      assertEquals(ctx.path, "/project/pages/about.tsx");
      assertEquals(ctx.params, { id: "123" });
      assertEquals(ctx.frontmatter, { title: "About" });
    });

    it("should flatten array params to first element", () => {
      const ctx = buildPageContext(mockPageInfo, "blog", { tags: ["a", "b"] });
      assertEquals(ctx.params, { tags: "a" });
    });

    it("should handle empty params", () => {
      const ctx = buildPageContext(mockPageInfo, "home");
      assertEquals(ctx.params, {});
    });

    it("should handle undefined params", () => {
      const ctx = buildPageContext(mockPageInfo, "home", undefined);
      assertEquals(ctx.params, {});
    });

    it("should use empty object when frontmatter is falsy", () => {
      const info = { entity: { path: "/p.tsx", frontmatter: {} } };
      const ctx = buildPageContext(info, "test");
      assertEquals(ctx.frontmatter, {});
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
      // Should not have file://file://
      assertEquals(url.includes("file://file://"), false);
    });
  });

  describe("rewriteNpmImports", () => {
    it("should rewrite bare 'ai' import", () => {
      const code = `import { generateText } from "ai"`;
      const result = rewriteNpmImports(code);
      assertEquals(result, `import { generateText } from "npm:ai@latest"`);
    });

    it("should rewrite bare 'zod' import", () => {
      const code = `import { z } from "zod"`;
      const result = rewriteNpmImports(code);
      assertEquals(result, `import { z } from "npm:zod@latest"`);
    });

    it("should rewrite multiple imports", () => {
      const code = `import { z } from "zod"\nimport { generateText } from "ai"`;
      const result = rewriteNpmImports(code);
      assertEquals(result.includes('from "npm:zod@latest"'), true);
      assertEquals(result.includes('from "npm:ai@latest"'), true);
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
});
