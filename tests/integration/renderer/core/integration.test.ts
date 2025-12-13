
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals, assertExists } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { afterAll } from "std/testing/bdd.ts";
import { VeryfrontRenderer } from "../../../../src/rendering/orchestrator/ssr.ts";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { cleanupBundler } from "../../../../src/rendering/cleanup.ts";

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

Deno.test("Core Integration - Configuration manager properly initialized", async () => {
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

    const result = await renderer.renderPage("test");
    assertExists(result);
    assertExists(result.html);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Core Integration - Lifecycle initialization of all services", async () => {
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

    const vms = renderer.getVirtualModuleSystem();
    assertExists(vms);

    const result = await renderer.renderPage("simple");
    assertExists(result);
    assertExists(result.html);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Core Integration - Cache management through lifecycle", async () => {
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

    const result1 = await renderer.renderPage("cached");
    assertExists(result1);

    renderer.clearCache("cached");

    const result2 = await renderer.renderPage("cached");
    assertExists(result2);
    assertEquals(result2.frontmatter.title, "Cached Page");

    renderer.clearAllState();

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Core Integration - MDX compilation through new architecture", async () => {
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
    assertExists(result.headings);

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("Core Integration - Component initialization", async () => {
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
});

Deno.test("Core Integration - Proper cleanup with destroy()", async () => {
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

    await renderer.destroy();

    await renderer.destroy();
  } finally {
    await cleanupTestDir(projectDir);
  }
});
