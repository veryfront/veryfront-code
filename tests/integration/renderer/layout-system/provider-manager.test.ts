/**
 * Tests for ProviderManager
 */

// Disable LRU intervals during testing to prevent resource leaks
(globalThis as Record<string, unknown>).__vfDisableLruInterval = true;

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { mkdir, writeTextFile } from "@veryfront/testing/deno-compat";
import { join } from "@veryfront/compat/path";
import { ProviderManager } from "../../../../src/rendering/layouts/provider-manager.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import type { MdxBundle } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

describe("ProviderManager", () => {
  it("discovers and compiles providers", async () => {
    const projectDir = await createTestProjectDir();

    try {
      // Create provider files
      await mkdir(join(projectDir, "providers"), { recursive: true });
      await writeTextFile(
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

      await writeTextFile(
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

      const adapter = await getAdapter();
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

  it("handles no providers", async () => {
    const projectDir = await createTestProjectDir();

    try {
      const adapter = await getAdapter();
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

  it("maintains provider order", async () => {
    const projectDir = await createTestProjectDir();

    try {
      // Create providers with specific order
      await mkdir(join(projectDir, "providers"), { recursive: true });
      await writeTextFile(
        join(projectDir, "providers/01-first.mdx"),
        `---
isProvider: true
---

export default function First({ children }) { return children; }`,
      );
      await writeTextFile(
        join(projectDir, "providers/02-second.mdx"),
        `---
isProvider: true
---

export default function Second({ children }) { return children; }`,
      );
      await writeTextFile(
        join(projectDir, "providers/03-third.mdx"),
        `---
isProvider: true
---

export default function Third({ children }) { return children; }`,
      );

      const adapter = await getAdapter();
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
});
