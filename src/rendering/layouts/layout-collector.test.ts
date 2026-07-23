import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  discoverComponentsLayoutPath,
  type FileExistenceChecker,
  LayoutCollector,
  resolveLayoutRouterRootDir,
} from "./layout-collector.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

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
    return { kind, bundle, path: layoutPath };
  }

  return {
    kind,
    component: undefined,
    componentPath: layoutPath,
    path: layoutPath,
  };
}

describe("LayoutCollector", () => {
  it("resolves configured App Router and Pages Router roots", () => {
    const config = {
      directories: { app: "src/site", pages: "src/content" },
    } as VeryfrontConfig;

    assertEquals(
      resolveLayoutRouterRootDir("/project", true, config),
      "/project/src/site",
    );
    assertEquals(
      resolveLayoutRouterRootDir("/project", false, config),
      "/project/src/content",
    );
  });

  it("rejects configured router roots outside the project", () => {
    const config = {
      directories: { app: "../outside" },
    } as VeryfrontConfig;

    assertThrows(
      () => resolveLayoutRouterRootDir("/project", true, config),
      Error,
      "Router directories must stay inside the project",
    );
  });

  it("propagates operational errors while checking the components fallback", async () => {
    const failure = new Error("permission denied");
    const adapter = {
      fs: {
        stat: () => Promise.reject(failure),
      },
    } as unknown as RuntimeAdapter;
    const collector = new LayoutCollector({
      projectDir: "/project",
      adapter,
      config: {} as VeryfrontConfig,
      compileMDX: () => Promise.reject(new Error("unexpected compilation")),
    });
    const internals = collector as unknown as {
      checkComponentsLayoutFallback(): Promise<LayoutItem[]>;
    };

    await assertRejects(
      () => internals.checkComponentsLayoutFallback(),
      Error,
      "permission denied",
    );
  });

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
      const existingFiles = new Set(["/project/components/layout.mdx"]);
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
      assertEquals(result, "/project/components/layout.mdx");
    });

    it("should find tsx layout when no mdx/md exists", async () => {
      const existingFiles = new Set(["/project/components/layout.tsx"]);
      const checker: FileExistenceChecker = {
        exists: (path: string) => Promise.resolve(existingFiles.has(path)),
      };

      const result = await discoverComponentsLayoutPath("/project", checker);
      assertEquals(result, "/project/components/layout.tsx");
    });

    it("should find .js layout as last resort", async () => {
      const existingFiles = new Set(["/project/components/layout.js"]);
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

      assertEquals(checkedPaths.length, 6);
      assertEquals(checkedPaths[0], "/my-project/components/layout.mdx");
      assertEquals(checkedPaths[1], "/my-project/components/layout.md");
      assertEquals(checkedPaths[2], "/my-project/components/layout.tsx");
      assertEquals(checkedPaths[3], "/my-project/components/layout.jsx");
      assertEquals(checkedPaths[4], "/my-project/components/layout.ts");
      assertEquals(checkedPaths[5], "/my-project/components/layout.js");
    });
  });

  describe("layout frontmatter handling", () => {
    const isLayoutDisabled = (value: string | boolean | undefined): boolean =>
      value === false || value === "false";

    const hasExplicitLayout = (value: string | boolean | undefined): boolean =>
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
    const isVeryfrontPath = (path: string): boolean =>
      path.includes("/.veryfront/") || path.includes(".veryfront/");

    it("should detect .veryfront paths", () => {
      assertEquals(isVeryfrontPath("/project/.veryfront/chat/page.tsx"), true);
      assertEquals(isVeryfrontPath("/project/pages/.veryfront/index.tsx"), true);
    });

    it("should not flag non-.veryfront paths", () => {
      assertEquals(isVeryfrontPath("/project/pages/about.tsx"), false);
    });
  });
});
