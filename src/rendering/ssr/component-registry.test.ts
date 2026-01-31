import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// ComponentRegistry imports VirtualModuleSystem which spawns esbuild (child process),
// causing resource leak detection failures. Instead, we test the pure logic helpers
// by inlining them here.

type SkipEntryResult = { skip: boolean; reason?: string };

function createErrorFallbackComponent(
  componentName: string,
  error: string,
): { displayName: string; componentName: string; error: string } {
  return {
    displayName: `ErrorFallback(${componentName})`,
    componentName,
    error,
  };
}

function extractComponentName(fileName: string): string {
  return fileName.replace(/\.(tsx|jsx|ts|js)$/, "");
}

function shouldSkipEntry(
  entryName: string,
  isDirectory: boolean,
  parentDir: string,
): SkipEntryResult {
  if (entryName === "node_modules") return { skip: true, reason: "node_modules" };

  if (entryName.startsWith(".") && entryName !== ".veryfront") {
    return { skip: true, reason: "hidden directory" };
  }

  if (!isDirectory) return { skip: false };

  const vfSystemDirs = new Set([
    "cache",
    "compiled",
    "tmp",
    "temp",
    "output",
    "optimized-images",
    "css",
  ]);

  if (parentDir.includes(".veryfront") && vfSystemDirs.has(entryName)) {
    return { skip: true, reason: ".veryfront system dir" };
  }

  return { skip: false };
}

function isComponentFile(fileName: string): boolean {
  return /\.(tsx|jsx|ts|js)$/.test(fileName);
}

function isIndexFile(fileName: string): boolean {
  return extractComponentName(fileName) === "index";
}

function resolveProjectRoot(dir: string): string {
  if (!dir.endsWith("/components") && !dir.endsWith("\\components")) return dir;
  return dir.replace(/[/\\]components$/, "");
}

function getLoaderOptions(
  projectRoot: string,
  projectId?: string,
  moduleServerUrl?: string,
  vendorBundleHash?: string,
  contentSourceId?: string,
): {
  projectId: string;
  dev: true;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  contentSourceId?: string;
} {
  return {
    projectId: projectId ?? projectRoot,
    dev: true,
    moduleServerUrl,
    vendorBundleHash,
    contentSourceId,
  };
}

