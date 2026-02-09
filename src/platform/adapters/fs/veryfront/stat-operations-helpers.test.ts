import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import {
  collectParentDirectories,
  normalizeIndexedFilePath,
  resolveByExtensionPriority,
  resolveIndexByExtensionPriority,
  sortPathsByExtensionPriority,
  stripKnownExtension,
} from "./stat-operations-helpers.ts";

function makeFile(path: string, type: ProjectFile["type"] = "component"): ProjectFile {
  return {
    id: crypto.randomUUID(),
    path,
    type,
    size: 0,
    updated_at: new Date().toISOString(),
  } as ProjectFile;
}

describe("veryfront/stat-operations-helpers", () => {
  it("normalizes trailing slash paths to index files", () => {
    assertEquals(normalizeIndexedFilePath(makeFile("pages/blog/", "page")), {
      normalizedPath: "pages/blog/index.mdx",
      originalPath: "pages/blog/",
    });
    assertEquals(normalizeIndexedFilePath(makeFile("components/ui/", "component")), {
      normalizedPath: "components/ui/index.tsx",
      originalPath: "components/ui/",
    });
  });

  it("collects parent directory paths", () => {
    assertEquals(collectParentDirectories("src/components/ui/Button.tsx"), [
      "src",
      "src/components",
      "src/components/ui",
    ]);
  });

  it("strips only known extensions", () => {
    const order = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
    assertEquals(stripKnownExtension("pages/index.tsx", order), "pages/index");
    assertEquals(stripKnownExtension("pages/index.unknown", order), "pages/index.unknown");
  });

  it("resolves direct and index matches by extension priority", () => {
    const order = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
    const idx = new Map<string, ProjectFile>([
      ["pages/home.tsx", makeFile("pages/home.tsx")],
      ["docs/index.mdx", makeFile("docs/index.mdx", "page")],
    ]);

    assertEquals(resolveByExtensionPriority(idx, "pages/home", order), "pages/home.tsx");
    assertEquals(resolveIndexByExtensionPriority(idx, "docs", order), "docs/index.mdx");
    assertEquals(resolveByExtensionPriority(idx, "missing/path", order), null);
  });

  it("sorts API matches by extension priority", () => {
    const order = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
    const sorted = sortPathsByExtensionPriority(
      [
        { path: "pages/a.tsx" },
        { path: "pages/a.mdx" },
        { path: "pages/a.js" },
      ],
      order,
    );

    assertEquals(sorted.map((m) => m.path), [
      "pages/a.mdx",
      "pages/a.tsx",
      "pages/a.js",
    ]);
  });
});
