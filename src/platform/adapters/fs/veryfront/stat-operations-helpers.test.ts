import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProjectFile } from "../../veryfront-api-client/index.ts";
import { STAT_OPERATION_EXTENSION_PRIORITY } from "./extension-priority.ts";
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
    for (const ext of STAT_OPERATION_EXTENSION_PRIORITY) {
      assertEquals(
        stripKnownExtension(`pages/index${ext}`, STAT_OPERATION_EXTENSION_PRIORITY),
        "pages/index",
        `stripKnownExtension must strip ${ext}, which is in the priority list`,
      );
    }
    assertEquals(
      stripKnownExtension("pages/index.unknown", STAT_OPERATION_EXTENSION_PRIORITY),
      "pages/index.unknown",
      "an extension outside the priority list must be left untouched",
    );
  });

  it("resolves direct and index matches by extension priority", () => {
    const order = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
    const idx = new Map<string, ProjectFile>([
      ["pages/home.tsx", makeFile("pages/home.tsx")],
      ["pages/home.mdx", makeFile("pages/home.mdx", "page")],
      ["docs/index.mdx", makeFile("docs/index.mdx", "page")],
      ["docs/index.tsx", makeFile("docs/index.tsx")],
      ["blog/post.js", makeFile("blog/post.js")],
      ["blog/post.ts", makeFile("blog/post.ts")],
    ]);

    assertEquals(
      resolveByExtensionPriority(idx, "pages/home", order),
      "pages/home.mdx",
      "mdx wins over tsx for the same base path",
    );
    assertEquals(
      resolveIndexByExtensionPriority(idx, "docs", order),
      "docs/index.mdx",
      "index.mdx wins over index.tsx for the same directory",
    );
    assertEquals(
      resolveByExtensionPriority(idx, "blog/post", order),
      "blog/post.ts",
      "ts wins over js for the same base path",
    );
    assertEquals(
      resolveByExtensionPriority(idx, "missing/path", order),
      null,
      "an unknown base path resolves to null",
    );
  });

  it("sorts API matches by extension priority", () => {
    const order = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
    const sorted = sortPathsByExtensionPriority(
      [
        { path: "pages/a.css" },
        { path: "pages/a.tsx" },
        { path: "pages/a.mdx" },
        { path: "pages/a.js" },
        { path: "pages/a.json" },
      ],
      order,
    );

    assertEquals(
      sorted.map((m) => m.path),
      [
        "pages/a.mdx",
        "pages/a.tsx",
        "pages/a.js",
        "pages/a.css",
        "pages/a.json",
      ],
      "unknown extensions sort behind every known extension",
    );
  });
});