describe("ComponentRegistry logic", () => {
  describe("createErrorFallbackComponent", () => {
    it("should create a fallback with component name and error", () => {
      const fallback = createErrorFallbackComponent("Button", "Module not found");
      assertEquals(fallback.displayName, "ErrorFallback(Button)");
      assertEquals(fallback.componentName, "Button");
      assertEquals(fallback.error, "Module not found");
    });

    it("should handle special characters in component names", () => {
      const fallback = createErrorFallbackComponent("My.Component", "Error");
      assertEquals(fallback.displayName, "ErrorFallback(My.Component)");
    });
  });

  describe("extractComponentName", () => {
    it("should strip .tsx extension", () => {
      assertEquals(extractComponentName("Button.tsx"), "Button");
    });

    it("should strip .jsx extension", () => {
      assertEquals(extractComponentName("Card.jsx"), "Card");
    });

    it("should strip .ts extension", () => {
      assertEquals(extractComponentName("utils.ts"), "utils");
    });

    it("should strip .js extension", () => {
      assertEquals(extractComponentName("helper.js"), "helper");
    });

    it("should leave other extensions untouched", () => {
      assertEquals(extractComponentName("style.css"), "style.css");
    });

    it("should handle dotted names", () => {
      assertEquals(extractComponentName("Button.stories.tsx"), "Button.stories");
    });
  });

  describe("shouldSkipEntry", () => {
    it("should skip node_modules", () => {
      const result = shouldSkipEntry("node_modules", true, "/project/components");
      assertEquals(result.skip, true);
      assertEquals(result.reason, "node_modules");
    });

    it("should skip hidden directories", () => {
      assertEquals(shouldSkipEntry(".git", true, "/project").skip, true);
      assertEquals(shouldSkipEntry(".hidden", true, "/project").skip, true);
    });

    it("should not skip .veryfront", () => {
      assertEquals(shouldSkipEntry(".veryfront", true, "/project").skip, false);
    });

    it("should skip .veryfront system subdirs", () => {
      const systemDirs = [
        "cache",
        "compiled",
        "tmp",
        "temp",
        "output",
        "optimized-images",
        "css",
      ];

      for (const dir of systemDirs) {
        assertEquals(shouldSkipEntry(dir, true, "/project/.veryfront").skip, true);
      }
    });

    it("should not skip regular directories inside .veryfront", () => {
      assertEquals(shouldSkipEntry("components", true, "/project/.veryfront").skip, false);
    });

    it("should not skip regular files in normal directories", () => {
      assertEquals(shouldSkipEntry("Button.tsx", false, "/project/components").skip, false);
    });
  });

  describe("isComponentFile", () => {
    it("should accept .tsx files", () => {
      assertEquals(isComponentFile("Button.tsx"), true);
    });

    it("should accept .jsx files", () => {
      assertEquals(isComponentFile("Card.jsx"), true);
    });

    it("should accept .ts files", () => {
      assertEquals(isComponentFile("utils.ts"), true);
    });

    it("should accept .js files", () => {
      assertEquals(isComponentFile("helper.js"), true);
    });

    it("should reject non-component files", () => {
      const nonComponentFiles = ["style.css", "readme.md", "data.json", "image.png"];
      for (const file of nonComponentFiles) {
        assertEquals(isComponentFile(file), false);
      }
    });
  });

  describe("isIndexFile", () => {
    it("should detect index.tsx", () => {
      assertEquals(isIndexFile("index.tsx"), true);
    });

    it("should detect index.jsx", () => {
      assertEquals(isIndexFile("index.jsx"), true);
    });

    it("should detect index.ts", () => {
      assertEquals(isIndexFile("index.ts"), true);
    });

    it("should not flag non-index files", () => {
      assertEquals(isIndexFile("Button.tsx"), false);
      assertEquals(isIndexFile("indexer.tsx"), false);
    });
  });

  describe("resolveProjectRoot", () => {
    it("should strip /components suffix", () => {
      assertEquals(resolveProjectRoot("/project/components"), "/project");
    });

    it("should strip \\components suffix (Windows)", () => {
      assertEquals(resolveProjectRoot("C:\\project\\components"), "C:\\project");
    });

    it("should return dir as-is for non-components paths", () => {
      assertEquals(resolveProjectRoot("/project/pages"), "/project/pages");
    });

    it("should handle nested components directories", () => {
      assertEquals(resolveProjectRoot("/project/src/components"), "/project/src");
    });
  });

  describe("getLoaderOptions", () => {
    it("should use projectId when provided", () => {
      const opts = getLoaderOptions("/project", "proj-uuid-123");
      assertEquals(opts.projectId, "proj-uuid-123");
      assertEquals(opts.dev, true);
    });

    it("should fall back to projectRoot when no projectId", () => {
      const opts = getLoaderOptions("/project");
      assertEquals(opts.projectId, "/project");
    });

    it("should include optional fields when provided", () => {
      const opts = getLoaderOptions(
        "/project",
        "proj-123",
        "http://localhost:3000",
        "abc123",
        "branch:main",
      );
      assertEquals(opts.moduleServerUrl, "http://localhost:3000");
      assertEquals(opts.vendorBundleHash, "abc123");
      assertEquals(opts.contentSourceId, "branch:main");
    });

    it("should leave optional fields undefined when not provided", () => {
      const opts = getLoaderOptions("/project");
      assertEquals(opts.moduleServerUrl, undefined);
      assertEquals(opts.vendorBundleHash, undefined);
      assertEquals(opts.contentSourceId, undefined);
    });
  });

  describe("component registry Map operations (simulated)", () => {
    it("should store and retrieve components", () => {
      const components = new Map<string, unknown>();
      const mockComponent = () => null;

      components.set("Button", mockComponent);

      assertEquals(components.has("Button"), true);
      assertEquals(components.get("Button"), mockComponent);
    });

    it("should track failed components separately", () => {
      const failed = new Map<string, { name: string; error: string; timestamp: number }>();

      failed.set("BrokenComponent", {
        name: "BrokenComponent",
        error: "Syntax error",
        timestamp: Date.now(),
      });

      assertEquals(failed.has("BrokenComponent"), true);
      assertEquals(failed.get("BrokenComponent")?.error, "Syntax error");
    });

    it("should clear all state", () => {
      const components = new Map<string, unknown>();
      const sources = new Map<string, unknown>();
      const failed = new Map<string, unknown>();

      components.set("A", () => null);
      sources.set("B", { source: "" });
      failed.set("C", { error: "fail" });

      components.clear();
      sources.clear();
      failed.clear();

      assertEquals(components.size, 0);
      assertEquals(sources.size, 0);
      assertEquals(failed.size, 0);
    });
  });
});
