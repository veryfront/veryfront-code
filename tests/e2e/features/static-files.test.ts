#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: Static Files
 *
 * Tests that static files from the public directory work correctly:
 * - Serving images, SVGs, and other assets
 * - robots.txt and favicon.ico
 * - MIME types
 * - 404 for non-existent static files
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertNotFound,
  assertOk,
  createProject,
  ensureBinaryCompiled,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";
import { assert, assertStringIncludes } from "#veryfront/testing/assert.ts";

describe("Feature: Static Files", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("SVG Files", () => {
    it("should serve SVG files from public directory", async () => {
      const projectDir = await createProject(
        "static-svg",
        pages.basic,
        {
          files: {
            "public/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
              <circle cx="50" cy="50" r="40" fill="blue"/>
            </svg>`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/logo.svg");

        assertOk(response);
        assertStringIncludes(html, "<svg");
        assertStringIncludes(html, "circle");
      });
    });
  });

  describe("Text Files", () => {
    it("should serve robots.txt", async () => {
      const projectDir = await createProject(
        "static-robots",
        pages.basic,
        {
          files: {
            "public/robots.txt": `User-agent: *\nAllow: /\nDisallow: /admin/`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/robots.txt");

        assertOk(response);
        assertStringIncludes(html, "User-agent");
        assertStringIncludes(html, "Disallow: /admin/");
      });
    });

    it("should serve sitemap.xml", async () => {
      const projectDir = await createProject(
        "static-sitemap",
        pages.basic,
        {
          files: {
            "public/sitemap.xml": `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
</urlset>`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/sitemap.xml");

        assertOk(response);
        assertStringIncludes(html, "urlset");
        assertStringIncludes(html, "example.com");
      });
    });
  });

  describe("JSON Files", () => {
    it("should serve JSON files", async () => {
      const projectDir = await createProject(
        "static-json",
        pages.basic,
        {
          files: {
            "public/manifest.json": JSON.stringify({
              name: "Test App",
              short_name: "Test",
              start_url: "/",
            }),
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/manifest.json");

        assertOk(response);
        const json = JSON.parse(html);
        assert(json.name === "Test App", "Should parse JSON correctly");
      });
    });
  });

  describe("Nested Static Files", () => {
    it("should serve files in nested directories", async () => {
      const projectDir = await createProject(
        "static-nested",
        pages.basic,
        {
          files: {
            "public/images/icons/favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><rect width="16" height="16" fill="red"/></svg>`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/images/icons/favicon.svg");

        assertOk(response);
        assertStringIncludes(html, "rect");
      });
    });
  });

  describe("404 for Missing Files", () => {
    it("should return 404 for non-existent static files", async () => {
      const projectDir = await createProject("static-404", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/nonexistent.png");
        assertNotFound(response);
      });
    });
  });
});
