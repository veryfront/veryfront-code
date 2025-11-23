/**
 * Tests for LayoutCompiler
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { LayoutCompiler } from "../../../../src/rendering/layouts/layout-compiler.ts";
import { DenoAdapter } from "@veryfront/platform/adapters/deno.ts";
import type { LayoutItem, MdxBundle } from "@veryfront/types";
import type { EntityInfo } from "@veryfront/types";
import { cleanupTestDir, createTestProjectDir } from "../../../_helpers/server.ts";

Deno.test("LayoutCompiler - compiles MDX layouts", async () => {
  const projectDir = await createTestProjectDir();

  try {
    // Create layout file
    const layoutPath = join(projectDir, "layouts/test.mdx");
    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(layoutPath, "# Test Layout\n\n<slot />");

    const layouts: LayoutItem[] = [
      {
        kind: "mdx",
        path: layoutPath,
      },
    ];

    const adapter = new DenoAdapter();
    let compileCount = 0;
    const mockCompileMDX = (_content: string, frontmatter?: Record<string, unknown>) => {
      compileCount++;
      return Promise.resolve({
        compiledCode: `export default () => "compiled-${compileCount}"`,
        frontmatter: frontmatter || {},
      } as MdxBundle);
    };

    const compiler = new LayoutCompiler({
      adapter,
      compileMDX: mockCompileMDX,
    });

    await compiler.compileLayouts(layouts);

    assertEquals(compileCount, 1);
    assertExists(layouts[0]?.bundle);
    assertEquals(layouts[0]?.bundle?.frontmatter?.isLayout, true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("LayoutCompiler - skips TSX layouts", async () => {
  const projectDir = await createTestProjectDir();

  try {
    const layouts: LayoutItem[] = [
      {
        kind: "tsx",
        componentPath: join(projectDir, "layouts/test.tsx"),
        path: join(projectDir, "layouts/test.tsx"),
      },
    ];

    const adapter = new DenoAdapter();
    const mockCompileMDX = () => {
      throw new Error("Should not compile TSX layouts");
    };

    const compiler = new LayoutCompiler({
      adapter,
      compileMDX: mockCompileMDX,
    });

    // Should not throw
    await compiler.compileLayouts(layouts);

    assertEquals(layouts[0]?.bundle, undefined);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("LayoutCompiler - computes dependency hash", async () => {
  const projectDir = await createTestProjectDir();

  try {
    // Create layout file
    const layoutPath = join(projectDir, "layouts/test.mdx");
    await Deno.mkdir(join(projectDir, "layouts"), { recursive: true });
    await Deno.writeTextFile(layoutPath, "# Test Layout");

    const layoutBundle: MdxBundle = {
      compiledCode: "export default () => 'layout'",
      frontmatter: {},
    };

    const nestedLayouts: LayoutItem[] = [
      {
        kind: "mdx",
        path: layoutPath,
        bundle: {
          compiledCode: "export default () => 'nested'",
          frontmatter: {},
        },
      },
    ];

    const providerInfos: EntityInfo[] = [
      {
        entity: {
          id: join(projectDir, "providers/test.mdx"),
          slug: "test",
          type: "provider",
          content: "# Provider",
          frontmatter: {},
        },
      },
    ];

    const adapter = new DenoAdapter();
    const compiler = new LayoutCompiler({
      adapter,
      // deno-lint-ignore require-await
      compileMDX: async () => layoutBundle,
    });

    const hash = await compiler.computeDependencyHash(
      layoutBundle,
      nestedLayouts,
      providerInfos,
    );

    assertExists(hash);
    assertEquals(typeof hash, "string");
    assertEquals(hash.length > 0, true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});

Deno.test("LayoutCompiler - dependency hash changes with content", async () => {
  const projectDir = await createTestProjectDir();

  try {
    const layoutBundle1: MdxBundle = {
      compiledCode: "export default () => 'layout1'",
      frontmatter: {},
    };

    const layoutBundle2: MdxBundle = {
      compiledCode: "export default () => 'layout2'",
      frontmatter: {},
    };

    const adapter = new DenoAdapter();
    const compiler = new LayoutCompiler({
      adapter,
      // deno-lint-ignore require-await
      compileMDX: async () => layoutBundle1,
    });

    const hash1 = await compiler.computeDependencyHash(layoutBundle1, [], []);
    const hash2 = await compiler.computeDependencyHash(layoutBundle2, [], []);

    assertEquals(hash1 !== hash2, true);
  } finally {
    await cleanupTestDir(projectDir);
  }
});
