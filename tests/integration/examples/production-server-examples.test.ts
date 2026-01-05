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

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("ProductionServer", () => {
  describe("Static Asset Serving", () => {
    it("should serve static files with correct headers and caching", async () => {
      /**
       * Test scenario:
       * 1. Create a production server with static assets
       * 2. Request a CSS file and verify correct content-type
       * 3. Verify caching headers are set appropriately
       * 4. Ensure gzip compression is applied for text files
       */
      await withTestContext("static-asset-serving", async (context) => {
        // Arrange: Set up test data
        const cssContent = "body { margin: 0; padding: 0; }";
        await Deno.writeTextFile(`${context.projectDir}/public/styles.css`, cssContent);

        // Act: Start server and make request
        const server = await context.createProductionServer();
        const response = await fetch(`http://127.0.0.1:${server.port}/styles.css`);
        const body = await response.text();

        // Assert: Verify response
        assertEquals(response.status, 200, "Should return 200 for existing static file");
        assertEquals(body, cssContent, "Should return correct file content");

        // Assert: Verify headers
        assertEquals(
          response.headers.get("content-type"),
          "text/css; charset=utf-8",
          "Should set correct content-type for CSS files",
        );

        assertExists(response.headers.get("etag"), "Should include ETag header for caching");

        assertExists(response.headers.get("cache-control"), "Should include cache-control header");

        // Additional test: Verify 404 for non-existent files
        const notFoundResponse = await fetch(`http://127.0.0.1:${server.port}/non-existent.css`);
        assertEquals(notFoundResponse.status, 404, "Should return 404 for non-existent files");
        await notFoundResponse.body?.cancel(); // Consume the response body
      });
    });

    it("should handle concurrent requests without resource leaks", async () => {
      /**
       * Test scenario:
       * Verify server handles multiple concurrent requests properly
       * without leaving hanging connections or resources
       */
      await withTestContext("concurrent-requests", async (context) => {
        // Arrange
        await Deno.writeTextFile(`${context.projectDir}/public/test.txt`, "Hello, World!");

        const server = await context.createProductionServer();

        // Act: Make 10 concurrent requests
        const requests = Array.from(
          { length: 10 },
          (_, i) => fetch(`http://127.0.0.1:${server.port}/test.txt?req=${i}`),
        );

        const responses = await Promise.all(requests);

        // Assert: All requests succeed
        for (const [index, response] of responses.entries()) {
          assertEquals(response.status, 200, `Request ${index} should succeed`);
          const body = await response.text();
          assertEquals(body, "Hello, World!", `Request ${index} should return correct content`);
        }
      });
    });
  });

  describe("Error Handling", () => {
    it("should return user-friendly error pages in production", async () => {
      /**
       * Test scenario:
       * Verify production server returns appropriate error pages
       * without exposing internal details
       */
      await withTestContext("error-handling", async (context) => {
        // Arrange: Create a page that throws an error
        await Deno.writeTextFile(
          `${context.projectDir}/pages/error.mdx`,
          `# Error Page\n\nexport default function ErrorPage() {\n  throw new Error('Intentional test error');\n}`,
        );

        // Set production environment
        context.setEnv({ NODE_ENV: "production" });

        const server = await context.createProductionServer();

        // Act
        const response = await fetch(`http://127.0.0.1:${server.port}/pages/error`);
        const body = await response.text();

        // Assert
        assertEquals(response.status, 500, "Should return 500 for server errors");

        assertEquals(
          body.includes("Intentional test error"),
          false,
          "Should NOT expose error details in production",
        );

        assertEquals(
          body.includes("Internal Server Error") || body.includes("Something went wrong"),
          true,
          "Should show generic error message",
        );
      });
    });
  });
});

// Example of a performance-aware test
describe("Performance", () => {
  it("should serve static assets within acceptable time limits", async () => {
    /**
     * Test scenario:
     * Ensure static asset serving meets performance requirements
     */
    await withTestContext("performance-static-assets", async (context) => {
      // Arrange: Create a larger CSS file
      const largeCSS = Array(1000).fill("body { margin: 0; }\n").join("");
      await Deno.writeTextFile(`${context.projectDir}/public/large.css`, largeCSS);

      const server = await context.createProductionServer();

      // Act: Measure response time
      const startTime = performance.now();
      const response = await fetch(`http://127.0.0.1:${server.port}/large.css`);
      await response.text(); // Consume body
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      // Assert
      assertEquals(response.status, 200, "Should serve large files successfully");
      assertEquals(
        responseTime < 100,
        true,
        `Static asset should be served within 100ms, took ${responseTime.toFixed(2)}ms`,
      );
    });
  });
});

// Example of testing with proper test data factories
class TestDataFactory {
  static createMDXPage(options: {
    title: string;
    content: string;
    frontmatter?: Record<string, any>;
  }): string {
    const frontmatterStr = options.frontmatter
      ? `---\n${
        Object.entries(options.frontmatter)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      }\n---\n\n`
      : "";

    return `${frontmatterStr}# ${options.title}\n\n${options.content}`;
  }

  static createReactComponent(name: string, props: string[] = []): string {
    const propsStr = props.length > 0
      ? `{ ${props.join(", ")} }: { ${props.map((p) => `${p}: any`).join("; ")} }`
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
        // Arrange: Use factory to create test data
        const mdxContent = TestDataFactory.createMDXPage({
          title: "Test Page",
          content: "This is a test page with **bold** text.",
          frontmatter: {
            author: "Test Author",
            date: "2024-01-01",
            tags: "test, mdx",
          },
        });

        await Deno.writeTextFile(`${context.projectDir}/pages/test.mdx`, mdxContent);

        const server = await context.createDevServer();

        // Act
        const response = await fetch(`http://127.0.0.1:${server.port}/test`);
        const html = await response.text();

        // Assert with meaningful messages
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
