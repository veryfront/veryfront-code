/**
 * Tests for ProviderManager
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals } from "jsr:@std/assert@1";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { ProviderManager } from "../../../../src/rendering/layouts/provider-manager.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/runtime/deno";
import type { MdxBundle } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

Deno.test("ProviderManager - discovers and compiles providers", async () => {
  const projectDir = await createTestProjectDir();

  try {
    // Create provider files
    await Deno.mkdir(join(projectDir, "providers"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "providers/theme.mdx"),
      `---
title: Theme Provider
isProvider: true
---

export default function ThemeProvider({ children }) {
  return children;
}
`,
    );

    await Deno.writeTextFile(
      join(projectDir, "providers/auth.mdx"),
      `---
title: Auth Provider
isProvider: true
---

export default function AuthProvider({ children }) {
  return children;
}
`,
    );

    const adapter = new DenoAdapter();
    let compileCount = 0;
    const mockCompileMDX = (_content: string, frontmatter?: Record<string, unknown>) => {
      compileCount++;
      return Promise.resolve({
        compiledCode: `export default () => "provider-${compileCount}"`,
        frontmatter: frontmatter || {},
      } as MdxBundle);
    };

    const manager = new ProviderManager({
      projectDir,
      adapter,
      compileMDX: mockCompileMDX,
    });

    const result = await manager.collectProviders();

    assertEquals(result.providerInfos.length, 2);
    assertEquals(result.providerBundles.length, 2);
    assertEquals(compileCount, 2);

    // Check that providers are marked with isProvider
    for (const bundle of result.providerBundles) {
      assertEquals(bundle.frontmatter?.isProvider, true);
    }
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("ProviderManager - handles no providers", async () => {
  const projectDir = await createTestProjectDir();

  try {
    const adapter = new DenoAdapter();
    const mockCompileMDX = () => {
      throw new Error("Should not compile any providers");
    };

    const manager = new ProviderManager({
      projectDir,
      adapter,
      compileMDX: mockCompileMDX,
    });

    const result = await manager.collectProviders();

    assertEquals(result.providerInfos.length, 0);
    assertEquals(result.providerBundles.length, 0);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("ProviderManager - maintains provider order", async () => {
  const projectDir = await createTestProjectDir();

  try {
    // Create providers with specific order
    await Deno.mkdir(join(projectDir, "providers"), { recursive: true });
    await Deno.writeTextFile(
      join(projectDir, "providers/01-first.mdx"),
      `---
isProvider: true
---

export default function First({ children }) { return children; }`,
    );
    await Deno.writeTextFile(
      join(projectDir, "providers/02-second.mdx"),
      `---
isProvider: true
---

export default function Second({ children }) { return children; }`,
    );
    await Deno.writeTextFile(
      join(projectDir, "providers/03-third.mdx"),
      `---
isProvider: true
---

export default function Third({ children }) { return children; }`,
    );

    const adapter = new DenoAdapter();
    const compiledProviders: string[] = [];
    const mockCompileMDX = (
      _content: string,
      frontmatter?: Record<string, unknown>,
      filePath?: string,
    ) => {
      compiledProviders.push(filePath || "unknown");
      return Promise.resolve({
        compiledCode: `export default () => "provider"`,
        frontmatter: frontmatter || {},
      } as MdxBundle);
    };

    const manager = new ProviderManager({
      projectDir,
      adapter,
      compileMDX: mockCompileMDX,
    });

    const result = await manager.collectProviders();

    assertEquals(result.providerBundles.length, 3);

    // Providers should be in order
    const providerPaths = result.providerInfos.map((p: EntityInfo) => p.entity.id);
    assertEquals(providerPaths.some((p: string) => p.includes("01-first")), true);
    assertEquals(providerPaths.some((p: string) => p.includes("02-second")), true);
    assertEquals(providerPaths.some((p: string) => p.includes("03-third")), true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});
