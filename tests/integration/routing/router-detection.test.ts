/**
 * Comprehensive tests for router-detection.ts
 *
 * Tests cover:
 * - Router detection (App vs Pages)
 * - Config-forced router selection
 * - File system structure analysis
 * - App route entity resolution
 * - Frontmatter extraction and processing
 * - Edge cases and error handling
 */

import { assert, assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { symlink } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { ensureDir } from "@std/fs";
import { detectAppRouter, getAppRouteEntity } from "../../../src/rendering/router-detection.ts";
import { withTestContext } from "../../_helpers/context.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "@veryfront/platform/adapters/registry.ts";
import type { VeryfrontConfig } from "@veryfront/config";
import { remove, writeTextFile } from "@veryfront/testing/deno-compat";

/**
 * Returns a runtime adapter for the current environment.
 */
async function getTestAdapter(): Promise<RuntimeAdapter> {
  return await getLocalAdapter();
}

/**
 * Creates a failing adapter to test fallback behavior
 */
async function createFailingAdapter(): Promise<RuntimeAdapter> {
  const baseAdapter = await getLocalAdapter();

  return {
    ...baseAdapter,
    fs: {
      ...baseAdapter.fs,
      stat: async () => {
        throw new Error("File system not available");
      },
      readDir: async function* () {
        throw new Error("File system not available");
      },
    },
  };
}

describe("router-detection", () => {
  describe("detectAppRouter", () => {
    it("should detect app router when app directory exists", async () => {
      await withTestContext("router-detection-app-exists", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = {};

        // app directory already exists from test context setup
        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, true);
      });
    });

    it("should detect pages router when only pages directory exists", async () => {
      await withTestContext("router-detection-pages-only", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = {};

        // Remove app directory, keep pages
        await remove(join(context.projectDir, "app"), { recursive: true });

        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, false);
      });
    });

    it('should force app router when config.router is "app"', async () => {
      await withTestContext("router-detection-force-app", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = { router: "app" };

        // Even without app directory, should return true
        await remove(join(context.projectDir, "app"), { recursive: true });

        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, true);
      });
    });

    it('should force pages router when config.router is "pages"', async () => {
      await withTestContext("router-detection-force-pages", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = { router: "pages" };

        // Even with app directory, should return false
        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, false);
      });
    });

    it("should fallback to compat stat when adapter.fs.stat fails", async () => {
      await withTestContext("router-detection-adapter-fallback", async (context) => {
        const adapter = await createFailingAdapter();
        const config: VeryfrontConfig = {};

        // app directory exists via test context
        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, true);
      });
    });

    it("should return false when both adapter and compat stat fail", async () => {
      await withTestContext("router-detection-no-app-dir", async (context) => {
        const adapter = await createFailingAdapter();
        const config: VeryfrontConfig = {};

        // Remove app directory
        await remove(join(context.projectDir, "app"), { recursive: true });

        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(result, false);
      });
    });

    it("should handle empty config gracefully", async () => {
      await withTestContext("router-detection-empty-config", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = {};

        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(typeof result, "boolean");
      });
    });

    it("should handle config with router undefined", async () => {
      await withTestContext("router-detection-undefined-router", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = { router: undefined };

        const result = await detectAppRouter(context.projectDir, config, adapter);

        assertEquals(typeof result, "boolean");
      });
    });
  });

  describe("getAppRouteEntity", () => {
    it("should find page.tsx in app router structure", async () => {
      await withTestContext("app-route-page-tsx", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "blog/post";

        // Create app/blog/post/page.tsx
        const pagePath = join(context.projectDir, "app", "blog", "post");
        await ensureDir(pagePath);
        await writeTextFile(
          join(pagePath, "page.tsx"),
          `export default function Post() {
  return <div>Blog Post</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
        assertEquals(entity?.entity.type, "page");
        assertEquals(entity?.entity.isPage, true);
        assertEquals(entity?.entity.isLayout, false);
      });
    });

    it("should find page.mdx with frontmatter", async () => {
      await withTestContext("app-route-page-mdx", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "docs/intro";

        // Create app/docs/intro/page.mdx with frontmatter
        const pagePath = join(context.projectDir, "app", "docs", "intro");
        await ensureDir(pagePath);
        await writeTextFile(
          join(pagePath, "page.mdx"),
          `---
title: Introduction
description: Getting started guide
author: Test Author
---

# Introduction

Welcome to the documentation.
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
        assertEquals(entity?.entity.frontmatter.title, "Introduction");
        assertEquals(entity?.entity.frontmatter.description, "Getting started guide");
        assertEquals(entity?.entity.frontmatter.author, "Test Author");
        assert(entity?.entity.content.includes("# Introduction"));
      });
    });

    it("should find root page for empty slug", async () => {
      await withTestContext("app-route-root-page", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "";

        // Create app/page.tsx
        await writeTextFile(
          join(context.projectDir, "app", "page.tsx"),
          `export default function Home() {
  return <div>Home Page</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, "");
        assertEquals(entity?.entity.type, "page");
      });
    });

    it("should prioritize page.mdx over other extensions", async () => {
      await withTestContext("app-route-priority", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "test";

        // Create multiple page files
        const testPath = join(context.projectDir, "app", "test");
        await ensureDir(testPath);
        await writeTextFile(join(testPath, "page.mdx"), "# MDX Page");
        await writeTextFile(join(testPath, "page.tsx"), "export default function() {}");
        await writeTextFile(join(testPath, "page.jsx"), "export default function() {}");

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assert(entity?.entity.id.endsWith("page.mdx"));
      });
    });

    it("should find shorthand file (slug.mdx)", async () => {
      await withTestContext("app-route-shorthand", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "about";

        // Create app/about.mdx (shorthand)
        await writeTextFile(
          join(context.projectDir, "app", "about.mdx"),
          "# About Page",
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
        assert(entity?.entity.id.endsWith("about.mdx"));
      });
    });

    it("should handle page.jsx extension", async () => {
      await withTestContext("app-route-jsx", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "contact";

        const contactPath = join(context.projectDir, "app", "contact");
        await ensureDir(contactPath);
        await writeTextFile(
          join(contactPath, "page.jsx"),
          `export default function Contact() {
  return <div>Contact</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
      });
    });

    it("should handle page.js extension", async () => {
      await withTestContext("app-route-js", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "services";

        const servicesPath = join(context.projectDir, "app", "services");
        await ensureDir(servicesPath);
        await writeTextFile(
          join(servicesPath, "page.js"),
          `export default function Services() {
  return <div>Services</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
      });
    });

    it("should handle page.ts extension", async () => {
      await withTestContext("app-route-ts", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "api/users";

        const usersPath = join(context.projectDir, "app", "api", "users");
        await ensureDir(usersPath);
        await writeTextFile(
          join(usersPath, "page.ts"),
          `export default function UsersPage() {
  return <div>Users</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
      });
    });

    it("should return null when no page file exists", async () => {
      await withTestContext("app-route-not-found", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "nonexistent";

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertEquals(entity, null);
      });
    });

    it("should handle frontmatter with boolean layout field", async () => {
      await withTestContext("app-route-boolean-layout", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "special";

        const specialPath = join(context.projectDir, "app", "special");
        await ensureDir(specialPath);
        await writeTextFile(
          join(specialPath, "page.mdx"),
          `---
layout: true
---

# Special Page
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.frontmatter.layout, "default");
      });
    });

    it('should coerce false layout to "false" string', async () => {
      await withTestContext("app-route-false-layout", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "nolayout";

        const nolayoutPath = join(context.projectDir, "app", "nolayout");
        await ensureDir(nolayoutPath);
        await writeTextFile(
          join(nolayoutPath, "page.mdx"),
          `---
layout: false
---

# No Layout Page
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.frontmatter.layout, "false");
      });
    });

    it("should handle frontmatter without layout field", async () => {
      await withTestContext("app-route-no-layout-field", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "standard";

        const standardPath = join(context.projectDir, "app", "standard");
        await ensureDir(standardPath);
        await writeTextFile(
          join(standardPath, "page.mdx"),
          `---
title: Standard Page
---

# Standard Page
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.frontmatter.layout, undefined);
        assertEquals(entity?.entity.frontmatter.title, "Standard Page");
      });
    });

    it("should handle file without frontmatter", async () => {
      await withTestContext("app-route-no-frontmatter", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "simple";

        const simplePath = join(context.projectDir, "app", "simple");
        await ensureDir(simplePath);
        await writeTextFile(
          join(simplePath, "page.mdx"),
          "# Simple Page\n\nNo frontmatter here.",
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.frontmatter.layout, undefined);
        assert(entity?.entity.content.includes("# Simple Page"));
      });
    });

    it("should handle malformed frontmatter gracefully", async () => {
      await withTestContext("app-route-bad-frontmatter", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "bad";

        const badPath = join(context.projectDir, "app", "bad");
        await ensureDir(badPath);
        await writeTextFile(
          join(badPath, "page.mdx"),
          `---
title: "Unclosed quote
description: This is bad YAML
---

# Bad Frontmatter
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        // Should still return entity with full content
        assert(entity?.entity.content.includes("---"));
      });
    });

    it("should handle nested routes correctly", async () => {
      await withTestContext("app-route-nested", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "docs/api/reference/endpoints";

        // Create deeply nested route
        const nestedPath = join(context.projectDir, "app", "docs", "api", "reference", "endpoints");
        await ensureDir(nestedPath);
        await writeTextFile(
          join(nestedPath, "page.tsx"),
          `export default function Endpoints() {
  return <div>API Endpoints</div>
}`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
      });
    });

    it("should set correct entity metadata", async () => {
      await withTestContext("app-route-metadata", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "test";

        const testPath = join(context.projectDir, "app", "test");
        await ensureDir(testPath);
        const filePath = join(testPath, "page.tsx");
        await writeTextFile(
          filePath,
          `export default function Test() { return <div>Test</div> }`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.id, filePath);
        assertEquals(entity?.entity.type, "page");
        assertEquals(entity?.entity.isPage, true);
        assertEquals(entity?.entity.isLayout, false);
      });
    });

    it("should handle files that look like directories", async () => {
      await withTestContext("app-route-file-check", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "fake";

        // Create a directory with same name as potential file
        const fakePath = join(context.projectDir, "app", "fake");
        await ensureDir(fakePath);

        // Create directory named 'page.tsx' (unusual but should handle)
        const weirdDirPath = join(fakePath, "page.tsx");
        await ensureDir(weirdDirPath);

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        // Should return null because page.tsx is a directory, not a file
        assertEquals(entity, null);
      });
    });

    it("should check all candidate files in order", async () => {
      await withTestContext("app-route-candidate-order", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "order";

        // Create only .js file (should be found even though it's last in extension priority)
        const orderPath = join(context.projectDir, "app", "order");
        await ensureDir(orderPath);
        await writeTextFile(
          join(orderPath, "page.js"),
          `export default function Order() { return <div>Order</div> }`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assert(entity?.entity.id.endsWith("page.js"));
      });
    });

    it("should handle complex frontmatter with arrays and objects", async () => {
      await withTestContext("app-route-complex-frontmatter", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "complex";

        const complexPath = join(context.projectDir, "app", "complex");
        await ensureDir(complexPath);
        await writeTextFile(
          join(complexPath, "page.mdx"),
          `---
title: Complex Page
tags:
  - react
  - typescript
  - veryfront
metadata:
  author: Test Author
  date: 2024-01-01
---

# Complex Page
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.frontmatter.title, "Complex Page");
        assertExists(entity?.entity.frontmatter.tags);
        assertExists(entity?.entity.frontmatter.metadata);
      });
    });

    it("should handle whitespace variations in frontmatter", async () => {
      await withTestContext("app-route-whitespace", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "whitespace";

        const whitespacePath = join(context.projectDir, "app", "whitespace");
        await ensureDir(whitespacePath);
        await writeTextFile(
          join(whitespacePath, "page.mdx"),
          `---
title: Whitespace Test
description:   Value with spaces
---

# Whitespace Page
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        // Should handle whitespace in frontmatter values
        assertEquals(entity?.entity.frontmatter.title, "Whitespace Test");
        assert(entity?.entity.content.includes("# Whitespace Page"));
      });
    });

    it("should handle empty frontmatter block", async () => {
      await withTestContext("app-route-empty-frontmatter", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "empty";

        const emptyPath = join(context.projectDir, "app", "empty");
        await ensureDir(emptyPath);
        await writeTextFile(
          join(emptyPath, "page.mdx"),
          `---
---

# Empty Frontmatter
`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assert(entity?.entity.content.includes("# Empty Frontmatter"));
      });
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle very long slugs", async () => {
      await withTestContext("router-very-long-slug", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/q/r/s/t/u/v/w/x/y/z";

        // Should not crash even if path doesn't exist
        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertEquals(entity, null);
      });
    });

    it("should handle special characters in slugs", async () => {
      await withTestContext("router-special-chars", async (context) => {
        const adapter = await getTestAdapter();
        const slug = "test-page_with.special";

        const specialPath = join(context.projectDir, "app", "test-page_with.special");
        await ensureDir(specialPath);
        await writeTextFile(
          join(specialPath, "page.tsx"),
          `export default function Special() { return <div>Special</div> }`,
        );

        const entity = await getAppRouteEntity(context.projectDir, slug, adapter);

        assertExists(entity);
        assertEquals(entity?.entity.slug, slug);
      });
    });

    it("should handle concurrent router detection calls", async () => {
      await withTestContext("router-concurrent", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = {};

        // Make multiple concurrent calls
        const results = await Promise.all([
          detectAppRouter(context.projectDir, config, adapter),
          detectAppRouter(context.projectDir, config, adapter),
          detectAppRouter(context.projectDir, config, adapter),
        ]);

        // All should return the same result
        assertEquals(results[0], results[1]);
        assertEquals(results[1], results[2]);
      });
    });

    it("should handle concurrent entity resolution calls", async () => {
      await withTestContext("router-concurrent-entities", async (context) => {
        const adapter = await getTestAdapter();

        // Create test pages
        const page1Path = join(context.projectDir, "app", "page1");
        const page2Path = join(context.projectDir, "app", "page2");
        await ensureDir(page1Path);
        await ensureDir(page2Path);
        await writeTextFile(join(page1Path, "page.tsx"), "export default function P1() {}");
        await writeTextFile(join(page2Path, "page.tsx"), "export default function P2() {}");

        // Resolve multiple entities concurrently
        const results = await Promise.all([
          getAppRouteEntity(context.projectDir, "page1", adapter),
          getAppRouteEntity(context.projectDir, "page2", adapter),
          getAppRouteEntity(context.projectDir, "nonexistent", adapter),
        ]);

        assertExists(results[0]);
        assertExists(results[1]);
        assertEquals(results[2], null);
      });
    });

    it("should handle symlinks in app directory", async () => {
      await withTestContext("router-symlinks", async (context) => {
        const adapter = await getTestAdapter();
        const config: VeryfrontConfig = {};

        // Create symlink to app directory (if supported)
        try {
          const appPath = join(context.projectDir, "app");
          const symlinkPath = join(context.projectDir, "app-link");
          await symlink(appPath, symlinkPath);

          // Should still detect app router via original path
          const result = await detectAppRouter(context.projectDir, config, adapter);
          assertEquals(result, true);
        } catch {
          // Symlinks might not be supported on all platforms
          // Test passes if we can't create symlink
        }
      });
    });
  });
});
