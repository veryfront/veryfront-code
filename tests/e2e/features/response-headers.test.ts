#!/usr/bin/env -S deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys
/**
 * Feature Tests: Response Headers
 *
 * Tests custom response headers in API routes:
 * - Custom headers
 * - Cache-Control headers
 * - CORS headers
 * - Content-Type headers
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { createProject, ensureBinaryCompiled, pages, withServer } from "../setup/index.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";

describe("Feature: Response Headers", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Custom Headers", () => {
    it("should set custom response headers", async () => {
      const projectDir = await createProject(
        "headers-custom",
        pages.basic,
        {
          files: {
            "pages/api/custom-headers.ts": `
export function GET() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "X-Custom-Header": "custom-value",
      "X-App-Request-Id": "req-12345"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/custom-headers`;
        const response = await fetch(url);

        assertEquals(response.headers.get("X-Custom-Header"), "custom-value");
        assertEquals(response.headers.get("X-App-Request-Id"), "req-12345");
      });
    });
  });

  describe("Cache-Control Headers", () => {
    it("should set cache control headers", async () => {
      const projectDir = await createProject(
        "headers-cache",
        pages.basic,
        {
          files: {
            "pages/api/cached-data.ts": `
export function GET() {
  return new Response(JSON.stringify({ data: "cached" }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/cached-data`;
        const response = await fetch(url);
        const cacheControl = response.headers.get("Cache-Control");

        assert(cacheControl !== null, "Should have Cache-Control header");
        assert(cacheControl.includes("max-age=3600"), "Should have max-age");
      });
    });

    it("should set no-cache headers", async () => {
      const projectDir = await createProject(
        "headers-no-cache",
        pages.basic,
        {
          files: {
            "pages/api/dynamic-data.ts": `
export function GET() {
  return new Response(JSON.stringify({ timestamp: Date.now() }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/dynamic-data`;
        const response = await fetch(url);

        assert(
          response.headers.get("Cache-Control")?.includes("no-store"),
          "Should have no-store",
        );
      });
    });
  });

  describe("Content-Type Headers", () => {
    it("should return different content types", async () => {
      const projectDir = await createProject(
        "headers-content-type",
        pages.basic,
        {
          files: {
            "pages/api/text.ts": `
export function GET() {
  return new Response("Hello, World!", {
    headers: { "Content-Type": "text/plain" }
  });
}
`,
            "pages/api/html.ts": `
export function GET() {
  return new Response("<h1>Hello</h1>", {
    headers: { "Content-Type": "text/html" }
  });
}
`,
            "pages/api/xml.ts": `
export function GET() {
  return new Response("<data><item>test</item></data>", {
    headers: { "Content-Type": "application/xml" }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const baseUrl = `http://127.0.0.1:${server.port}`;

        const textRes = await fetch(`${baseUrl}/api/text`);
        assert(
          textRes.headers.get("Content-Type")?.includes("text/plain"),
          "Should be text/plain",
        );

        const htmlRes = await fetch(`${baseUrl}/api/html`);
        assert(
          htmlRes.headers.get("Content-Type")?.includes("text/html"),
          "Should be text/html",
        );

        const xmlRes = await fetch(`${baseUrl}/api/xml`);
        assert(
          xmlRes.headers.get("Content-Type")?.includes("application/xml"),
          "Should be application/xml",
        );
      });
    });
  });

  describe("Redirect Responses", () => {
    it("should handle redirect responses", async () => {
      const projectDir = await createProject(
        "headers-redirect",
        pages.basic,
        {
          files: {
            "pages/api/old-endpoint.ts": `
export function GET() {
  return new Response(null, {
    status: 301,
    headers: { "Location": "/api/new-endpoint" }
  });
}
`,
            "pages/api/new-endpoint.ts": `
export function GET() {
  return Response.json({ message: "New endpoint" });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/old-endpoint`;
        const response = await fetch(url, { redirect: "manual" });

        assertEquals(response.status, 301);
        assert(
          response.headers.get("Location")?.includes("/api/new-endpoint"),
          "Should have Location header",
        );
      });
    });

    it("should handle temporary redirects", async () => {
      const projectDir = await createProject(
        "headers-redirect-temp",
        pages.basic,
        {
          files: {
            "pages/api/maintenance.ts": `
export function GET() {
  return new Response(null, {
    status: 302,
    headers: { "Location": "/maintenance.html" }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/maintenance`;
        const response = await fetch(url, { redirect: "manual" });

        assertEquals(response.status, 302);
      });
    });
  });

  describe("Security Headers", () => {
    it("should set security headers", async () => {
      const projectDir = await createProject(
        "headers-security",
        pages.basic,
        {
          files: {
            "pages/api/secure.ts": `
export function GET() {
  return new Response(JSON.stringify({ secure: true }), {
    headers: {
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
    }
  });
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const url = `http://127.0.0.1:${server.port}/api/secure`;
        const response = await fetch(url);

        assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
        assertEquals(response.headers.get("X-Frame-Options"), "DENY");
      });
    });
  });
});
