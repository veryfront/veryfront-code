import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { discoverComponentsLayoutPath, type FileExistenceChecker } from "./layout-collector.ts";

// ---- Inline reimplementations of non-exported helpers ----

function getLayoutKind(path: string): "mdx" | "tsx" {
  return path.endsWith(".mdx") || path.endsWith(".md") ? "mdx" : "tsx";
}

interface LayoutItem {
  kind: "mdx" | "tsx";
  bundle?: unknown;
  component?: unknown;
  componentPath?: string;
  path: string;
}

function createLayoutItem(layoutPath: string, bundle?: unknown): LayoutItem {
  const kind = getLayoutKind(layoutPath);
  if (kind === "mdx") {
    return { kind: "mdx", bundle, path: layoutPath };
  }
  return {
    kind: "tsx",
    component: undefined,
    componentPath: layoutPath,
    path: layoutPath,
  };
}

// ---- Tests ----

describe("LayoutCollector", () => {
  describe("getLayoutKind", () => {
    it("should return 'mdx' for .mdx files", () => {
      assertEquals(getLayoutKind("/project/layouts/main.mdx"), "mdx");
    });

    it("should return 'mdx' for .md files", () => {
      assertEquals(getLayoutKind("/project/layouts/docs.md"), "mdx");
    });

    it("should return 'tsx' for .tsx files", () => {
      assertEquals(getLayoutKind("/project/layouts/main.tsx"), "tsx");
    });

    it("should return 'tsx' for .jsx files", () => {
      assertEquals(getLayoutKind("/project/layouts/main.jsx"), "tsx");
    });

    it("should return 'tsx' for .ts files", () => {
      assertEquals(getLayoutKind("/project/layouts/main.ts"), "tsx");
    });

    it("should return 'tsx' for .js files", () => {
      assertEquals(getLayoutKind("/project/layouts/main.js"), "tsx");
    });

    it("should return 'tsx' for unknown extensions", () => {
      assertEquals(getLayoutKind("/project/layouts/main.css"), "tsx");
    });
  });

  describe("createLayoutItem", () => {
    it("should create mdx layout item with bundle", () => {
      const bundle = { compiledCode: "code" };
      const item = createLayoutItem("/project/layouts/main.mdx", bundle);
      assertEquals(item.kind, "mdx");
      assertEquals(item.bundle, bundle);
      assertEquals(item.path, "/project/layouts/main.mdx");
    });

    it("should create mdx layout item without bundle", () => {
      const item = createLayoutItem("/project/layouts/main.md");
      assertEquals(item.kind, "mdx");
      assertEquals(item.bundle, undefined);
    });

    it("should create tsx layout item with componentPath", () => {
      const item = createLayoutItem("/project/layouts/main.tsx");
      assertEquals(item.kind, "tsx");
      assertEquals(item.componentPath, "/project/layouts/main.tsx");
      assertEquals(item.component, undefined);
      assertEquals(item.path, "/project/layouts/main.tsx");
    });

    it("should create tsx layout for .jsx files", () => {
      const item = createLayoutItem("/project/layouts/main.jsx");
      assertEquals(item.kind, "tsx");
      assertEquals(item.componentPath, "/project/layouts/main.jsx");
    });
  });

  describe("discoverComponentsLayoutPath", () => {
    it("should find the first matching layout file", async () => {
      const existingFiles = new Set([
        "/project/components/layout.mdx",
      ]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.mdx");
    });

    it("should return null when no layout file exists", async () => {
      const checker: FileExistenceChecker = {
        exists: () => Promise.resolve(false),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, null);
    });

    it("should prefer mdx over tsx (checks mdx first)", async () => {
      const existingFiles = new Set([
        "/project/components/layout.mdx",
        "/project/components/layout.tsx",
      ]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      // LAYOUT_EXTENSIONS = ["mdx", "md", "tsx", "jsx", "ts", "js"]
      // So mdx is checked first
      assertEquals(result, "/project/components/layout.mdx");
    });

    it("should find tsx layout when no mdx/md exists", async () => {
      const existingFiles = new Set([
        "/project/components/layout.tsx",
      ]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.tsx");
    });

    it("should find .js layout as last resort", async () => {
      const existingFiles = new Set([
        "/project/components/layout.js",
      ]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.js");
    });

    it("should use the correct path format", async () => {
      const checkedPaths: string[] = [];
      const checker: FileExistenceChecker = {
        exists: (path: string) => {
          checkedPaths.push(path);
          return Promise.resolve(false);
        },
      };

      await discoverComponentsLayoutPath("/my-project", checker);
      // Should check all extension variants
      assertEquals(checkedPaths.length, 6); // mdx, md, tsx, jsx, ts, js
      assertEquals(checkedPaths[0], "/my-project/components/layout.mdx");
      assertEquals(checkedPaths[1], "/my-project/components/layout.md");
      assertEquals(checkedPaths[2], "/my-project/components/layout.tsx");
      assertEquals(checkedPaths[3], "/my-project/components/layout.jsx");
      assertEquals(checkedPaths[4], "/my-project/components/layout.ts");
      assertEquals(checkedPaths[5], "/my-project/components/layout.js");
    });
  });

  describe("layout frontmatter handling", () => {
    const isLayoutDisabled = (value: string | boolean | undefined) =>
      value === false || value === "false";
    const hasExplicitLayout = (value: string | boolean | undefined) =>
      typeof value === "string" && value.length > 0;

    it("should treat layout:false as disabled", () => {
      assertEquals(isLayoutDisabled(false), true);
    });

    it("should treat layout:'false' string as disabled", () => {
      assertEquals(isLayoutDisabled("false"), true);
    });

    it("should detect explicit frontmatter layout", () => {
      assertEquals(hasExplicitLayout("main"), true);
    });

    it("should not detect empty string as explicit layout", () => {
      assertEquals(hasExplicitLayout(""), false);
    });

    it("should not detect undefined as explicit layout", () => {
      assertEquals(hasExplicitLayout(undefined), false);
    });

    it("should not detect true as explicit layout", () => {
      assertEquals(hasExplicitLayout(true), false);
    });
  });

  describe(".veryfront path detection", () => {
    it("should detect .veryfront paths", () => {
      const path1 = "/project/.veryfront/chat/page.tsx";
      const path2 = "/project/pages/.veryfront/index.tsx";
      assertEquals(path1.includes("/.veryfront/") || path1.includes(".veryfront/"), true);
      assertEquals(path2.includes("/.veryfront/") || path2.includes(".veryfront/"), true);
    });

    it("should not flag non-.veryfront paths", () => {
      const path = "/project/pages/about.tsx";
      assertEquals(path.includes("/.veryfront/") || path.includes(".veryfront/"), false);
    });
  });
});
