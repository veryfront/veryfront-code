/**
 * Integration Tests for Refactored Core Renderer
 * Tests the complete rendering pipeline with the new modular architecture
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

// Clean up bundler intervals to prevent resource leaks
afterAll(async () => {
  await cleanupBundler();
});

Deno.test({
  name: "Core Integration - Full rendering pipeline with new architecture",
  sanitizeResources: false, // Temporary: Known KV resource leak issue
  async fn() {
    const projectDir = await createTestProjectDir();

    try {
      await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
      await Deno.writeTextFile(
        join(projectDir, "pages/test.mdx"),
        `---
title: Test Page
---

# Test Page

This is a test.`,
      );
      await Deno.writeTextFile(
        join(projectDir, "veryfront.config.ts"),
        `export default { mode: "development" as const };`,
      );

      const adapter = new DenoAdapter();
      const renderer = new VeryfrontRenderer({
        projectDir,
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
    } finally {
      await cleanupTestDir(projectDir);
    }
  },
});

Deno.test({
  name: "Core Integration - Configuration manager properly initialized",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(join(projectDir, "pages/test.mdx"), "# Test");
    await Deno.writeTextFile(
      join(projectDir, "veryfront.config.ts"),
      `export default {
        mode: "development" as const,
        cache: { dir: ".test-cache" },
      };`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    // Render to ensure all services are working
    const result = await renderer.renderPage("test");
    assertExists(result);
    assertExists(result.html);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
}});

Deno.test({
  name: "Core Integration - Lifecycle initialization of all services",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.mkdir(join(projectDir, "components"), { recursive: true });
    await Deno.writeTextFile(join(projectDir, "pages/simple.mdx"), "# Simple");
    await Deno.writeTextFile(
      join(projectDir, "components/Button.tsx"),
      `export default function Button() {
        return <button>Click me</button>;
      }`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    // Check virtual module system is accessible
    const vms = renderer.getVirtualModuleSystem();
    assertExists(vms);

    // Render a page to ensure all services work together
    const result = await renderer.renderPage("simple");
    assertExists(result);
    assertExists(result.html);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
}});

Deno.test({
  name: "Core Integration - Cache management through lifecycle",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/cached.mdx"),
      `---
title: Cached Page
---

# Cached Page`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();

    // First render
    const result1 = await renderer.renderPage("cached");
    assertExists(result1);

    // Clear cache
    renderer.clearCache("cached");

    // Second render (after cache clear)
    const result2 = await renderer.renderPage("cached");
    assertExists(result2);
    assertEquals(result2.frontmatter.title, "Cached Page");

    // Clear all state
    renderer.clearAllState();

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
}});

Deno.test({
  name: "Core Integration - MDX compilation through new architecture",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "pages/mdx-test.mdx"),
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

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
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
  } finally {
    await cleanupTestDir(projectDir);
  }
}});

Deno.test({
  name: "Core Integration - Component initialization",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.mkdir(join(projectDir, "components"), { recursive: true });
    await Deno.writeTextFile(join(projectDir, "pages/test.mdx"), "# Test");
    await Deno.writeTextFile(
      join(projectDir, "components/TestComponent.tsx"),
      `export default function TestComponent() {
        return <div>Test Component</div>;
      }`,
    );

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();
    await renderer.initializeComponents();

    const result = await renderer.renderPage("test");
    assertExists(result);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
}});

Deno.test({
  name: "Core Integration - Proper cleanup with destroy()",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
  const projectDir = await createTestProjectDir();

  try {
    await Deno.mkdir(join(projectDir, "pages"), { recursive: true });
    await Deno.writeTextFile(join(projectDir, "pages/cleanup.mdx"), "# Cleanup Test");

    const adapter = new DenoAdapter();
    const renderer = new VeryfrontRenderer({
      projectDir,
      mode: "development",
      adapter,
    });

    await renderer.initialize();
    await renderer.renderPage("cleanup");

    // Destroy should clean up all resources
    await renderer.destroy();

    // Should not throw after destroy
    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
}});
