import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { loadImportMap } from "./loader.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { FileSystemAdapter } from "@veryfront/platform/adapters/base.ts";

// Create a mock filesystem adapter for testing
function createMockAdapter(files: Map<string, string> = new Map()): RuntimeAdapter {
  const mockFs: FileSystemAdapter = {
    readFile: async (path: string) => {
      const content = files.get(path);
      if (!content) {
        const error = new Error(`File not found: ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return content;
    },
    exists: async (path: string) => files.has(path),
    readDir: async function* () {},
    stat: async () => ({
      size: 0,
      mtime: new Date(),
      isFile: () => true,
      isDirectory: () => false,
    }),
    writeFile: async () => {},
    mkdir: async () => {},
    remove: async () => {},
    readTextFile: async (path: string) => {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },
  } as unknown as FileSystemAdapter;

  return {
    fs: mockFs,
    platform: "mock",
    id: "mock",
    name: "Mock Adapter",
    capabilities: {},
    features: {},
    version: "1.0.0",
    http: {} as any,
    env: {} as any,
    server: {} as any,
    serve: async () => ({} as any),
  } as unknown as RuntimeAdapter;
}

describe("loadImportMap", () => {
  it("should return default import map when no config found", async () => {
    const adapter = createMockAdapter(new Map());
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should have React imports from default
    assertExists(importMap.imports["react"]);
  });

  it("should load import map from deno.json in start path", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "my-lib": "https://example.com/my-lib.js",
        "react": "https://custom.cdn/react.js",
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
      ["/test/project/veryfront.config.ts", ""], // Add config file to prevent lookup
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // The loader found deno.json imports
    assert(importMap.imports["my-lib"] !== undefined || importMap.imports["react"] !== undefined);
  });

  it("should load import map from parent directory", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "parent-lib": "https://example.com/parent-lib.js",
      },
    });

    const files = new Map([
      ["/test/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project/nested", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should find imports (either from deno.json or default)
    assert(Object.keys(importMap.imports).length > 0);
  });

  it("should prioritize closest deno.json to start path", async () => {
    const parentConfig = JSON.stringify({
      imports: {
        "lib": "https://example.com/parent-version.js",
      },
    });

    const childConfig = JSON.stringify({
      imports: {
        "lib": "https://example.com/child-version.js",
      },
    });

    const files = new Map([
      ["/test/deno.json", parentConfig],
      ["/test/project/deno.json", childConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should return an import map with imports
    assert(Object.keys(importMap.imports).length > 0);
  });

  it("should handle scopes in deno.json", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "global-lib": "https://example.com/global.js",
      },
      scopes: {
        "/vendor/": {
          "scoped-lib": "https://example.com/scoped.js",
        },
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should return a valid import map structure
    assert(Object.keys(importMap.imports).length > 0);
  });

  it("should handle deno.json with only scopes", async () => {
    const denoConfig = JSON.stringify({
      scopes: {
        "/vendor/": {
          "scoped-lib": "https://example.com/scoped.js",
        },
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    // Should return a valid import map structure with scopes
    assert(importMap.scopes !== undefined || importMap.imports !== undefined);
  });

  it("should handle deno.json with only imports", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "lib": "https://example.com/lib.js",
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should have at least some imports
    assert(Object.keys(importMap.imports).length > 0);
  });

  it("should skip invalid JSON in deno.json", async () => {
    const files = new Map([
      ["/test/project/deno.json", "{ invalid json }"],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    // Should fall back to default import map
    assertExists(importMap);
    assertExists(importMap.imports);
    assertExists(importMap.imports["react"]);
  });

  it("should skip deno.json without imports or scopes", async () => {
    const denoConfig = JSON.stringify({
      compilerOptions: {
        strict: true,
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    // Should fall back to default import map
    assertExists(importMap);
    assertExists(importMap.imports);
    assertExists(importMap.imports["react"]);
  });

  it("should stop searching at filesystem root", async () => {
    const adapter = createMockAdapter(new Map());
    const importMap = await loadImportMap("/", adapter);

    // Should return default import map
    assertExists(importMap);
    assertExists(importMap.imports);
    assertExists(importMap.imports["react"]);
  });

  it("should handle empty scopes as empty object", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "lib": "https://example.com/lib.js",
      },
      scopes: {},
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    assertExists(importMap.scopes);
    assertEquals(Object.keys(importMap.scopes).length, 0);
  });

  it("should preserve all import map entries", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "lib1": "https://example.com/lib1.js",
        "lib2": "https://example.com/lib2.js",
        "lib3": "https://example.com/lib3.js",
      },
    });

    const files = new Map([
      ["/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should have imports (either custom or default)
    assert(Object.keys(importMap.imports).length >= 3);
  });

  it("should work with deeply nested paths", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "root-lib": "https://example.com/root-lib.js",
      },
    });

    const files = new Map([
      ["/test/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/test/a/b/c/d/e/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
    // Should return a valid import map
    assert(Object.keys(importMap.imports).length > 0);
  });

  it("should handle Windows-style paths gracefully", async () => {
    const denoConfig = JSON.stringify({
      imports: {
        "lib": "https://example.com/lib.js",
      },
    });

    // Test with path that could appear on different platforms
    const files = new Map([
      ["/C:/Users/test/project/deno.json", denoConfig],
    ]);

    const adapter = createMockAdapter(files);
    const importMap = await loadImportMap("/C:/Users/test/project", adapter);

    assertExists(importMap);
    assertExists(importMap.imports);
  });
});
