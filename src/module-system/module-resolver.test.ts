import { describe, it } from "std/testing/bdd.ts";
import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { ModuleResolver } from "./module-resolver.ts";
import type { RuntimeAdapter, FileSystemAdapter } from "@veryfront/platform/adapters/base.ts";

function createMockAdapter(files: Map<string, boolean> = new Map()): RuntimeAdapter {
  const mockFs: FileSystemAdapter = {
    exists: async (path: string) => files.get(path) ?? false,
    readFile: async () => "",
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
    readTextFile: async () => "",
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

describe("ModuleResolver", () => {
  it("should create resolver with options", () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    assertExists(resolver);
  });

  it("should resolve virtual modules", async () => {
    const adapter = createMockAdapter();
    const virtualModules = new Map([
      ["virtual:test", "export const test = 1;"],
    ]);

    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
      virtualModules,
    });

    const resolved = await resolver.resolve("virtual:test");

    assertExists(resolved);
    assertEquals(resolved.type, "virtual");
    assertEquals(resolved.path, "virtual:test");
    assert(resolved.transformed);
  });

  it("should resolve import map URLs", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
      importMap: {
        "react": "https://esm.sh/react@18",
      },
    });

    const resolved = await resolver.resolve("react");

    assertExists(resolved);
    assertEquals(resolved.type, "external");
    assertEquals(resolved.path, "https://esm.sh/react@18");
  });

  it("should resolve bare specifiers to npm", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    const resolved = await resolver.resolve("lodash");

    assertExists(resolved);
    assertEquals(resolved.type, "npm");
    assert(resolved.path.includes("esm.sh"));
  });

  it("should resolve relative paths", async () => {
    const files = new Map([
      ["/test/utils.ts", true],
    ]);

    const adapter = createMockAdapter(files);
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    const resolved = await resolver.resolve("./utils", "/test/index.ts");

    assertExists(resolved);
    assertEquals(resolved.type, "file");
  });

  it("should try multiple extensions", async () => {
    const files = new Map([
      ["/test/utils.tsx", true],
    ]);

    const adapter = createMockAdapter(files);
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    const resolved = await resolver.resolve("./utils", "/test/index.ts");

    assertExists(resolved);
    assertEquals(resolved.type, "file");
  });

  it("should cache resolved modules", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    const resolved1 = await resolver.resolve("react");
    const resolved2 = await resolver.resolve("react");

    assertEquals(resolved1, resolved2);
  });

  it("should clear cache", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    await resolver.resolve("react");
    resolver.clearCache();

    const resolved = await resolver.resolve("react");
    assertExists(resolved);
  });

  it("should add virtual module", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    resolver.addVirtualModule("virtual:new", "export const x = 1;");
    const resolved = await resolver.resolve("virtual:new");

    assertExists(resolved);
    assertEquals(resolved.type, "virtual");
  });

  it("should remove virtual module", async () => {
    const adapter = createMockAdapter();
    const virtualModules = new Map([
      ["virtual:test", "export const test = 1;"],
    ]);

    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
      virtualModules,
    });

    resolver.removeVirtualModule("virtual:test");
    const resolved = await resolver.resolve("virtual:test");

    // Should fallback to npm
    assertExists(resolved);
    assertEquals(resolved.type, "npm");
  });

  it("should block path traversal", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    const resolved = await resolver.resolve("/../../../etc/passwd");

    assertEquals(resolved, null);
  });

  it("should clear cache by pattern", async () => {
    const adapter = createMockAdapter();
    const resolver = new ModuleResolver({
      projectDir: "/test",
      adapter,
    });

    await resolver.resolve("react");
    await resolver.resolve("vue");

    resolver.clearCache("react");

    const resolved = await resolver.resolve("react");
    assertExists(resolved);
  });
});
