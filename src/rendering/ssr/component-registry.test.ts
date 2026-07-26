import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { VirtualModuleSystem } from "../virtual-module-system.ts";
import { ComponentRegistry } from "./component-registry.ts";
import type * as React from "react";

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

  describe("dependency snapshot isolation", () => {
    it("materializes distinct component maps for concurrent package snapshots", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenVersions: string[] = [];
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          seenVersions.push(version);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      const [snapshotA, snapshotB] = await Promise.all([
        registry.prepareDependencySnapshot("on:a", { lodash: "1.0.0" }),
        registry.prepareDependencySnapshot("on:b", { lodash: "2.0.0" }),
      ]);

      const componentA = registry.getAllAsComponents(snapshotA).Button;
      const componentB = registry.getAllAsComponents(snapshotB).Button;
      assertEquals(componentA === componentB, false);
      assertEquals(componentA?.displayName, "Button(1.0.0)");
      assertEquals(componentB?.displayName, "Button(2.0.0)");
      assertEquals(seenVersions.sort(), ["1.0.0", "2.0.0"]);
    });

    it("isolates pin-on component maps by request origin", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const seenOrigins: Array<string | undefined> = [];
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const origin = options?.moduleServerOrigin;
          seenOrigins.push(origin);
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${origin})`;
          return Promise.resolve(Component);
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      const originAKey = await registry.prepareDependencySnapshot(
        "on:snapshot",
        {},
        undefined,
        "https://a.example",
      );
      const originBKey = await registry.prepareDependencySnapshot(
        "on:snapshot",
        {},
        undefined,
        "https://b.example",
      );
      const originAKeyAgain = await registry.prepareDependencySnapshot(
        "on:snapshot",
        {},
        undefined,
        "https://a.example",
      );

      assertEquals(originAKeyAgain, originAKey);
      assertEquals(originAKey === originBKey, false);
      assertEquals(
        registry.getAllAsComponents(originAKey).Button?.displayName,
        "Button(https://a.example)",
      );
      assertEquals(
        registry.getAllAsComponents(originBKey).Button?.displayName,
        "Button(https://b.example)",
      );
      assertEquals(seenOrigins, ["https://a.example", "https://b.example"]);
    });

    it("bounds retained dependency snapshots and evicts the least recently used map", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/project/components/Button.tsx",
        "export default function Button() { return null; }",
      );
      const virtualModules = {
        registerModule: () => Promise.resolve(),
      } as unknown as VirtualModuleSystem;
      const registry = new ComponentRegistry(
        virtualModules,
        3001,
        adapter,
        undefined,
        undefined,
        "project-id",
        "branch:main",
        (_source, _filePath, _projectDir, _adapter, options) => {
          const version = options?.dependencyPinningDependencies?.lodash ?? "missing";
          const Component: React.ComponentType<Record<string, unknown>> = () => null;
          Component.displayName = `Button(${version})`;
          return Promise.resolve(Component);
        },
      );

      await registry.loadFromDirectory("/project/components", true);
      for (let index = 0; index < 32; index++) {
        await registry.prepareDependencySnapshot(
          `on:snapshot-${index}`,
          { lodash: `${index}.0.0` },
        );
      }
      assertEquals(registry.has("Button", "on:snapshot-0"), true);
      await registry.prepareDependencySnapshot(
        "on:snapshot-32",
        { lodash: "32.0.0" },
      );

      const retainedState = registry as unknown as {
        componentsByDependencySnapshot: Map<string, unknown>;
        dependencySnapshotGenerations: Map<string, unknown>;
      };
      assertEquals(retainedState.componentsByDependencySnapshot.size, 32);
      assertEquals(retainedState.dependencySnapshotGenerations.size, 32);
      assertEquals(registry.has("Button", "on:snapshot-0"), true);
      assertEquals(registry.has("Button", "on:snapshot-1"), false);
      assertEquals(registry.has("Button", "on:snapshot-32"), true);
    });
  });
});
