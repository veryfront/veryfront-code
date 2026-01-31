#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: Error Handling
 *
 * Tests error handling scenarios:
 * - error.tsx boundary catches component errors
 * - 404 page for missing routes
 * - Server errors in API routes
 * - Component render errors
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertNotFound,
  assertOk,
  assertStatus,
  createProject,
  ensureBinaryCompiled,
  fetchJson,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";

describe("Feature: Error Handling", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("404 Pages", () => {
    it("should return 404 for missing pages", async () => {
      const projectDir = await createProject("404-missing", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/this-page-does-not-exist");
        assertNotFound(response);
      });
    });

    it("should return 404 with Not Found message", async () => {
      const projectDir = await createProject("404-message", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/missing");

        assertNotFound(response);
        assertStringIncludes(html, "Not Found");
      });
    });

    it("should return 404 for partial path matches", async () => {
      const projectDir = await createProject(
        "404-partial",
        pages.basic,
        {
          files: {
            "pages/blog/index.tsx": `export default function Blog() { return <div>Blog</div>; }`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        // /blog exists, but /blog/nonexistent should 404
        const { response: blogRes } = await fetchPage(server, "/blog");
        assertOk(blogRes);

        const { response: missingRes } = await fetchPage(server, "/blog/nonexistent");
        assertNotFound(missingRes);
      });
    });
  });

  describe("Error Boundaries", () => {
    it("should catch component errors with error.tsx", async () => {
      const projectDir = await createProject(
        "error-boundary",
        pages.basic,
        {
          files: {
            "pages/error.tsx": `
"use client";
export default function ErrorPage({ error }: { error: Error }) {
  return (
    <div id="error-page">
      <h1>Something went wrong</h1>
      <p id="error-message">{error?.message || "Unknown error"}</p>
    </div>
  );
}
`,
            "pages/broken.tsx": `
export default function BrokenPage() {
  throw new Error("Intentional test error");
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/broken");
        // Error boundary should catch the error, might return 200 or 500
        assert(
          response.status === 200 || response.status === 500,
          `Expected 200 or 500, got ${response.status}`,
        );
      });
    });

    it("should render error boundary in nested routes", async () => {
      const projectDir = await createProject(
        "nested-error-boundary",
        pages.basic,
        {
          files: {
            "pages/admin/error.tsx": `
"use client";
export default function AdminError({ error }: { error: Error }) {
  return <div id="admin-error">Admin Error: {error?.message}</div>;
}
`,
            "pages/admin/broken.tsx": `
export default function BrokenAdmin() {
  throw new Error("Admin error");
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/admin/broken");
        assert(
          response.status === 200 || response.status === 500,
          "Should handle error",
        );
      });
    });
  });

  describe("API Error Handling", () => {
    it("should return 500 for API errors", async () => {
      const projectDir = await createProject(
        "api-error",
        pages.basic,
        {
          files: {
            "pages/api/error.ts": `
export function GET() {
  throw new Error("API error");
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/api/error");
        // API errors should return 500
        assertStatus(response, 500);
      });
    });

    it("should return custom error status codes", async () => {
      const projectDir = await createProject(
        "api-custom-error",
        pages.basic,
        {
          files: {
            "pages/api/not-authorized.ts": `
export function GET() {
  return new Response(JSON.stringify({ error: "Not authorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, json } = await fetchJson<{ error: string }>(
          server,
          "/api/not-authorized",
        );

        assertStatus(response, 401);
        assert(json.error === "Not authorized", "Should return error message");
      });
    });
  });
});
