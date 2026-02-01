/**
 * Unit tests for components/layout.* discovery functionality.
 *
 * These tests verify the pure function `discoverComponentsLayoutPath`
 * which can be tested without mocking the full adapter.
 */

import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  discoverComponentsLayoutPath,
  type FileExistenceChecker,
} from "../../../../src/rendering/layouts/layout-collector.ts";
import { LAYOUT_EXTENSIONS } from "../../../../src/rendering/layouts/types.ts";

function createMockChecker(existingPaths: Set<string>): FileExistenceChecker {
  return {
    exists: (path: string) => Promise.resolve(existingPaths.has(path)),
  };
}

describe("discoverComponentsLayoutPath", () => {
  const projectDir = "/project";

  it("should return null when no layout file exists", async () => {
    const result = await discoverComponentsLayoutPath(
      projectDir,
      createMockChecker(new Set()),
    );

    assertEquals(result, null, "Should return null when no layout exists");
  });

  for (const ext of LAYOUT_EXTENSIONS) {
    it(`should find layout.${ext} file`, async () => {
      const expectedPath = `${projectDir}/components/layout.${ext}`;
      const result = await discoverComponentsLayoutPath(
        projectDir,
        createMockChecker(new Set([expectedPath])),
      );

      assertEquals(result, expectedPath, `Should find layout.${ext}`);
    });
  }

  it("should prefer mdx over tsx when both exist (due to extension order)", async () => {
    const checker = createMockChecker(
      new Set([
        "/project/components/layout.tsx",
        "/project/components/layout.mdx",
      ]),
    );

    const result = await discoverComponentsLayoutPath(projectDir, checker);

    assertEquals(
      result,
      "/project/components/layout.mdx",
      "Should prefer mdx (first in extension order)",
    );
  });

  it("should prefer md over tsx when both exist", async () => {
    const checker = createMockChecker(
      new Set([
        "/project/components/layout.tsx",
        "/project/components/layout.md",
      ]),
    );

    const result = await discoverComponentsLayoutPath(projectDir, checker);

    assertEquals(
      result,
      "/project/components/layout.md",
      "Should prefer md over tsx",
    );
  });

  it("should prefer tsx over jsx when both exist", async () => {
    const checker = createMockChecker(
      new Set([
        "/project/components/layout.tsx",
        "/project/components/layout.jsx",
      ]),
    );

    const result = await discoverComponentsLayoutPath(projectDir, checker);

    assertEquals(
      result,
      "/project/components/layout.tsx",
      "Should prefer tsx over jsx",
    );
  });

  it("should work with different project directories", async () => {
    const customProjectDir = "/custom/path/to/project";
    const expectedPath = `${customProjectDir}/components/layout.tsx`;

    const result = await discoverComponentsLayoutPath(
      customProjectDir,
      createMockChecker(new Set([expectedPath])),
    );

    assertEquals(
      result,
      expectedPath,
      "Should work with custom project directory",
    );
  });

  it("should not find files in wrong locations", async () => {
    const checker = createMockChecker(
      new Set([
        "/project/layout.tsx",
        "/project/src/components/layout.tsx",
        "/project/components/layouts/layout.tsx",
      ]),
    );

    const result = await discoverComponentsLayoutPath(projectDir, checker);

    assertEquals(
      result,
      null,
      "Should not find layout files in incorrect locations",
    );
  });

  it("should handle checker that always returns false", async () => {
    const checker: FileExistenceChecker = {
      exists: () => Promise.resolve(false),
    };

    const result = await discoverComponentsLayoutPath(projectDir, checker);

    assertEquals(
      result,
      null,
      "Should return null when checker always returns false",
    );
  });

  it("should respect the defined extension order", async () => {
    const expectedOrder = ["mdx", "md", "tsx", "jsx", "ts", "js"];
    assertEquals(
      [...LAYOUT_EXTENSIONS],
      expectedOrder,
      "LAYOUT_EXTENSIONS should have the expected order",
    );
  });
});

describe("FileExistenceChecker interface", () => {
  it("should allow async exists implementation", async () => {
    const asyncChecker: FileExistenceChecker = {
      exists: async (path: string) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return path === "/project/components/layout.tsx";
      },
    };

    const result = await discoverComponentsLayoutPath("/project", asyncChecker);

    assertEquals(
      result,
      "/project/components/layout.tsx",
      "Should work with async checker",
    );
  });

  it("should allow tracking of checked paths", async () => {
    const checkedPaths: string[] = [];
    const trackingChecker: FileExistenceChecker = {
      exists: async (path: string) => {
        checkedPaths.push(path);
        return false;
      },
    };

    await discoverComponentsLayoutPath("/project", trackingChecker);

    assertEquals(
      checkedPaths.length,
      LAYOUT_EXTENSIONS.length,
      "Should check all extensions when none exist",
    );

    for (const ext of LAYOUT_EXTENSIONS) {
      const expectedPath = `/project/components/layout.${ext}`;
      assertEquals(
        checkedPaths.includes(expectedPath),
        true,
        `Should have checked ${expectedPath}`,
      );
    }
  });

  it("should stop checking after finding first match", async () => {
    const checkedPaths: string[] = [];
    const trackingChecker: FileExistenceChecker = {
      exists: async (path: string) => {
        checkedPaths.push(path);
        return path === "/project/components/layout.mdx";
      },
    };

    const result = await discoverComponentsLayoutPath("/project", trackingChecker);

    assertEquals(result, "/project/components/layout.mdx");
    assertEquals(
      checkedPaths.length,
      1,
      "Should stop after finding first match (mdx is first)",
    );
  });
});
