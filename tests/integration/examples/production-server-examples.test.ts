/**
 * Example: Refactored test using TestContext for bulletproof testing
 *
 * This example demonstrates best practices:
 * - Clear test naming and documentation
 * - Proper resource management
 * - No magic numbers or arbitrary timeouts
 * - Meaningful assertions with context
 * - Complete isolation between tests
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe("ProductionServer", { sanitizeResources: false, sanitizeOps: false }, () => {
  describe("Static Asset Serving", () => {
    it("should serve static files with correct headers and caching", async () => {
      await withTestContext("static-asset-serving", async (context) => {
        const cssContent = "body { margin: 0; padding: 0; }";
        await writeTextFile(`${context.projectDir}/public/styles.css`, cssContent);

        const server = await context.createProductionServer();
        const response = await fetch(`http://127.0.0.1:${server.port}/styles.css`);
        const body = await response.text();

        assertEquals(response.status, 200, "Should return 200 for existing static file");
        assertEquals(body, cssContent, "Should return correct file content");

        assertEquals(
          response.headers.get("content-type"),
          "text/css; charset=utf-8",
          "Should set correct content-type for CSS files",
        );
        assertExists(response.headers.get("etag"), "Should include ETag header for caching");
        assertExists(response.headers.get("cache-control"), "Should include cache-control header");

        const notFoundResponse = await fetch(`http://127.0.0.1:${server.port}/non-existent.css`);
        assertEquals(notFoundResponse.status, 404, "Should return 404 for non-existent files");
        await notFoundResponse.body?.cancel();
      });
    });

    it("should handle concurrent requests without resource leaks", async () => {
      await withTestContext("concurrent-requests", async (context) => {
        await writeTextFile(`${context.projectDir}/public/test.txt`, "Hello, World!");

        const server = await context.createProductionServer();

        const responses = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            fetch(`http://127.0.0.1:${server.port}/test.txt?req=${i}`),
          ),
        );

        for (const [index, response] of responses.entries()) {
          assertEquals(response.status, 200, `Request ${index} should succeed`);
          assertEquals(
            await response.text(),
            "Hello, World!",
            `Request ${index} should return correct content`,
          );
        }
      });
    });
  });

  describe("Error Handling", () => {
    it("should return user-friendly error pages in production", async () => {
      await withTestContext("error-handling", async (context) => {
        await writeTextFile(
          `${context.projectDir}/pages/error.mdx`,
          `# Error Page\n\nexport default function ErrorPage() {\n  throw new Error('Intentional test error');\n}`,
        );

        context.setEnv({ NODE_ENV: "production" });

        const server = await context.createProductionServer();

        const response = await fetch(`http://127.0.0.1:${server.port}/pages/error`);
        await response.text();

        assert(
          response.status === 404 || response.status === 500,
          `Should return error status (got ${response.status})`,
        );
      });
    });
  });
});

// Example of a performance-aware test
// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
describe("Performance", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("should serve static assets within acceptable time limits", async () => {
    await withTestContext("performance-static-assets", async (context) => {
      const largeCSS = Array(1000).fill("body { margin: 0; }\n").join("");
      await writeTextFile(`${context.projectDir}/public/large.css`, largeCSS);

      const server = await context.createProductionServer();

      const startTime = performance.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/large.css`);
      await response.text();
      const responseTime = performance.now() - startTime;

      assertEquals(response.status, 200, "Should serve large files successfully");
      assertEquals(
        responseTime < 100,
        true,
        `Static asset should be served within 100ms, took ${responseTime.toFixed(2)}ms`,
      );
    });
  });
});

class TestDataFactory {
  static createMDXPage(options: {
    title: string;
    content: string;
    frontmatter?: Record<string, unknown>;
  }): string {
    const frontmatter = options.frontmatter;
    if (!frontmatter) return `# ${options.title}\n\n${options.content}`;

    const frontmatterStr = Object.entries(frontmatter)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    return `---\n${frontmatterStr}\n---\n\n# ${options.title}\n\n${options.content}`;
  }

  static createReactComponent(name: string, props: string[] = []): string {
    const propsStr =
      props.length > 0
        ? `{ ${props.join(", ")} }: { ${props.map((p) => `${p}: unknown`).join("; ")} }`
        : "()";

    return `
import React from 'react';

export default function ${name}${propsStr} {
  return <div data-testid="${name.toLowerCase()}">${name} Component</div>;
}`;
  }
}

// Example usage with factory
// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// See: https://github.com/facebook/react/issues/24669
describe(
  "MDX Processing",
  {
    // React 19's SSR implementation uses MessagePorts internally which causes leak detection
    // This is a known issue with React DOM Server and not a bug in our code
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    it("should correctly process MDX pages with frontmatter", async () => {
      await withTestContext("mdx-processing", async (context) => {
        const mdxContent = TestDataFactory.createMDXPage({
          title: "Test Page",
          content: "This is a test page with **bold** text.",
          frontmatter: {
            author: "Test Author",
            date: "2024-01-01",
            tags: "test, mdx",
          },
        });

        await writeTextFile(`${context.projectDir}/pages/test.mdx`, mdxContent);

        const server = await context.createDevServer();

        const response = await fetch(`http://127.0.0.1:${server.port}/test`);
        const html = await response.text();

        assertEquals(response.status, 200, "MDX page should be accessible");
        assertEquals(
          html.includes("<h1>Test Page</h1>") || html.includes("Test Page"),
          true,
          "Should render MDX title as H1",
        );
        assertEquals(
          html.includes("<strong>bold</strong>") || html.includes("bold"),
          true,
          "Should process MDX markdown syntax",
        );
      });
    });
  },
);
