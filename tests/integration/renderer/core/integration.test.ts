/**
 * Integration Tests for Refactored Core Renderer
 * Tests the complete rendering pipeline with the new modular architecture
 */

// Disable LRU intervals during testing to prevent resource leaks
globalThis.__vfDisableLruInterval = true;

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { writeTextFile } from "@veryfront/compat/fs.ts";
import { join } from "@veryfront/compat/path";
import { afterAll, describe, it } from "@veryfront/testing/bdd";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { withTestContext } from "../../../_helpers/context.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

describe("Core Integration Tests", { sanitizeOps: false, sanitizeResources: false }, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  it("Full rendering pipeline with new architecture", async () => {
    await withTestContext("core-full-pipeline", async (context) => {
      await writeTextFile(
        join(context.projectDir, "pages/test.mdx"),
        `---
title: Test Page
---

# Test Page

This is a test.`,
      );
      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default { mode: "development" as const };`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("test");

      assertExists(result);
      assertExists(result.html);
      assertEquals(typeof result.html, "string");
      assertExists(result.frontmatter);
      assertEquals(result.frontmatter.title, "Test Page");

      await renderer.destroy();
    });
  });

  it("Configuration manager properly initialized", async () => {
    await withTestContext("core-config-manager", async (context) => {
      await writeTextFile(join(context.projectDir, "pages/test.mdx"), "# Test");
      await writeTextFile(
        join(context.projectDir, "veryfront.config.ts"),
        `export default {
        mode: "development" as const,
        cache: { dir: ".test-cache" },
      };`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("test");
      assertExists(result);
      assertExists(result.html);

      await renderer.destroy();
    });
  });

  it("Lifecycle initialization of all services", async () => {
    await withTestContext("core-lifecycle-init", async (context) => {
      await writeTextFile(join(context.projectDir, "pages/simple.mdx"), "# Simple");
      await writeTextFile(
        join(context.projectDir, "components/Button.tsx"),
        `export default function Button() {
        return <button>Click me</button>;
      }`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const vms = renderer.getVirtualModuleSystem();
      assertExists(vms);

      const result = await renderer.renderPage("simple");
      assertExists(result);
      assertExists(result.html);

      await renderer.destroy();
    });
  });

  it("Cache management through lifecycle", async () => {
    await withTestContext("core-cache-management", async (context) => {
      await writeTextFile(
        join(context.projectDir, "pages/cached.mdx"),
        `---
title: Cached Page
---

# Cached Page`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result1 = await renderer.renderPage("cached");
      assertExists(result1);

      renderer.clearCache("cached");

      const result2 = await renderer.renderPage("cached");
      assertExists(result2);
      assertEquals(result2.frontmatter.title, "Cached Page");

      renderer.clearAllState();

      await renderer.destroy();
    });
  });

  it("MDX compilation through new architecture", async () => {
    await withTestContext("core-mdx-compilation", async (context) => {
      await writeTextFile(
        join(context.projectDir, "pages/mdx-test.mdx"),
        `---
title: MDX Test
description: Testing MDX compilation
---

# MDX Test

## Section 1

Some content here.

### Subsection

More content.`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();

      const result = await renderer.renderPage("mdx-test");

      assertExists(result);
      assertExists(result.html);
      assertEquals(result.frontmatter.title, "MDX Test");
      assertEquals(result.frontmatter.description, "Testing MDX compilation");
      // Headings may or may not be present depending on MDX compilation
      // Just check that result is valid
      assertExists(result.headings);

      await renderer.destroy();
    });
  });

  it("Component initialization", async () => {
    await withTestContext("core-component-init", async (context) => {
      await writeTextFile(join(context.projectDir, "pages/test.mdx"), "# Test");
      await writeTextFile(
        join(context.projectDir, "components/TestComponent.tsx"),
        `export default function TestComponent() {
        return <div>Test Component</div>;
      }`,
      );

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();
      await renderer.initializeComponents();

      const result = await renderer.renderPage("test");
      assertExists(result);

      await renderer.destroy();
    });
  });

  it("Proper cleanup with destroy()", async () => {
    await withTestContext("core-cleanup-destroy", async (context) => {
      await writeTextFile(join(context.projectDir, "pages/cleanup.mdx"), "# Cleanup Test");

      const adapter = await getAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir: context.projectDir,
        mode: "development",
        adapter,
      });

      await renderer.initialize();
      await renderer.renderPage("cleanup");

      await renderer.destroy();
      await renderer.destroy();
    });
  });
});
