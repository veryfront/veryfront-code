import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeHash } from "#veryfront/utils";
import { computeDepsHash } from "./hash-calculator.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(files: Record<string, string> = {}): RuntimeAdapter {
  return {
    fs: {
      readFile: async (path: string) => {
        if (path in files) return files[path];
        throw new Error(`File not found: ${path}`);
      },
      exists: async () => false,
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
      stat: async () => ({ isFile: true, isDirectory: false, size: 0 }),
      remove: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createMdxBundle(code: string): MdxBundle {
  return {
    compiledCode: code,
    frontmatter: {},
    globals: {},
    headings: [],
    nodeMap: new Map(),
  };
}

describe("rendering/layouts/utils/hash-calculator", () => {
  describe("computeDepsHash", () => {
    it("should return empty string when no layout bundle and no nested layouts", async () => {
      const adapter = createMockAdapter();
      const result = await computeDepsHash(undefined, [], adapter);
      assertEquals(result, "");
    });

    it("should compute hash from layout bundle compiled code", async () => {
      const adapter = createMockAdapter();
      const bundle = createMdxBundle("const x = 1;");
      const result = await computeDepsHash(bundle, [], adapter);
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should return consistent hashes for the same input", async () => {
      const adapter = createMockAdapter();
      const bundle = createMdxBundle("const x = 1;");
      const r1 = await computeDepsHash(bundle, [], adapter);
      const r2 = await computeDepsHash(bundle, [], adapter);
      assertEquals(r1, r2);
    });

    it("should return different hashes for different layout code", async () => {
      const adapter = createMockAdapter();
      const b1 = createMdxBundle("const a = 1;");
      const b2 = createMdxBundle("const b = 2;");
      const r1 = await computeDepsHash(b1, [], adapter);
      const r2 = await computeDepsHash(b2, [], adapter);
      assertEquals(r1 !== r2, true);
    });

    it("should include nested layout component paths in hash", async () => {
      const adapter = createMockAdapter({ "/layout.tsx": "export default () => {}" });
      const nestedLayouts: LayoutItem[] = [
        { componentPath: "/layout.tsx" } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(
        result,
        await computeHash("export default () => {}"),
        "nested tsx layouts must hash their file contents, not their path",
      );
    });

    it("should change the hash when a nested layout file is edited", async () => {
      const nestedLayouts: LayoutItem[] = [
        { componentPath: "/layout.tsx" } as unknown as LayoutItem,
      ];
      const resultA = await computeDepsHash(
        undefined,
        nestedLayouts,
        createMockAdapter({ "/layout.tsx": "export default () => {}" }),
      );
      const resultB = await computeDepsHash(
        undefined,
        nestedLayouts,
        createMockAdapter({ "/layout.tsx": "export default () => null" }),
      );
      assertNotEquals(
        resultA,
        resultB,
        "editing a nested layout file must change the dependency hash",
      );
    });

    it("should include nested layout bundle code in hash", async () => {
      const adapter = createMockAdapter();
      const nestedLayouts: LayoutItem[] = [
        { bundle: createMdxBundle("layout code") } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(
        result,
        await computeHash("layout code"),
        "nested MDX layouts must hash bundle.compiledCode",
      );
    });

    it("should change the hash when nested layout bundle code differs", async () => {
      const adapter = createMockAdapter();
      const resultA = await computeDepsHash(
        undefined,
        [{ bundle: createMdxBundle("layout code") } as unknown as LayoutItem],
        adapter,
      );
      const resultB = await computeDepsHash(
        undefined,
        [{ bundle: createMdxBundle("other layout code") } as unknown as LayoutItem],
        adapter,
      );
      assertNotEquals(
        resultA,
        resultB,
        "a changed nested bundle must change the dependency hash",
      );
    });

    it("should skip null items in nested layouts", async () => {
      const adapter = createMockAdapter();
      const nestedLayouts = [null, undefined] as unknown as LayoutItem[];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(result, "");
    });

    it("should handle file read errors gracefully for component paths", async () => {
      const adapter = createMockAdapter({});
      const nestedLayouts: LayoutItem[] = [
        { componentPath: "/nonexistent.tsx" } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(result, "", "an unreadable component path must contribute no hash part");
    });

    it("should keep other dependency hashes when one component path is unreadable", async () => {
      const adapter = createMockAdapter({});
      const bundle = createMdxBundle("main layout");
      const nestedLayouts: LayoutItem[] = [
        { componentPath: "/missing.tsx" } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(bundle, nestedLayouts, adapter);
      assertEquals(
        result,
        await computeHash("main layout"),
        "one unreadable nested layout must not discard the other dependency hashes",
      );
    });

    it("should combine layout bundle hash with nested layout hashes", async () => {
      const adapter = createMockAdapter({ "/nested.tsx": "export default () => {}" });
      const bundle = createMdxBundle("main layout");
      const nestedLayouts: LayoutItem[] = [
        { componentPath: "/nested.tsx" } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(bundle, nestedLayouts, adapter);
      assertEquals(result.includes(":"), true);
    });

    it("should prefer componentPath over bundle for nested layouts", async () => {
      const adapter = createMockAdapter({ "/comp.tsx": "component source" });
      const nestedLayouts: LayoutItem[] = [
        {
          componentPath: "/comp.tsx",
          bundle: createMdxBundle("should be ignored"),
        } as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(
        result,
        await computeHash("component source"),
        "componentPath source must win over the nested bundle code",
      );
      assertNotEquals(
        result,
        await computeHash("should be ignored"),
        "nested bundle code must not be hashed when componentPath is present",
      );
    });

    it("should skip nested layouts without componentPath or bundle", async () => {
      const adapter = createMockAdapter();
      const nestedLayouts: LayoutItem[] = [
        {} as unknown as LayoutItem,
      ];
      const result = await computeDepsHash(undefined, nestedLayouts, adapter);
      assertEquals(result, "");
    });
  });
});
